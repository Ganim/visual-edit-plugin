import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueManager } from '../src/queue/queueManager.js';
import { _resetSeqCache } from '../src/queue/wal.js';
import { shouldCompact, compactWal, readSnapshot } from '../src/queue/compaction.js';
import { replayWal } from '../src/queue/replay.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cmp-')); _resetSeqCache(); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('WAL compaction', () => {
  it('shouldCompact returns true when entries > threshold', () => {
    const qm = new QueueManager(tmp);
    for (let i = 0; i < 10; i++) qm.enqueue({ element: `v${i}`, filePath: '/p.tsx', prompt: 'x' });
    expect(shouldCompact(tmp, { maxEntries: 5 })).toBe(true);
  });

  it('compactWal writes snapshot and truncates WAL to snapshot-ref entry', () => {
    const qm = new QueueManager(tmp);
    qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'one' });
    qm.enqueue({ element: 'v2', filePath: '/p.tsx', prompt: 'two' });
    const items = qm.list();
    const before = statSync(join(tmp, '.visual-edit/queue.wal')).size;
    compactWal(tmp, items);
    const after = statSync(join(tmp, '.visual-edit/queue.wal')).size;
    expect(after).toBeLessThan(before);
    expect(existsSync(join(tmp, '.visual-edit/queue-snapshot.json'))).toBe(true);

    const snap = readSnapshot(tmp);
    expect(snap).toHaveLength(2);
  });

  it('replay restores from snapshot-ref + applies post-snapshot ops', () => {
    const qm1 = new QueueManager(tmp);
    qm1.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'pre' });
    compactWal(tmp, qm1.list());
    // Reset cache so a new QueueManager is forced to re-replay.
    _resetSeqCache();
    const qm2 = new QueueManager(tmp);
    qm2.enqueue({ element: 'v2', filePath: '/p.tsx', prompt: 'post' });
    _resetSeqCache();
    const replayed = replayWal(tmp);
    expect(replayed).toHaveLength(2);
    expect(replayed.map((i) => i.element).sort()).toEqual(['v1', 'v2']);
  });

  it('replay refuses on corrupt snapshot sha', () => {
    const qm = new QueueManager(tmp);
    qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'x' });
    compactWal(tmp, qm.list());
    // Tamper with the snapshot file.
    writeFileSync(join(tmp, '.visual-edit/queue-snapshot.json'), '{"version":"1","items":[]}', 'utf8');
    _resetSeqCache();
    expect(() => replayWal(tmp)).toThrow(/VE_QUEUE_004/);
  });
});
