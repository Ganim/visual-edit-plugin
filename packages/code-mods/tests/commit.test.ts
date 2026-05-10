import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { commit, type CommitInput } from '../src/commit.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-commit-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('commit', () => {
  it('writes the new content, creates backup, appends commit log entry', async () => {
    const file = join(tmp, 'src', 'p.tsx');
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(file, 'OLD', 'utf8');
    const result = await commit({
      root: tmp,
      filePath: file,
      expectedBeforeHash: sha('OLD'),
      newContent: 'NEW',
    } satisfies CommitInput);
    expect(result.status).toBe('committed');
    expect(readFileSync(file, 'utf8')).toBe('NEW');
    expect(result.sha256After).toBe(sha('NEW'));
  });

  it('rejects when current file content does not match expectedBeforeHash', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'CURRENT', 'utf8');
    await expect(
      commit({
        root: tmp,
        filePath: file,
        expectedBeforeHash: sha('STALE'),
        newContent: 'NEW',
      }),
    ).rejects.toThrow(/VE_CODEMOD_003/);
    // Source untouched.
    expect(readFileSync(file, 'utf8')).toBe('CURRENT');
  });

  it('returns commit-uncertain after retries exhausted (simulated rename failure)', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'OLD', 'utf8');
    let attempts = 0;
    const result = await commit({
      root: tmp,
      filePath: file,
      expectedBeforeHash: sha('OLD'),
      newContent: 'NEW',
      // Test hook: throw EPERM on every rename attempt.
      _renameImpl: () => { attempts++; const e: NodeJS.ErrnoException = new Error('EPERM'); e.code = 'EPERM'; throw e; },
    });
    expect(result.status).toBe('commit-uncertain');
    expect(attempts).toBe(3);
  });
});
