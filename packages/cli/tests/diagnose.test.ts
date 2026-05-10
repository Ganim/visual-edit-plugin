import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDiagnose } from '../src/diagnose.js';
import AdmZip from 'adm-zip';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-cli-diag-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('runDiagnose', () => {
  it('produces a zip containing logs/<date>/daemon.log; excludes raw-logs by default', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/logs', today, 'daemon.log'), 'line1\nline2\n', 'utf8');
    mkdirSync(join(tmp, '.visual-edit/raw-logs'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/raw-logs/secret.log'), 'shhh', 'utf8');

    const outPath = join(tmp, 'out.zip');
    await runDiagnose({ root: tmp, since: null, includeRaw: false, output: outPath });
    expect(existsSync(outPath)).toBe(true);

    const zip = new AdmZip(outPath);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.includes('daemon.log'))).toBe(true);
    expect(names.some((n) => n.includes('raw-logs'))).toBe(false);
  });

  it('--include-raw includes raw-logs/', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/logs', today, 'daemon.log'), 'x\n', 'utf8');
    mkdirSync(join(tmp, '.visual-edit/raw-logs'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/raw-logs/raw.log'), 'r', 'utf8');

    const outPath = join(tmp, 'out.zip');
    await runDiagnose({ root: tmp, since: null, includeRaw: true, output: outPath });
    const zip = new AdmZip(outPath);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.includes('raw-logs'))).toBe(true);
  });
});
