import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from '../src/daemon.js';
import { _resetSeqCache } from '../src/queue/wal.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-ms-'));
  _resetSeqCache();
  // Minimal seed project.
  mkdirSync(join(tmp, 'src/pages'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 's', dependencies: { vite: '5.4.0' } }));
  writeFileSync(join(tmp, 'src/pages/Home.tsx'), 'export default () => <div />;\n');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('Daemon.start multi-session', () => {
  it('first daemon binds; second daemon in connect-only mode discovers it', async () => {
    const d1 = new Daemon({ root: tmp });
    await d1.start();
    expect(d1.getMode()).toBe('bound');

    const d2 = new Daemon({ root: tmp, mode: 'connect-only' });
    await d2.start();
    expect(d2.getMode()).toBe('connected');
    expect(d2.getPort()).toBe(d1.getPort());

    await d1.stop();
    await d2.stop();
  }, 30_000);

  it('takeover when lock is stale and pid is dead', async () => {
    // Write a stale lock manually pointing at a dead pid.
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/daemon.lock'), JSON.stringify({
      pid: 99999, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date(Date.now() - 60_000).toISOString(),
      stateHash: 'a'.repeat(64), version: '1',
    }));
    const d = new Daemon({ root: tmp });
    await d.start();
    expect(d.getMode()).toBe('took-over');
    await d.stop();
  }, 30_000);
});
