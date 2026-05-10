import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCommit, readCommitLog, type CommitLogEntry } from '../src/commitLog.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cl-corrupt-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const entry = (id: string): CommitLogEntry => ({
  commitId: id,
  filePath: '/a.tsx',
  sha256Before: 'x',
  sha256After: 'y',
  kind: 'commit',
  timestamp: 't',
});

describe('commitLog – corruption tolerance', () => {
  it('skips corrupted lines and returns only valid entries', () => {
    // Append a valid entry.
    appendCommit(tmp, entry('aaa'));

    // Manually inject a garbage line into the log file.
    const logFile = join(tmp, '.visual-edit', 'commit-log.jsonl');
    appendFileSync(logFile, 'NOT_VALID_JSON{{{\n', 'utf8');

    // Append another valid entry after the corrupted line.
    appendCommit(tmp, entry('bbb'));

    const log = readCommitLog(tmp);
    expect(log).toHaveLength(2);
    expect(log[0]!.commitId).toBe('aaa');
    expect(log[1]!.commitId).toBe('bbb');
  });
});
