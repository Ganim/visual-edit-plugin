import { describe, it, expect, vi } from 'vitest';
import { DaemonClient } from '../src/daemonClient.js';

describe('DaemonClient.rollback', () => {
  it('POSTs to /rollback', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);
    const c = new DaemonClient('http://127.0.0.1:1234');
    await c.rollback('aabbccdd');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/rollback',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ commitId: 'aabbccdd' }),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('throws on non-204 error status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    } as Response);
    const c = new DaemonClient('http://127.0.0.1:1234');
    await expect(c.rollback('aabbccdd')).rejects.toThrow(/500/);
    fetchSpy.mockRestore();
  });
});
