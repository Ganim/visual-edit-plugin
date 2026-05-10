// packages/daemon/tests/queue.manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueManager } from '../src/queue/queueManager.js';
import { _resetSeqCache } from '../src/queue/wal.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-qm-')); _resetSeqCache(); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('QueueManager', () => {
  it('enqueue creates a pending item with a random askId', () => {
    const qm = new QueueManager(tmp);
    const item = qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'hi' });
    expect(item.state).toBe('pending');
    expect(item.askId).toMatch(/^[a-f0-9]{8}$/);
  });

  it('drain leases pending items and returns them with leases', () => {
    const qm = new QueueManager(tmp);
    qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'one' });
    qm.enqueue({ element: 'v2', filePath: '/p.tsx', prompt: 'two' });
    const { items, leases } = qm.drain();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.state === 'leased')).toBe(true);
    expect(Object.keys(leases)).toHaveLength(2);
  });

  it('resolve transitions leased → resolved with the lease guard', () => {
    const qm = new QueueManager(tmp);
    const it = qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'hi' });
    const { leases } = qm.drain();
    const resolved = qm.resolve({ askId: it.askId, leaseId: leases[it.askId]!, outcome: 'committed', summary: 'ok', commitId: 'c1' });
    expect(resolved.state).toBe('resolved');
    expect(resolved.commitId).toBe('c1');
  });

  it('resolve refuses with wrong leaseId', () => {
    const qm = new QueueManager(tmp);
    const it = qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'hi' });
    qm.drain();
    expect(() => qm.resolve({ askId: it.askId, leaseId: 'WRONG', outcome: 'committed', summary: '' })).toThrow(/lease/);
  });

  it('drain reverts expired leases before returning items', () => {
    const qm = new QueueManager(tmp, { leaseTtlMs: 1 });
    const it = qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'hi' });
    qm.drain();
    // Wait past the 1ms TTL.
    return new Promise<void>((r) => setTimeout(() => {
      const { items } = qm.drain();
      expect(items.find((i) => i.askId === it.askId)!.state).toBe('leased');
      // First drain expired the original lease (lease-expired); second drain leased it again.
      r();
    }, 10));
  });

  it('persists across restart via WAL replay', () => {
    const qm1 = new QueueManager(tmp);
    qm1.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'first' });
    const qm2 = new QueueManager(tmp);
    expect(qm2.list().filter((i) => i.state === 'pending')).toHaveLength(1);
  });
});
