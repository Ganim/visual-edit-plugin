import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStartupSnapshot } from '../src/startupSnapshot.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-ss-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('writeStartupSnapshot', () => {
  it('writes startup.json with required fields', () => {
    const snap = writeStartupSnapshot(tmp, { daemonVersion: '0.1.0' });
    expect(snap.daemonVersion).toBe('0.1.0');
    expect(snap.pid).toBe(process.pid);
    expect(snap.nodeVersion).toBe(process.version);
    expect(snap.platform).toBe(process.platform);

    const today = new Date().toISOString().slice(0, 10);
    const path = join(tmp, '.visual-edit/logs', today, 'startup.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.daemonVersion).toBe('0.1.0');
  });
});
