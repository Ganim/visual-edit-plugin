// packages/daemon/tests/queue.replay.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendWalEntry, _resetSeqCache } from '../src/queue/wal.js';
import { replayWal } from '../src/queue/replay.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-replay-')); _resetSeqCache(); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('replayWal', () => {
  it('rebuilds pending → leased → resolved trajectory', () => {
    appendWalEntry(tmp, { op: 'enqueue', askId: 'a1', element: 'v1', filePath: '/p.tsx', prompt: 'hi', timestamp: 't1' });
    appendWalEntry(tmp, { op: 'lease', askId: 'a1', leaseId: 'L', expiresAt: 't9', timestamp: 't2' });
    appendWalEntry(tmp, { op: 'resolve', askId: 'a1', leaseId: 'L', outcome: 'committed', summary: 'ok', commitId: 'c1', timestamp: 't3' });
    const items = replayWal(tmp);
    expect(items).toHaveLength(1);
    expect(items[0]!.state).toBe('resolved');
    expect(items[0]!.outcome).toBe('committed');
    expect(items[0]!.commitId).toBe('c1');
  });

  it('lease-expired reverts leased → pending', () => {
    appendWalEntry(tmp, { op: 'enqueue', askId: 'a1', element: 'v1', filePath: '/p.tsx', prompt: 'hi', timestamp: 't1' });
    appendWalEntry(tmp, { op: 'lease', askId: 'a1', leaseId: 'L', expiresAt: 't2', timestamp: 't2' });
    appendWalEntry(tmp, { op: 'lease-expired', askId: 'a1', timestamp: 't3' });
    const items = replayWal(tmp);
    expect(items[0]!.state).toBe('pending');
    expect(items[0]!.leaseId).toBeUndefined();
  });

  it('resolve on already-resolved is no-op (idempotent)', () => {
    appendWalEntry(tmp, { op: 'enqueue', askId: 'a1', element: 'v1', filePath: '/p.tsx', prompt: 'hi', timestamp: 't1' });
    appendWalEntry(tmp, { op: 'lease', askId: 'a1', leaseId: 'L', expiresAt: 't9', timestamp: 't2' });
    appendWalEntry(tmp, { op: 'resolve', askId: 'a1', leaseId: 'L', outcome: 'committed', summary: 'ok', timestamp: 't3' });
    appendWalEntry(tmp, { op: 'resolve', askId: 'a1', leaseId: 'L', outcome: 'failed', summary: 'oops', timestamp: 't4' });
    const items = replayWal(tmp);
    expect(items[0]!.outcome).toBe('committed');  // first resolve wins
  });
});
