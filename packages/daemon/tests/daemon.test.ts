import { describe, it, expect } from 'vitest';
import { createHttpServer } from '../src/http.js';

// Real daemon spawn-and-test is in Task 19 (e2e). Here we just test the http handler wiring.
describe('http handlers (unit)', () => {
  it('wires open/close/status endpoints', async () => {
    let opened = false;
    const server = createHttpServer({
      openPreview: async () => { opened = true; return { url: 'http://x', sessionId: 's', editorUrl: 'http://127.0.0.1:5170/__editor/?session=s' }; },
      closePreview: async () => {},
      getStatus: async () => ({ daemonVersion: '0.0.0', uptime: 0, activePreviews: 0, workerHealth: {} }),
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const resp = await fetch(`http://127.0.0.1:${port}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: '/x', page: 'src/X.tsx' }),
    });
    const body = await resp.json();
    expect(opened).toBe(true);
    expect(body).toEqual({ url: 'http://x', sessionId: 's', editorUrl: 'http://127.0.0.1:5170/__editor/?session=s' });

    await new Promise<void>((r) => server.close(() => r()));
  });
});
