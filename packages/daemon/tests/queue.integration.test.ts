// packages/daemon/tests/queue.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from '../src/daemon.js';
import { _resetSeqCache } from '../src/queue/wal.js';
import { WebSocket } from 'ws';

let tmp: string;
let daemon: Daemon;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 've-qint-'));
  _resetSeqCache();
  // Minimal seed project so analyze() doesn't crash.
  mkdirSync(join(tmp, 'src', 'pages'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'seed', dependencies: { vite: '5.4.0' } }));
  writeFileSync(join(tmp, 'src/pages/Home.tsx'), 'export default () => <div>hi</div>;\n');
  daemon = new Daemon({ root: tmp });
  await daemon.start();
});
afterEach(async () => {
  await daemon.stop();
  rmSync(tmp, { recursive: true, force: true });
  _resetSeqCache();
});

describe('queue HTTP integration', () => {
  it('drain returns nothing when queue is empty; after enqueue+drain+resolve, broadcast reaches the WS client', async () => {
    const port = daemon.getPort()!;
    const drainEmpty = await fetch(`http://127.0.0.1:${port}/drain-ask-ai`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    const empty = await drainEmpty.json();
    expect(empty.items).toEqual([]);

    // Enqueue via the daemon's QueueManager API (no preview session needed for this test).
    const queue = (daemon as unknown as { queue: import('../src/queue/queueManager.js').QueueManager }).queue;
    queue.enqueue({ element: 'v1', filePath: '/x.tsx', prompt: 'hi' });

    // Connect a WS client without sending hello — we'll skip the snapshot path and just listen.
    // Note: in the current ws.ts handler, broadcast goes to all wss.clients regardless of hello.
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => client.once('open', () => r()));
    const got: unknown[] = [];
    client.on('message', (raw) => got.push(JSON.parse(raw.toString())));

    // Drain via HTTP.
    const drainResp = await fetch(`http://127.0.0.1:${port}/drain-ask-ai`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    const drainBody = await drainResp.json();
    expect(drainBody.items).toHaveLength(1);
    const askId = drainBody.items[0].askId as string;
    const leaseId = drainBody.leases[askId] as string;

    // Resolve via HTTP.
    const resolveResp = await fetch(`http://127.0.0.1:${port}/resolve-ask-ai`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ askId, leaseId, outcome: 'committed', summary: 'ok' }),
    });
    expect(resolveResp.status).toBe(204);

    // Wait briefly for broadcast.
    await new Promise<void>((r) => setTimeout(r, 100));
    const resolved = got.find((m) => (m as { kind: string }).kind === 'ask-ai-resolved');
    expect(resolved).toBeDefined();
    client.close();
  }, 30_000);
});
