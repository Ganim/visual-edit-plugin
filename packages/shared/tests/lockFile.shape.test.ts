import { describe, it, expect } from 'vitest';
import type { DaemonLockData } from '../src/lockFile.js';

describe('DaemonLockData shape (v2)', () => {
  it('accepts the extended shape with heartbeat + stateHash', () => {
    const ok: DaemonLockData = {
      pid: 1234,
      port: 5170,
      daemonVersion: '0.0.0',
      startedAt: '2026-05-10T12:00:00Z',
      heartbeat: '2026-05-10T12:00:05Z',
      stateHash: 'a'.repeat(64),
      version: '1',
    };
    expect(ok.heartbeat).toBeDefined();
    expect(ok.stateHash).toBeDefined();
    expect(ok.version).toBe('1');
  });
});
