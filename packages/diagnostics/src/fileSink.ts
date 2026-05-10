import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FileSinkOpts {
  root: string;       // project root
  filename?: string;  // default: 'daemon.log'
}

export class FileSink {
  private filename: string;
  constructor(private opts: FileSinkOpts) {
    this.filename = opts.filename ?? 'daemon.log';
  }

  write(line: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const dir = join(this.opts.root, '.visual-edit', 'logs', today);
    try { mkdirSync(dir, { recursive: true }); } catch { /* race-tolerant */ }
    try { appendFileSync(join(dir, this.filename), line, 'utf8'); }
    catch { /* best-effort: don't crash daemon on log-write failure */ }
  }

  /** Resolves the daily log path for today (or a given date). */
  pathFor(date: Date = new Date()): string {
    const day = date.toISOString().slice(0, 10);
    return join(this.opts.root, '.visual-edit', 'logs', day, this.filename);
  }
}
