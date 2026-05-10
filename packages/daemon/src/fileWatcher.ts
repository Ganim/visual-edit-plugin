import { EventEmitter } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';

export interface ExternalChange {
  filePath: string;
  sha256: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Watches user-source files. Dedups self-writes via a hash set so commits the daemon performed
 * itself don't fire `external-change` events. Reconciliation rescan every 5s catches lossy
 * chokidar events on Windows.
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private watched = new Set<string>();
  private recentWrites = new Map<string, Set<string>>();   // filePath → set of recent sha256
  private lastSeenSha = new Map<string, string>();          // filePath → sha last reported
  private reconcileTimer: NodeJS.Timeout | null = null;

  async watch(filePath: string): Promise<void> {
    this.watched.add(filePath);
    if (existsSync(filePath)) this.lastSeenSha.set(filePath, sha(readFileSync(filePath, 'utf8')));
    if (!this.watcher) {
      // Watch the file directly so chokidar initializes immediately and fires 'ready'.
      // Watching an empty array never fires 'ready' on Windows, leaving the watcher inert.
      this.watcher = chokidar.watch(filePath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } });
      this.watcher.on('change', (changedPath) => this.handleChange(changedPath));
      this.startReconciliation();
      await new Promise<void>((resolve) => this.watcher!.on('ready', resolve));
    } else {
      this.watcher.add(filePath);
    }
  }

  /** Register a sha that the daemon itself just wrote. Future events with this sha are ignored. */
  registerSelfWrite(filePath: string, sha256: string): void {
    if (!this.recentWrites.has(filePath)) this.recentWrites.set(filePath, new Set());
    this.recentWrites.get(filePath)!.add(sha256);
    // GC after 5s — long enough to outlive event delivery.
    setTimeout(() => this.recentWrites.get(filePath)?.delete(sha256), 5000).unref();
  }

  async close(): Promise<void> {
    if (this.reconcileTimer) { clearInterval(this.reconcileTimer); this.reconcileTimer = null; }
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
    this.watched.clear();
    this.recentWrites.clear();
    this.lastSeenSha.clear();
  }

  private handleChange(filePath: string): void {
    if (!this.watched.has(filePath) || !existsSync(filePath)) return;
    const newSha = sha(readFileSync(filePath, 'utf8'));
    if (this.recentWrites.get(filePath)?.has(newSha)) return;            // self-write
    if (this.lastSeenSha.get(filePath) === newSha) return;                // no actual change
    this.lastSeenSha.set(filePath, newSha);
    this.emit('external-change', { filePath, sha256: newSha } as ExternalChange);
  }

  private startReconciliation(): void {
    this.reconcileTimer = setInterval(() => {
      for (const filePath of this.watched) {
        if (!existsSync(filePath)) continue;
        const newSha = sha(readFileSync(filePath, 'utf8'));
        if (this.recentWrites.get(filePath)?.has(newSha)) continue;
        if (this.lastSeenSha.get(filePath) === newSha) continue;
        this.lastSeenSha.set(filePath, newSha);
        this.emit('external-change', { filePath, sha256: newSha } as ExternalChange);
      }
    }, 5000).unref?.();
  }
}
