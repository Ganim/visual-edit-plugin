import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileWatcher } from '../src/fileWatcher.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-fw-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('FileWatcher', () => {
  it('emits "external-change" when watched file is modified by another process', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'V1', 'utf8');
    const fw = new FileWatcher();
    const events: { filePath: string; sha256: string }[] = [];
    fw.on('external-change', (e) => events.push(e));
    await fw.watch(file);
    writeFileSync(file, 'V2', 'utf8');
    await wait(1500);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.sha256).toBe(sha('V2'));
    await fw.close();
  });

  it('does NOT emit when our own commit registered the new sha first (recent-writes dedup)', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'V1', 'utf8');
    const fw = new FileWatcher();
    const events: unknown[] = [];
    fw.on('external-change', (e) => events.push(e));
    await fw.watch(file);
    fw.registerSelfWrite(file, sha('V2'));
    writeFileSync(file, 'V2', 'utf8');
    await wait(1500);
    expect(events).toHaveLength(0);
    await fw.close();
  });
});
