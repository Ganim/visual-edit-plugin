import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideLockAction } from '../src/lockTakeover.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-lt-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeLockRaw(data: object): void {
  mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
  writeFileSync(join(tmp, '.visual-edit/daemon.lock'), JSON.stringify(data), 'utf8');
}

describe('decideLockAction', () => {
  it('returns "bind" when no lock exists', async () => {
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('bind');
  });

  it('returns "takeover" when lock heartbeat is older than 30s', async () => {
    writeLockRaw({
      pid: 99999, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date(Date.now() - 60_000).toISOString(),
      stateHash: 'a'.repeat(64), version: '1',
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('takeover');
  });

  it('returns "takeover" when lock pid is dead', async () => {
    writeLockRaw({
      pid: 99999, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date().toISOString(),  // fresh heartbeat
      stateHash: 'a'.repeat(64), version: '1',
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('takeover');  // pid 99999 is unlikely to be alive
  });

  it('returns "connect" when heartbeat fresh AND pid is alive', async () => {
    writeLockRaw({
      pid: process.pid, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date().toISOString(),
      stateHash: 'a'.repeat(64), version: '1',
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('connect');
    expect((decision as { kind: 'connect'; url: string }).url).toBe('http://127.0.0.1:5170');
  });

  it('returns "refuse" on unknown version', async () => {
    writeLockRaw({
      pid: process.pid, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date().toISOString(),
      stateHash: 'a'.repeat(64), version: '2',  // unknown
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('refuse');
  });
});
