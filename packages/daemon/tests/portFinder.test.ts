import { describe, it, expect } from 'vitest';
import { findFreePort } from '../src/portFinder.js';
import { createServer } from 'node:net';

describe('findFreePort', () => {
  it('returns a port in the configured range', async () => {
    const port = await findFreePort(5180, 5200);
    expect(port).toBeGreaterThanOrEqual(5180);
    expect(port).toBeLessThanOrEqual(5200);
  });

  it('skips ports already in use', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(5180, '127.0.0.1', r));
    try {
      const port = await findFreePort(5180, 5200);
      expect(port).not.toBe(5180);
      expect(port).toBeGreaterThanOrEqual(5181);
    } finally {
      blocker.close();
    }
  });

  it('throws VE_PREVIEW_003 when all ports busy', async () => {
    // Block all ports in a tiny range.
    const blockers = await Promise.all([5180, 5181].map((p) => {
      return new Promise<{ close: () => void }>((res) => {
        const s = createServer();
        s.listen(p, '127.0.0.1', () => res(s));
      });
    }));
    try {
      await expect(findFreePort(5180, 5181)).rejects.toThrow(/VE_PREVIEW_003/);
    } finally {
      for (const b of blockers) b.close();
    }
  });
});
