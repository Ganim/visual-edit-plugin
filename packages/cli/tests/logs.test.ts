import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogs } from '../src/logs.js';

let tmp: string;
let logs: string[];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-cli-logs-'));
  logs = [];
  // Replace process.stdout.write capture for the test.
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((line: string) => {
    logs.push(line);
    return true;
  }) as never;
  // Restore in afterEach
  (globalThis as Record<string, unknown>)['__origStdoutWrite'] = orig;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write = (
    globalThis as { __origStdoutWrite: typeof process.stdout.write }
  )['__origStdoutWrite'];
});

describe('runLogs', () => {
  it('filters by --trace', () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    writeFileSync(
      join(tmp, '.visual-edit/logs', today, 'daemon.log'),
      JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'a', traceId: 'aaa' }) +
        '\n' +
        JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'b', traceId: 'bbb' }) +
        '\n',
      'utf8',
    );
    runLogs({ root: tmp, trace: 'aaa', since: null });
    expect(logs.join('').includes('"traceId":"aaa"')).toBe(true);
    expect(logs.join('').includes('"traceId":"bbb"')).toBe(false);
  });

  it('filters by --since (1h drops older entries)', () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    const oldTs = new Date(Date.now() - 7_200_000).toISOString(); // 2h ago
    writeFileSync(
      join(tmp, '.visual-edit/logs', today, 'daemon.log'),
      JSON.stringify({ ts: oldTs, level: 'info', msg: 'old' }) +
        '\n' +
        JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'recent' }) +
        '\n',
      'utf8',
    );
    runLogs({ root: tmp, trace: null, since: '1h' });
    const all = logs.join('');
    expect(all.includes('"msg":"recent"')).toBe(true);
    expect(all.includes('"msg":"old"')).toBe(false);
  });
});
