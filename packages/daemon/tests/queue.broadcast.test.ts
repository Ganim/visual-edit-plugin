import { describe, it, expect } from 'vitest';
import { broadcastAskAIResolved, attachWebSocket } from '../src/ws.js';
import { QueueManager } from '../src/queue/queueManager.js';
import { _resetSeqCache } from '../src/queue/wal.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';

describe('broadcastAskAIResolved', () => {
  it('reaches all connected clients', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 've-qbc-')); _resetSeqCache();
    try {
      const http = createServer();
      await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
      const port = (http.address() as { port: number }).port;
      const queue = new QueueManager(tmp);
      const session = { id: 's1', url: 'http://x', pageRef: { route: '/', filePath: '/x.tsx', isClientOnly: true, cssImports: [] }, startedAt: '', status: 'ready' as const };
      const pipeline = { getSnapshot: async () => ({ sourceText: '', sourceMap: {} }), getFilePath: () => '/x.tsx' } as unknown as import('../src/editPipeline.js').EditPipeline;
      const wss = attachWebSocket(http, {
        getSession: (id) => (id === 's1' ? session : null),
        getPipeline: (id) => (id === 's1' ? pipeline : null),
        getQueue: () => queue,
        daemonPort: () => port,
      });
      const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await new Promise<void>((r) => client.once('open', () => r()));
      client.send(JSON.stringify({ kind: 'hello', version: '1.0', sessionId: 's1' }));
      await new Promise<void>((r) => client.once('message', () => r())); // snapshot
      const got: unknown[] = [];
      client.on('message', (raw) => got.push(JSON.parse(raw.toString())));
      broadcastAskAIResolved(wss, { sessionId: '*', askId: 'a1', outcome: 'committed', summary: 'ok' });
      await new Promise<void>((r) => setTimeout(r, 50));
      expect(got.find((m) => (m as { kind: string }).kind === 'ask-ai-resolved')).toBeDefined();
      client.close();
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
