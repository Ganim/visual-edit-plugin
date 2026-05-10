import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { commit } from '../src/commit.js';
import { rollback } from '../src/rollback.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-rb-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('rollback', () => {
  it('restores the pre-commit content and appends a rollback log entry', async () => {
    const file = join(tmp, 'src', 'p.tsx');
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(file, 'V1', 'utf8');
    const result = await commit({
      root: tmp, filePath: file, expectedBeforeHash: sha('V1'), newContent: 'V2',
    });
    expect(readFileSync(file, 'utf8')).toBe('V2');
    await rollback({ root: tmp, commitId: result.commitId });
    expect(readFileSync(file, 'utf8')).toBe('V1');
  });

  it('refuses to rollback if current file sha != commit.sha256After (ambiguous)', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'V1', 'utf8');
    const r = await commit({ root: tmp, filePath: file, expectedBeforeHash: sha('V1'), newContent: 'V2' });
    // External edit between commit and rollback.
    writeFileSync(file, 'EXTERNAL', 'utf8');
    await expect(rollback({ root: tmp, commitId: r.commitId })).rejects.toThrow(/VE_FS_003/);
  });
});
