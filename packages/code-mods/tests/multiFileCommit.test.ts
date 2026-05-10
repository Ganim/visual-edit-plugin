import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, renameSync as fsRenameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { commitMultiFile } from '../src/commit.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-mfc-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('commitMultiFile', () => {
  it('writes all files atomically + assigns same commitId per file', async () => {
    const fileA = join(tmp, 'A.tsx');
    const fileB = join(tmp, 'A.module.css');
    writeFileSync(fileA, 'A1', 'utf8');
    writeFileSync(fileB, 'B1', 'utf8');

    const result = await commitMultiFile({
      root: tmp,
      files: [
        { filePath: fileA, expectedBeforeHash: sha('A1'), newContent: 'A2' },
        { filePath: fileB, expectedBeforeHash: sha('B1'), newContent: 'B2' },
      ],
    });

    expect(result.status).toBe('committed');
    expect(readFileSync(fileA, 'utf8')).toBe('A2');
    expect(readFileSync(fileB, 'utf8')).toBe('B2');
    expect(result.files.every((f) => f.status === 'committed')).toBe(true);
    // All entries share the same commitId.
    const commitId = result.commitId;
    expect(typeof commitId).toBe('string');
    expect(commitId.length).toBeGreaterThan(0);
  });

  it('reverts file 1 when file 2 rename fails', async () => {
    const fileA = join(tmp, 'A.tsx');
    const fileB = join(tmp, 'A.module.css');
    writeFileSync(fileA, 'A1', 'utf8');
    writeFileSync(fileB, 'B1', 'utf8');

    let renameCount = 0;
    const result = await commitMultiFile({
      root: tmp,
      files: [
        { filePath: fileA, expectedBeforeHash: sha('A1'), newContent: 'A2' },
        { filePath: fileB, expectedBeforeHash: sha('B1'), newContent: 'B2' },
      ],
      _renameImpl: (from, to) => {
        renameCount++;
        if (renameCount === 1) {
          fsRenameSync(from, to); // first rename succeeds
          return;
        }
        // Second rename fails.
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      },
    });

    expect(result.status).toBe('commit-uncertain');
    // File A was renamed successfully but must be reverted.
    expect(readFileSync(fileA, 'utf8')).toBe('A1');
    // File B was never renamed — still original.
    expect(readFileSync(fileB, 'utf8')).toBe('B1');
  });

  it('rejects when any file has sha mismatch on expectedBeforeHash', async () => {
    const fileA = join(tmp, 'A.tsx');
    writeFileSync(fileA, 'CURRENT', 'utf8');

    await expect(
      commitMultiFile({
        root: tmp,
        files: [{ filePath: fileA, expectedBeforeHash: sha('STALE'), newContent: 'X' }],
      }),
    ).rejects.toThrow(/VE_CODEMOD_003/);
  });
});
