import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Logger } from '@visual-edit/diagnostics';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { analyze, loadConfig, findRoutes, discoverSchemas } from '@visual-edit/project-analyzer';
import type { ProjectInfo } from '@visual-edit/shared';
import type { AdapterInput } from '@visual-edit/adapter-vite';
import { writeLock, removeLock, readLock } from './lockFile.js';
import { findFreePort } from './portFinder.js';
import { PreviewSupervisor } from './previewSupervisor.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './ws.js';

const DAEMON_VERSION = '0.0.0';

export interface DaemonOptions {
  root: string;
  port?: number;
  logger?: Logger;
}

export class Daemon {
  private supervisor = new PreviewSupervisor();
  private startedAt = Date.now();
  private httpServer?: ReturnType<typeof createHttpServer>;
  private wsServer?: ReturnType<typeof attachWebSocket>;
  private logger: Logger;
  private projectInfo?: ProjectInfo;
  private actualPort?: number;

  constructor(private opts: DaemonOptions) {
    this.logger = opts.logger ?? new Logger();
  }

  /** Resolved port the daemon is actually listening on. Undefined before start(). */
  getPort(): number | undefined { return this.actualPort; }

  async start(): Promise<void> {
    const existing = await readLock(this.opts.root);
    if (existing && isProcessAlive(existing.pid)) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_FS_001_LOCK_HELD,
        message: `daemon already running with pid ${existing.pid} on port ${existing.port}`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'environment',
        hint: 'Stop the other daemon or pick a different project root.',
      }));
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
    });
    this.wsServer = attachWebSocket(this.httpServer, {
      getSession: (id) => this.supervisor.list().find((s) => s.id === id) ?? null,
    });

    await new Promise<void>((r) => this.httpServer!.listen(port, '127.0.0.1', r));
    await writeLock(this.opts.root, { pid: process.pid, port, daemonVersion: DAEMON_VERSION });

    this.logger.info('daemon started', { port, root: this.opts.root, pid: process.pid });

    process.on('SIGTERM', () => this.stop().then(() => process.exit(0)));
    process.on('SIGINT', () => this.stop().then(() => process.exit(0)));
  }

  async stop(): Promise<void> {
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
    await removeLock(this.opts.root);
    this.logger.info('daemon stopped');
  }

  async openPreview(req: { root: string; page: string }): Promise<{ url: string; sessionId: string }> {
    if (!this.projectInfo) throw new Error('daemon not started');
    const matchedPage = this.projectInfo.routes.find((r) => r.route === req.page || r.filePath.endsWith(req.page));
    if (!matchedPage) {
      const alternatives = this.projectInfo.routes.slice(0, 5).map((r) => r.route);
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_002_ROUTE_NOT_FOUND,
        message: `route '${req.page}' not found`,
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
    return { url: session.url, sessionId };
  }

  async closePreview(req: { sessionId: string }): Promise<void> {
    await this.supervisor.stop(req.sessionId);
  }

  async getStatus(): Promise<{ daemonVersion: string; uptime: number; activePreviews: number; workerHealth: Record<string, 'ok' | 'degraded' | 'down'> }> {
    return {
      daemonVersion: DAEMON_VERSION,
      uptime: Date.now() - this.startedAt,
      activePreviews: this.supervisor.list().length,
      workerHealth: {},
    };
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function filterEnv(raw: NodeJS.ProcessEnv, prefixes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && prefixes.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}
