import { fork, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import type { AdapterInput } from '@visual-edit/adapter-vite';
import type { IpcMessage } from '@visual-edit/protocol';
import type { PreviewSession } from '@visual-edit/shared';

// __dirname is not defined in ESM; derive from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve to the preview-worker dist entry. From packages/daemon/dist/ → packages/preview-worker/dist/index.js */
function workerEntry(): string {
  return resolve(__dirname, '..', '..', 'preview-worker', 'dist', 'index.js');
}

/**
 * Best-effort cleanup of an ephemeral preview directory.
 * Swallows errors (e.g. permission denied, already removed) — cleanup must not crash the daemon.
 */
export function cleanupPreviewDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore — best-effort
  }
}

export interface SupervisedSession {
  session: PreviewSession;
  child: ChildProcess;
  previewDir: string;
}

export class PreviewSupervisor extends EventEmitter {
  private sessions = new Map<string, SupervisedSession>();
  private lastHeartbeat = new Map<string, number>();
  private staleTimer?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.staleTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, last] of this.lastHeartbeat) {
        if (now - last > 15_000) {
          this.lastHeartbeat.delete(sessionId);
          this.emit('preview-stale', sessionId);
        }
      }
    }, 5_000);
    this.staleTimer.unref?.();
  }

  /** Record a heartbeat (or ready) for the given session. */
  public recordHeartbeat(sessionId: string): void {
    this.lastHeartbeat.set(sessionId, Date.now());
  }

  async spawn(sessionId: string, input: AdapterInput): Promise<PreviewSession> {
    const child = fork(workerEntry(), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    });

    child.send({ kind: 'start', adapterInput: input });

    return new Promise<PreviewSession>((resolveSession, rejectSession) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const timeout = setTimeout(() => {
        settle(() => {
          child.kill('SIGTERM');
          rejectSession(new Error(`worker did not become ready within 30s`));
        });
      }, 30_000);

      child.on('message', (raw: unknown) => {
        const msg = raw as IpcMessage;
        if (msg.kind === 'ready') {
          this.recordHeartbeat(sessionId);
          settle(() => {
            clearTimeout(timeout);
            const session: PreviewSession = {
              id: sessionId,
              url: msg.url,
              pageRef: input.page,
              startedAt: new Date().toISOString(),
              status: 'ready',
            };
            const previewDir = msg.ephemeralDir ?? '';
            this.sessions.set(sessionId, { session, child, previewDir });
            resolveSession(session);
          });
        } else if (msg.kind === 'error') {
          settle(() => {
            clearTimeout(timeout);
            rejectSession(new Error(`worker error: ${msg.message}`));
          });
        } else if (msg.kind === 'heartbeat') {
          this.recordHeartbeat(sessionId);
        }
      });

      child.on('exit', (code) => {
        // If exit happens BEFORE 'ready', reject — the caller never got a session.
        // If exit happens AFTER 'ready', mark the existing session crashed.
        settle(() => {
          clearTimeout(timeout);
          rejectSession(new Error(`worker exited with code ${code} before becoming ready`));
        });
        const existing = this.sessions.get(sessionId);
        if (existing) existing.session.status = 'crashed';
      });

      child.on('error', (err) => {
        settle(() => {
          clearTimeout(timeout);
          rejectSession(err);
        });
      });
    });
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.lastHeartbeat.delete(sessionId);
    s.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!s.child.killed) s.child.kill('SIGKILL');
    s.session.status = 'closed';
    this.sessions.delete(sessionId);
    if (s.previewDir) cleanupPreviewDir(s.previewDir);
  }

  list(): PreviewSession[] {
    return [...this.sessions.values()].map((s) => s.session);
  }

  async stopAll(): Promise<void> {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      // exactOptionalPropertyTypes requires delete rather than assigning undefined
      delete (this as unknown as Record<string, unknown>)['staleTimer'];
    }
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }
}
