import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendWalEntry, readWalEntries, _resetSeqCache } from '../src/queue/wal.js';
import type { WalEntry } from '../src/queue/types.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-wal-')); _resetSeqCache(); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('wal', () => {
  it('appends entries with monotonic seq + sha256 + version 1', () => {
    appendWalEntry(tmp, { op: 'enqueue', askId: 'a1', element: 'v1', filePath: '/x.tsx', prompt: 'hi', timestamp: 't1' });
    appendWalEntry(tmp, { op: 'lease', askId: 'a1', leaseId: 'l1', expiresAt: 't2', timestamp: 't2' });
    const entries = readWalEntries(tmp);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.seq).toBe(1);
    expect(entries[1]!.seq).toBe(2);
    expect(entries[0]!.version).toBe('1');
    expect(entries[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects corrupted entry via sha mismatch — readWalEntries stops at last valid seq', () => {
    appendWalEntry(tmp, { op: 'enqueue', askId: 'a1', element: 'v1', filePath: '/x.tsx', prompt: 'hi', timestamp: 't' });
    appendWalEntry(tmp, { op: 'enqueue', askId: 'a2', element: 'v2', filePath: '/x.tsx', prompt: 'hi', timestamp: 't' });
    // Corrupt the second line.
    const path = join(tmp, '.visual-edit', 'queue.wal');
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n').filter((s) => s.length > 0);
    const corrupted = JSON.parse(lines[1]!) as WalEntry;
    // Tamper the op's timestamp so the sha256 no longer matches.
    (corrupted.op as Record<string, unknown>)['timestamp'] = 'TAMPERED';
    // Re-write with mismatched sha (don't recompute).
    const file2 = lines[0]! + '\n' + JSON.stringify(corrupted) + '\n';
    writeFileSync(path, file2, 'utf8');
    const entries = readWalEntries(tmp);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.op.op).toBe('enqueue');
  });

  it('refuses to read entries with unknown version', () => {
    const path = join(tmp, '.visual-edit', 'queue.wal');
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(path, JSON.stringify({ seq: 1, version: '2', sha256: 'x', timestamp: 't', op: { op: 'enqueue', askId: 'a', element: 'v', filePath: '/f.tsx', prompt: 'p', timestamp: 't' } }) + '\n', 'utf8');
    expect(() => readWalEntries(tmp)).toThrow(/VE_QUEUE_005/);
  });
});
