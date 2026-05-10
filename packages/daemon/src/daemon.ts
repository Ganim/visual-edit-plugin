import { randomBytes } from 'node:crypto';
import { Logger } from '@visual-edit/diagnostics';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { analyze, loadConfig, findRoutes, discoverSchemas, invalidateAnalyzer } from '@visual-edit/project-analyzer';
import type { ProjectInfo } from '@visual-edit/shared';
import type { AdapterInput } from '@visual-edit/adapter-vite';
import { readCommitLog, rollback as codeModsRollback } from '@visual-edit/code-mods';
import { writeLock, removeLock } from './lockFile.js';
import { decideLockAction } from './lockTakeover.js';
import { LockHeartbeat } from './lockHeartbeat.js';
import { findFreePort } from './portFinder.js';
import { PreviewSupervisor } from './previewSupervisor.js';
import { createHttpServer } from './http.js';
import { attachWebSocket, broadcastFileChanged, broadcastAskAIResolved } from './ws.js';
import { EditPipeline } from './editPipeline.js';
import { FileWatcher } from './fileWatcher.js';
import { QueueManager } from './queue/queueManager.js';
import { LeaseTimer } from './queue/leaseTimer.js';

const DAEMON_VERSION = '0.0.0';

export interface DaemonOptions {
  root: string;
  port?: number;
  logger?: Logger;
  editorAssetsRoot?: string;
  /** Default 'auto'. 'bind-only' refuses to connect to an existing daemon. 'connect-only' returns existing URL or throws. */
  mode?: 'auto' | 'bind-only' | 'connect-only';
}

export class Daemon {
  private supervisor = new PreviewSupervisor();
  private editPipelines = new Map<string, EditPipeline>();
  private fileWatcher = new FileWatcher();
  private startedAt = Date.now();
  private httpServer?: ReturnType<typeof createHttpServer>;
  private wsServer?: ReturnType<typeof attachWebSocket>;
  private logger: Logger;
  private projectInfo?: ProjectInfo;
  private actualPort?: number;
  private queue: QueueManager;
  private mode: 'pre-start' | 'bound' | 'connected' | 'took-over' = 'pre-start';
  private heartbeat?: LockHeartbeat;
  private leaseTimer?: LeaseTimer;
  private connectedPort?: number;

  constructor(private opts: DaemonOptions) {
    this.logger = opts.logger ?? new Logger();
    this.queue = new QueueManager(opts.root);
    this.leaseTimer = new LeaseTimer(this.queue);
  }

  /** Current lifecycle mode. */
  getMode(): 'pre-start' | 'bound' | 'connected' | 'took-over' { return this.mode; }

  /** Resolved port the daemon is actually listening on (own or connected). Undefined before start(). */
  getPort(): number | undefined { return this.actualPort ?? this.connectedPort; }

  async start(): Promise<void> {
    const desiredMode = this.opts.mode ?? 'auto';
    const decision = await decideLockAction(this.opts.root);

    if (decision.kind === 'refuse') {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROTOCOL_001_VERSION_MISMATCH,
        message: `[VE_PROTOCOL_001]: ${decision.reason}`,
        severity: 'fatal',
        recovery: 'user-action',
        blame: 'environment',
        hint: 'Delete .visual-edit/daemon.lock and restart.',
      }));
    }

    if (decision.kind === 'connect') {
      if (desiredMode === 'bind-only') {
        throw new VisualEditError(makeEnvelope({
          code: CODES.VE_FS_001_LOCK_HELD,
          message: `[VE_FS_001]: daemon already running with pid ${decision.pid} on port ${decision.port}`,
          severity: 'error',
          recovery: 'user-action',
          blame: 'environment',
          hint: 'Stop the other daemon or use mode: "auto".',
        }));
      }
      // Connect path — record the existing daemon's port and skip bind.
      this.connectedPort = decision.port;
      this.mode = 'connected';
      return;
    }

    // At this point decision.kind is 'takeover' or 'bind' — no live daemon to connect to.
    if (desiredMode === 'connect-only') {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_FS_001_LOCK_HELD,
        message: `[VE_FS_001]: connect-only mode requested but no live daemon found at ${this.opts.root}`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'environment',
        hint: 'Start a daemon first, then connect.',
      }));
    }

    if (decision.kind === 'takeover') {
      // Continue with the normal bind path; writeLock() will overwrite the stale lock atomically.
      this.mode = 'took-over';
      // fall through to bind path
    } else {
      // decision.kind === 'bind'
      this.mode = 'bound';
    }

    this.projectInfo = await analyze(this.opts.root);
    const config = await loadConfig(this.opts.root);
    if (config) {
      const routes = await findRoutes(this.opts.root, config.routes);
      this.projectInfo = { ...this.projectInfo, routes, config };
    } else {
      const routes = await findRoutes(this.opts.root, undefined);
      this.projectInfo = { ...this.projectInfo, routes };
    }

    const port = this.opts.port ?? await findFreePort(5170, 5179);
    this.actualPort = port;

    this.httpServer = createHttpServer({
      openPreview: this.openPreview.bind(this),
      closePreview: this.closePreview.bind(this),
      getStatus: this.getStatus.bind(this),
      rollback: this.rollback.bind(this),
      drainAskAI: async () => this.queue.drain(),
      resolveAskAI: async (req) => {
        const resolveInput = {
          askId: req.askId,
          leaseId: req.leaseId,
          outcome: req.outcome,
          summary: req.summary,
          ...(req.commitId !== undefined ? { commitId: req.commitId } : {}),
        };
        const item = this.queue.resolve(resolveInput);
        // Broadcast to all WS clients. sessionId '*' is a wire sentinel — clients match by askId.
        if (this.wsServer) {
          broadcastAskAIResolved(this.wsServer, {
            sessionId: '*',
            askId: item.askId,
            outcome: item.outcome!,
            summary: item.summary ?? '',
            ...(item.commitId !== undefined ? { commitId: item.commitId } : {}),
          });
        }
      },
      ...(this.opts.editorAssetsRoot !== undefined ? { editorAssetsRoot: this.opts.editorAssetsRoot } : {}),
    });
    this.wsServer = attachWebSocket(this.httpServer, {
      getSession: (id) => this.supervisor.list().find((s) => s.id === id) ?? null,
      getPipeline: (id) => this.editPipelines.get(id) ?? null,
      daemonPort: () => this.actualPort!,
      getQueue: () => this.queue,
    });

    await new Promise<void>((r) => this.httpServer!.listen(port, '127.0.0.1', r));

    this.fileWatcher.on('external-change', (e) => {
      for (const [sessionId, pipeline] of this.editPipelines) {
        if (pipeline.getFilePath() !== e.filePath) continue;
        broadcastFileChanged(this.wsServer!, {
          sessionId,
          filePath: e.filePath,
          sha256: e.sha256,
          dirtySourceMap: true,
        });
      }
      invalidateAnalyzer(this.opts.root, e.filePath);
    });

    await writeLock(this.opts.root, { pid: process.pid, port, daemonVersion: DAEMON_VERSION });

    this.heartbeat = new LockHeartbeat(this.opts.root);
    this.heartbeat.start();

    this.leaseTimer!.start();

    this.logger.info('daemon started', { port, root: this.opts.root, pid: process.pid });

    process.on('SIGTERM', () => this.stop().then(() => process.exit(0)));
    process.on('SIGINT', () => this.stop().then(() => process.exit(0)));
  }

  async stop(): Promise<void> {
    // Connected mode owns no bound resources — skip all cleanup.
    if (this.mode === 'connected') return;

    await this.supervisor.stopAll();
    if (this.wsServer) {
      // Force-close all open WS connections so close() resolves.
      for (const client of this.wsServer.clients) client.terminate();
      await new Promise<void>((r) => this.wsServer!.close(() => r()));
    }
    if (this.httpServer) {
      // Available since Node 18.2 — required because keep-alive HTTP connections
      // (e.g. from the mcp-server's fetch) prevent close() from resolving otherwise.
      this.httpServer.closeAllConnections();
      await new Promise<void>((r) => this.httpServer!.close(() => r()));
    }
    await this.fileWatcher.close();
    // QueueManager writes are individually fsync'd by appendWalEntry; no flush needed here.
    // 1.C does NOT implement WAL compaction (deferred to 1.D).
    this.heartbeat?.stop();
    this.leaseTimer?.stop();
    await removeLock(this.opts.root);
    this.logger.info('daemon stopped');
  }

  async openPreview(req: { root: string; page: string }): Promise<{ url: string; sessionId: string; editorUrl: string }> {
    if (!this.projectInfo) throw new Error('daemon not started');
    const matchedPage = this.projectInfo.routes.find((r) => r.route === req.page || r.filePath.endsWith(req.page));
    if (!matchedPage) {
      const alternatives = this.projectInfo.routes.slice(0, 5).map((r) => r.route);
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_002_ROUTE_NOT_FOUND,
        message: `[VE_PROJECT_002]: route '${req.page}' not found`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'user-config',
        hint: `Available routes: ${alternatives.join(', ') || '(none)'}`,
      }));
    }

    const sessionId = randomBytes(4).toString('hex');
    const previewPort = await findFreePort(5180, 5200);
    const schemas = await discoverSchemas(this.opts.root);

    const adapterInput: AdapterInput = {
      info: this.projectInfo,
      page: matchedPage,
      config: this.projectInfo.config ?? null,
      schemas,
      port: previewPort,
      sessionId,
      env: filterEnv(process.env, this.projectInfo.config?.safeEnvPrefixes ?? ['VITE_', 'PUBLIC_', 'NEXT_PUBLIC_']),
    };

    const session = await this.supervisor.spawn(sessionId, adapterInput);
    const pipeline = new EditPipeline({
      root: this.opts.root,
      filePath: matchedPage.filePath,
      onSelfWrite: (path, sha256) => this.fileWatcher.registerSelfWrite(path, sha256),
    });
    this.editPipelines.set(sessionId, pipeline);
    await this.fileWatcher.watch(matchedPage.filePath);
    const editorUrl = `http://127.0.0.1:${this.actualPort}/__editor/?session=${sessionId}`;
    return { url: session.url, sessionId, editorUrl };
  }

  async closePreview(req: { sessionId: string }): Promise<void> {
    await this.supervisor.stop(req.sessionId);
    this.editPipelines.delete(req.sessionId);
  }

  async getStatus(): Promise<{ daemonVersion: string; uptime: number; activePreviews: number; workerHealth: Record<string, 'ok' | 'degraded' | 'down'> }> {
    return {
      daemonVersion: DAEMON_VERSION,
      uptime: Date.now() - this.startedAt,
      activePreviews: this.supervisor.list().length,
      workerHealth: {},
    };
  }

  async rollback(req: { commitId: string }): Promise<void> {
    const log = readCommitLog(this.opts.root);
    const entry = log.find((e) => e.commitId === req.commitId && e.kind === 'commit');
    if (!entry) throw new Error(`unknown commitId ${req.commitId}`);
    // Find the pipeline whose file matches.
    for (const pipeline of this.editPipelines.values()) {
      if (pipeline.getFilePath() === entry.filePath) {
        await pipeline.rollback(req.commitId);
        return;
      }
    }
    // No active pipeline — perform a one-shot rollback.
    await codeModsRollback({ root: this.opts.root, commitId: req.commitId });
  }
}

function filterEnv(raw: NodeJS.ProcessEnv, prefixes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && prefixes.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}
