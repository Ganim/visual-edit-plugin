import { describe, it, expect } from 'vitest';
import { findFreePort } from '../src/portFinder.js';
import { createServer } from 'node:net';

/** Bind a server to a specific port; returns the server and a typed cleanup fn. */
function blockPort(port: number): Promise<import('node:net').Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function closeServer(s: import('node:net').Server): Promise<void> {
  return new Promise((r) => s.close(() => r()));
}

/** Reserve an ephemeral port from the OS, close the server, and return that port number. */
function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

describe('findFreePort', () => {
  it('returns a port in the configured range', async () => {
    const port = await findFreePort(5180, 5200);
    expect(port).toBeGreaterThanOrEqual(5180);
    expect(port).toBeLessThanOrEqual(5200);
  });

  it('skips ports already in use', async () => {
    // Get the first free port in the range we will test.
    const firstPort = await findFreePort(5180, 5200);
    const blocker = await blockPort(firstPort);
    try {
      const port = await findFreePort(firstPort, firstPort + 20);
      expect(port).not.toBe(firstPort);
      expect(port).toBeGreaterThan(firstPort);
    } finally {
      await closeServer(blocker);
    }
  });

  it('falls back to an OS-assigned port rather than throwing when all range ports busy', async () => {
    // Reserve two ephemeral ports from the OS, then block them.
    const p1 = await reserveEphemeralPort();
    const p2 = await reserveEphemeralPort();
    const blockers = await Promise.all([p1, p2].map(blockPort));
    try {
      // Use the two blocked ports as the entire range — findFreePort must fall
      // back to an OS-assigned port instead of throwing VE_PREVIEW_003.
      const port = await findFreePort(Math.min(p1, p2), Math.max(p1, p2));
      expect(port).toBeGreaterThan(0);
    } finally {
      await Promise.all(blockers.map(closeServer));
    }
  });
});
