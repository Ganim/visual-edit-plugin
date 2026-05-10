import { describe, it, expect, vi } from 'vitest';
import { placeholder, passThrough, cached, dispatchStrategy } from '../src/strategies.js';

describe('asset strategies', () => {
  it('placeholder returns a 1x1 SVG', async () => {
    const r = await placeholder();
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/svg+xml');
    expect(typeof r.body === 'string' && r.body.includes('<svg')).toBe(true);
  });

  it('pass-through fetches upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
      headers: { get: () => 'image/png' },
    } as unknown as Response);
    const r = await passThrough({ url: 'http://x/a.png', cache: new Map() });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/png');
    fetchSpy.mockRestore();
  });

  it('cached caches successful responses; second call hits the cache', async () => {
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return {
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => 'image/jpeg' },
      } as unknown as Response;
    });
    const cache = new Map();
    await cached({ url: 'http://x/b.jpg', cache });
    await cached({ url: 'http://x/b.jpg', cache });
    expect(callCount).toBe(1);
    fetchSpy.mockRestore();
  });

  it('dispatchStrategy throws on unknown strategy', async () => {
    await expect(
      dispatchStrategy('bogus' as never, { url: 'http://x', cache: new Map() }),
    ).rejects.toThrow(/VE_ASSET_001/);
  });

  describe('SSRF guard', () => {
    it('pass-through blocks loopback URLs (127.0.0.1)', async () => {
      const r = await passThrough({ url: 'http://127.0.0.1:6379/', cache: new Map() });
      expect(r.status).toBe(403);
      expect(r.body).toMatch(/blocked unsafe URL/);
    });

    it('pass-through blocks localhost URLs', async () => {
      const r = await passThrough({ url: 'http://localhost:8080/secret', cache: new Map() });
      expect(r.status).toBe(403);
    });

    it('pass-through blocks RFC-1918 (192.168.x.x)', async () => {
      const r = await passThrough({ url: 'http://192.168.1.1/', cache: new Map() });
      expect(r.status).toBe(403);
    });

    it('pass-through blocks link-local (169.254.x.x)', async () => {
      const r = await passThrough({ url: 'http://169.254.169.254/latest/meta-data/', cache: new Map() });
      expect(r.status).toBe(403);
    });

    it('cached blocks loopback URLs', async () => {
      const r = await cached({ url: 'http://127.0.0.1:6379/', cache: new Map() });
      expect(r.status).toBe(403);
    });

    it('pass-through allows public URLs (does not block)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(4),
        headers: { get: () => 'image/png' },
      } as unknown as Response);
      const r = await passThrough({ url: 'https://example.com/image.png', cache: new Map() });
      expect(r.status).toBe(200);
      fetchSpy.mockRestore();
    });
  });
});
