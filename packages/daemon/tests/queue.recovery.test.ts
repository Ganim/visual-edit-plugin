import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from '../src/daemon.js';
import { QueueManager } from '../src/queue/queueManager.js';
import { compactWal } from '../src/queue/compaction.js';
import { _resetSeqCache } from '../src/queue/wal.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-rec-'));
  _resetSeqCache();
  // Seed minimal project.
  mkdirSync(join(tmp, 'src/pages'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 's', dependencies: { vite: '5.4.0' } }));
  writeFileSync(join(tmp, 'src/pages/Home.tsx'), 'export default () => <div />;');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('Daemon WAL corrupt recovery', () => {
  it('auto-resets when resetCorruptedQueue is true and snapshot is corrupt', async () => {
    // Create a real compacted snapshot first via QueueManager.
    const qm = new QueueManager(tmp);
    qm.enqueue({ element: 'v1', filePath: '/x.tsx', prompt: 'p' });
    compactWal(tmp, qm.list());
    // Tamper with the snapshot so the sha256 no longer matches — triggers VE_QUEUE_004.
    writeFileSync(join(tmp, '.visual-edit/queue-snapshot.json'), '{"version":"1","items":[]}', 'utf8');
    _resetSeqCache();

    // Without resetCorruptedQueue, construction throws.
    expect(() => new Daemon({ root: tmp })).toThrow(/VE_QUEUE_004/);

    // With resetCorruptedQueue, it constructs cleanly.
    _resetSeqCache();
    const d = new Daemon({ root: tmp, resetCorruptedQueue: true });
    expect(d).toBeDefined();
    // After construction, the queue files should be gone.
    expect(existsSync(join(tmp, '.visual-edit/queue.wal'))).toBe(false);
    expect(existsSync(join(tmp, '.visual-edit/queue-snapshot.json'))).toBe(false);
  });
});
