import { describe, it, expect, vi } from 'vitest';
import { DaemonClient } from '../src/daemonClient.js';

describe('DaemonClient.resolveAskAI', () => {
  it('POSTs to /resolve-ask-ai with the request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as never);
    const c = new DaemonClient('http://127.0.0.1:1234');
    await c.resolveAskAI({ askId: 'a1', leaseId: 'l1', outcome: 'committed', summary: 'ok' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/resolve-ask-ai',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ askId: 'a1', leaseId: 'l1', outcome: 'committed', summary: 'ok' }),
      }),
    );
    fetchSpy.mockRestore();
  });
});
