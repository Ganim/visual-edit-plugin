import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, FileSink } from '../src/index.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-fs-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('Logger with fsRoot', () => {
  it('writes NDJSON lines to .visual-edit/logs/<date>/daemon.log', () => {
    const logger = new Logger({ fsRoot: tmp });
    logger.info('hi', { sessionId: 's1' });
    logger.warn('uh', { sessionId: 's1' });
    const today = new Date().toISOString().slice(0, 10);
    const path = join(tmp, '.visual-edit/logs', today, 'daemon.log');
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.ts).toBeDefined();
      expect(parsed.level).toBeDefined();
      expect(parsed.msg).toBeDefined();
    }
  });
});

describe('FileSink standalone', () => {
  it('pathFor returns the dated path', () => {
    const sink = new FileSink({ root: tmp });
    const path = sink.pathFor(new Date('2026-05-10T00:00:00Z'));
    expect(path).toContain('2026-05-10');
    expect(path).toContain('daemon.log');
  });
});
