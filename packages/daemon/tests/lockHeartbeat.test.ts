import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLock } from '../src/lockFile.js';
import { LockHeartbeat } from '../src/lockHeartbeat.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-hb-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('LockHeartbeat', () => {
  it('updates heartbeat field on each tick', async () => {
    await writeLock(tmp, { pid: process.pid, port: 1, daemonVersion: '0' });
    const before = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    const hb = new LockHeartbeat(tmp, 50); // 50ms ticks for the test
    hb.start();
    await new Promise((r) => setTimeout(r, 150));
    hb.stop();
    const after = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    expect(after).not.toBe(before);
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  });

  it('stop() clears the timer; no further writes', async () => {
    await writeLock(tmp, { pid: process.pid, port: 1, daemonVersion: '0' });
    const hb = new LockHeartbeat(tmp, 30);
    hb.start();
    await new Promise((r) => setTimeout(r, 60));
    hb.stop();
    const stoppedAt = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    await new Promise((r) => setTimeout(r, 100));
    const later = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    expect(later).toBe(stoppedAt);
  });

  it('is resilient to a missing lock file (logs and continues)', async () => {
    const hb = new LockHeartbeat(tmp, 30);
    hb.start();
    await new Promise((r) => setTimeout(r, 100));
    hb.stop();
    // No throw; lock file was never created.
    expect(existsSync(join(tmp, '.visual-edit/daemon.lock'))).toBe(false);
  });
});
