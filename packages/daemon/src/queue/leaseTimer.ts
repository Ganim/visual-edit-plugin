import type { QueueManager } from './queueManager.js';

const DEFAULT_INTERVAL_MS = 60_000;

export class LeaseTimer {
  private timer: NodeJS.Timeout | null = null;

  constructor(private queue: QueueManager, private intervalMs: number = DEFAULT_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this.queue.expireStaleLeases(); }
      catch { /* swallow — we don't want this timer to crash the daemon */ }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
