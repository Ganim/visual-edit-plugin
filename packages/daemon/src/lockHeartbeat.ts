import { updateHeartbeat } from './lockFile.js';

const DEFAULT_INTERVAL_MS = 5_000;

export class LockHeartbeat {
  private timer: NodeJS.Timeout | null = null;

  constructor(private root: string, private intervalMs: number = DEFAULT_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      updateHeartbeat(this.root).catch(() => { /* best effort */ });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
