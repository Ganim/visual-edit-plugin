import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLock, readLock, removeLock } from '../src/lockFile.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 've-lock-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('lockFile', () => {
  it('writeLock creates .visual-edit/daemon.lock with pid + port + version', async () => {
    await writeLock(workdir, { pid: 1234, port: 5180, daemonVersion: '0.0.0' });
    const path = join(workdir, '.visual-edit', 'daemon.lock');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.pid).toBe(1234);
    expect(parsed.port).toBe(5180);
    expect(parsed.daemonVersion).toBe('0.0.0');
    expect(typeof parsed.startedAt).toBe('string');
  });

  it('readLock returns null when file is absent', async () => {
    const result = await readLock(workdir);
    expect(result).toBeNull();
  });

  it('readLock returns the parsed lock when present', async () => {
    await writeLock(workdir, { pid: 99, port: 5199, daemonVersion: '0.0.0' });
    const result = await readLock(workdir);
    expect(result?.pid).toBe(99);
  });

  it('removeLock deletes the file', async () => {
    await writeLock(workdir, { pid: 1, port: 5180, daemonVersion: '0.0.0' });
    await removeLock(workdir);
    expect(await readLock(workdir)).toBeNull();
  });
});
