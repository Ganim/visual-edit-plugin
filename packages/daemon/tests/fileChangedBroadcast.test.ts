import { describe, it, expect } from 'vitest';
import { broadcastFileChanged, attachWebSocket } from '../src/ws.js';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';

describe('broadcastFileChanged', () => {
  it('sends a file-changed message to all connected clients for the session', async () => {
    const http = createServer();
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const port = (http.address() as { port: number }).port;

    const session = { id: 's1', url: 'http://x', pageRef: { route: '/', filePath: '/x.tsx', isClientOnly: true, cssImports: [] }, startedAt: '', status: 'ready' as const };
    const pipeline = { getSnapshot: async () => ({ sourceText: '', sourceMap: {} }), getFilePath: () => '/x.tsx' } as unknown as import('../src/editPipeline.js').EditPipeline;
    const wss = attachWebSocket(http, {
      getSession: (id) => (id === 's1' ? session : null),
      getPipeline: (id) => (id === 's1' ? pipeline : null),
      daemonPort: () => port,
      getQueue: () => { throw new Error('getQueue not used in this test'); },
    });

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => client.once('open', () => r()));
    client.send(JSON.stringify({ kind: 'hello', version: '1.0', sessionId: 's1' }));
    await new Promise<void>((r) => client.once('message', () => r())); // snapshot

    const got: unknown[] = [];
    client.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    broadcastFileChanged(wss, { sessionId: 's1', filePath: '/x.tsx', sha256: 'a'.repeat(64), dirtySourceMap: false });
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(got.find((m) => (m as { kind: string }).kind === 'file-changed')).toBeDefined();

    client.close();
    wss.close();
    await new Promise<void>((r) => http.close(() => r()));
  });
});
