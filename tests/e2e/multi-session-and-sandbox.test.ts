// tests/e2e/multi-session-and-sandbox.test.ts
// Phase 1.D acceptance gate — 4 scenarios:
//   1. Multi-session takeover after stale lock
//   2. Multi-session connect when fresh daemon exists
//   3. WAL compaction round-trip
//   4. vm sandbox rejects fs import
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon, _resetSeqCache, QueueManager, compactWal, replayWal } from '@visual-edit/daemon';
import { loadConfig } from '@visual-edit/project-analyzer';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-1d-'));
  _resetSeqCache();
  // Minimal project structure so analyze() + loadConfig() don't fail on file probing.
  mkdirSync(join(tmp, 'src/pages'), { recursive: true });
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify({ name: 'seed', dependencies: { vite: '5.4.0' } }),
  );
  writeFileSync(join(tmp, 'src/pages/Home.tsx'), 'export default () => null;');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  _resetSeqCache();
});

describe('Phase 1.D acceptance', () => {
  it('multi-session takeover after stale lock', async () => {
    // Simulate a stale daemon by writing a lock with a dead pid + old heartbeat.
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(
      join(tmp, '.visual-edit/daemon.lock'),
      JSON.stringify({
        pid: 99999,
        port: 5170,
        daemonVersion: '0',
        startedAt: new Date(Date.now() - 120_000).toISOString(),
        heartbeat: new Date(Date.now() - 60_000).toISOString(),
        stateHash: 'a'.repeat(64),
        version: '1',
      }),
    );

    const d = new Daemon({ root: tmp });
    await d.start();
    expect(d.getMode()).toBe('took-over');
    await d.stop();
  }, 30_000);

  it('multi-session connect when fresh daemon exists', async () => {
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

  it('WAL compaction round-trip', () => {
    const qm = new QueueManager(tmp);
    for (let i = 0; i < 5; i++) {
      qm.enqueue({ element: `v${i}`, filePath: '/p.tsx', prompt: 'x' });
    }
    compactWal(tmp, qm.list());
    _resetSeqCache();
    const replayed = replayWal(tmp);
    expect(replayed).toHaveLength(5);
  });

  it('vm sandbox rejects fs import', async () => {
    writeFileSync(
      join(tmp, 'visual-edit.config.ts'),
      `import fs from 'node:fs'; export default { wrapPage: (c) => c };`,
    );
    await expect(loadConfig(tmp)).rejects.toThrow(/VE_CONFIG_002/);
  });
});
