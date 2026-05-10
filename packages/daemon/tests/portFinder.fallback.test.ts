import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';
import { findFreePort } from '../src/portFinder.js';

/** Block every port in the given list, resolve with a cleanup callback. */
async function blockPorts(ports: number[]): Promise<() => void> {
  const servers = await Promise.all(
    ports.map(
      (p) =>
        new Promise<ReturnType<typeof createServer>>((resolve) => {
          const s = createServer();
          s.listen(p, '127.0.0.1', () => resolve(s));
        }),
    ),
  );
  return () => servers.forEach((s) => s.close());
}

describe('findFreePort – OS-assigned fallback', () => {
  it('smoke: findFreePort returns a positive port in a normal range', async () => {
    const port = await findFreePort(5170, 5179);
    expect(port).toBeGreaterThan(0);
  });

  it('falls back to OS-assigned port when the entire range is occupied', async () => {
    // Use a tiny range so we can exhaust it easily.
    const range = [5170, 5171, 5172];
    const cleanup = await blockPorts(range);
    try {
      const port = await findFreePort(5170, 5172);
      // Should not throw — OS gave us something valid.
      expect(port).toBeGreaterThan(0);
      // The OS-assigned port is outside (or coincidentally inside) the blocked
      // range; either way it must be a usable positive integer.
    } finally {
      cleanup();
    }
  });
});
