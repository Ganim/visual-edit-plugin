import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCommit, readCommitLog, findCommit, type CommitLogEntry } from '../src/commitLog.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cl-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('commitLog', () => {
  it('appends entries and reads them back in order', () => {
    const e1: CommitLogEntry = {
      commitId: 'aa', filePath: '/a.tsx', sha256Before: 'b', sha256After: 'a', kind: 'commit', timestamp: 't1',
    };
    const e2: CommitLogEntry = {
      commitId: 'bb', filePath: '/a.tsx', sha256Before: 'a', sha256After: 'c', kind: 'commit', timestamp: 't2',
    };
    appendCommit(tmp, e1);
    appendCommit(tmp, e2);
    expect(readCommitLog(tmp)).toEqual([e1, e2]);
  });

  it('findCommit returns the entry by id (latest match if duplicated)', () => {
    appendCommit(tmp, { commitId: 'aa', filePath: '/a.tsx', sha256Before: '1', sha256After: '2', kind: 'commit', timestamp: 't1' });
    appendCommit(tmp, { commitId: 'aa', filePath: '/a.tsx', sha256Before: '2', sha256After: '1', kind: 'rollback', timestamp: 't2', rollbackOf: 'aa' });
    const found = findCommit(tmp, 'aa');
    expect(found?.kind).toBe('rollback');
  });

  it('persists as JSONL on disk for crash safety', () => {
    appendCommit(tmp, { commitId: 'cc', filePath: '/x.tsx', sha256Before: 'x', sha256After: 'y', kind: 'commit', timestamp: 't' });
    const raw = readFileSync(join(tmp, '.visual-edit', 'commit-log.jsonl'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(raw.trim())).toMatchObject({ commitId: 'cc' });
  });
});
