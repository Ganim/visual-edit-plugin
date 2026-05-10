import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer } from '../src/http.js';
import { QueueManager } from '../src/queue/queueManager.js';
import { _resetSeqCache } from '../src/queue/wal.js';

let tmp: string;
let qm: QueueManager;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-qhttp-')); _resetSeqCache(); qm = new QueueManager(tmp); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('queue HTTP routes', () => {
  it('POST /drain-ask-ai returns leased items', async () => {
    qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'hi' });
    const server = createHttpServer({
      openPreview: async () => { throw new Error('unused'); },
      closePreview: async () => undefined,
      getStatus: async () => ({ daemonVersion: '0', uptime: 0, activePreviews: 0, workerHealth: {} }),
      rollback: async () => undefined,
      drainAskAI: async () => ({ items: qm.drain().items, leases: qm.drain().leases }), // last drain wins (test-only oddity)
      resolveAskAI: async (req) => { qm.resolve(req); },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const resp = await fetch(`http://127.0.0.1:${port}/drain-ask-ai`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(Array.isArray(body.items)).toBe(true);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('POST /resolve-ask-ai validates the body via Zod', async () => {
    const server = createHttpServer({
      openPreview: async () => { throw new Error('unused'); },
      closePreview: async () => undefined,
      getStatus: async () => ({ daemonVersion: '0', uptime: 0, activePreviews: 0, workerHealth: {} }),
      rollback: async () => undefined,
      drainAskAI: async () => ({ items: [], leases: {} }),
      resolveAskAI: async () => undefined,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const resp = await fetch(`http://127.0.0.1:${port}/resolve-ask-ai`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ askId: 'a', leaseId: 'l', outcome: 'committed', summary: 's' }),
    });
    expect(resp.status).toBe(204);
    await new Promise<void>((r) => server.close(() => r()));
  });
});
