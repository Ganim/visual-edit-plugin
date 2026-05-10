import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResetQueue } from '../src/reset-queue.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-cli-rq-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('runResetQueue', () => {
  it('removes WAL and snapshot files', () => {
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/queue.wal'), 'old');
    writeFileSync(join(tmp, '.visual-edit/queue-snapshot.json'), '{}');
    const r = runResetQueue({ root: tmp, yes: true });
    expect(r.removed).toHaveLength(2);
    expect(existsSync(join(tmp, '.visual-edit/queue.wal'))).toBe(false);
    expect(existsSync(join(tmp, '.visual-edit/queue-snapshot.json'))).toBe(false);
  });

  it('does not throw when files are absent', () => {
    const r = runResetQueue({ root: tmp, yes: true });
    expect(r.removed).toEqual([]);
  });
});
