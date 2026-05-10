import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { DaemonClient } from '../src/daemonClient.js';

describe('DaemonClient', () => {
  it('openPreview POSTs to /preview', async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: 'http://x:1', sessionId: 'abc', editorUrl: 'http://x/__editor/?session=abc' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const client = new DaemonClient(`http://127.0.0.1:${port}`);
      const result = await client.openPreview({ root: '/r', page: 'src/X.tsx' });
      expect(result.url).toBe('http://x:1');
      expect(result.sessionId).toBe('abc');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('throws on non-2xx', async () => {
    const server = createServer((_, res) => { res.statusCode = 500; res.end('{"error":"boom"}'); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const client = new DaemonClient(`http://127.0.0.1:${port}`);
      await expect(client.openPreview({ root: '/r', page: 'src/X.tsx' })).rejects.toThrow(/500/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
