import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueManager } from '../src/queue/queueManager.js';
import { LeaseTimer } from '../src/queue/leaseTimer.js';
import { _resetSeqCache } from '../src/queue/wal.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-lt-')); _resetSeqCache(); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('LeaseTimer', () => {
  it('reverts expired leases on tick', async () => {
    const qm = new QueueManager(tmp, { leaseTtlMs: 1 });
    const it = qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'hi' });
    qm.drain();  // leases it
    expect(qm.list().find((i) => i.askId === it.askId)!.state).toBe('leased');

    // Wait past TTL.
    await new Promise((r) => setTimeout(r, 10));

    const timer = new LeaseTimer(qm, 30);
    timer.start();
    await new Promise((r) => setTimeout(r, 80));
    timer.stop();

    expect(qm.list().find((i) => i.askId === it.askId)!.state).toBe('pending');
  });
});
