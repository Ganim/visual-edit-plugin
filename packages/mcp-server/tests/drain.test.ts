import { describe, it, expect, vi } from 'vitest';
import { DaemonClient } from '../src/daemonClient.js';

describe('DaemonClient.drainAskAI', () => {
  it('POSTs to /drain-ask-ai with empty body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], leases: {} }) } as never);
    const c = new DaemonClient('http://127.0.0.1:1234');
    const r = await c.drainAskAI();
    expect(r).toEqual({ items: [], leases: {} });
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:1234/drain-ask-ai', expect.objectContaining({ method: 'POST', body: '{}' }));
    fetchSpy.mockRestore();
  });
});
