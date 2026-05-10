import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDaemonLock } from '@visual-edit/shared';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-as-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('auto-spawn lock probing', () => {
  it('returns null when no lock exists', async () => {
    const lock = await readDaemonLock(tmp);
    expect(lock).toBeNull();
  });

  it('returns a parsed lock when one exists', async () => {
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/daemon.lock'), JSON.stringify({
      pid: 1234, port: 5170, daemonVersion: '0.0.0',
      startedAt: 't', heartbeat: 't', stateHash: 'a'.repeat(64), version: '1',
    }), 'utf8');
    const lock = await readDaemonLock(tmp);
    expect(lock).not.toBeNull();
    expect(lock!.pid).toBe(1234);
    expect(lock!.port).toBe(5170);
  });
});
