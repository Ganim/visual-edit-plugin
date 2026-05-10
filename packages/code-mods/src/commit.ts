import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { writeBackup } from './backups.js';
import { appendCommit } from './commitLog.js';

export interface CommitInput {
  root: string;
  filePath: string;
  expectedBeforeHash: string;
  newContent: string;
  /** Test hook only — production code uses Node's fs.renameSync. */
  _renameImpl?: (from: string, to: string) => void;
}

export interface CommitResult {
  commitId: string;
  filePath: string;
  sha256Before: string;
  sha256After: string;
  status: 'committed' | 'commit-uncertain';
  retries: number;
  lastError?: string;
}

const RETRY_BACKOFFS_MS = [100, 400, 900]; // 3 attempts total

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function commit(input: CommitInput): Promise<CommitResult> {
  const current = readFileSync(input.filePath, 'utf8');
  const currentHash = sha(current);
  if (currentHash !== input.expectedBeforeHash) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_003_STALE_DRY_RUN,
      message: `[VE_CODEMOD_003]: file ${input.filePath} sha mismatch — expected ${input.expectedBeforeHash.slice(0, 8)}, found ${currentHash.slice(0, 8)}`,
      severity: 'error',
      recovery: 'user-action',
      blame: 'environment',
      hint: 'The file changed since the dry-run. Re-plan and try again.',
    }));
  }

  const commitId = randomBytes(4).toString('hex');
  const sha256Before = currentHash;
  const sha256After = sha(input.newContent);

  // Backup BEFORE we touch the file (so rollback is always possible).
  writeBackup({ root: input.root, filePath: input.filePath, commitId, content: current });

  const renameFn = input._renameImpl ?? renameSync;
  let lastError: string | undefined;
  let attempts = 0;

  for (let i = 0; i < RETRY_BACKOFFS_MS.length; i++) {
    attempts = i + 1;
    const tmp = `${input.filePath}.${commitId}.tmp`;
    try {
      writeFileSync(tmp, input.newContent, 'utf8');
      const fd = openSync(tmp, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameFn(tmp, input.filePath);
      // Verify by reading back from disk.
      const verify = sha(readFileSync(input.filePath, 'utf8'));
      if (verify !== sha256After) {
        lastError = `verify-mismatch: expected ${sha256After.slice(0, 8)}, found ${verify.slice(0, 8)}`;
        continue;
      }
      appendCommit(input.root, {
        commitId,
        filePath: input.filePath,
        sha256Before,
        sha256After,
        kind: 'commit',
        timestamp: new Date().toISOString(),
      });
      return { commitId, filePath: input.filePath, sha256Before, sha256After, status: 'committed', retries: i };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      lastError = `${e.code ?? 'ERR'}: ${e.message}`;
      if (i < RETRY_BACKOFFS_MS.length - 1) await sleep(RETRY_BACKOFFS_MS[i]!);
    }
  }

  // All retries failed — return commit-uncertain. Editor reloads + re-fetches sha to verify.
  const result: CommitResult = {
    commitId,
    filePath: input.filePath,
    sha256Before,
    sha256After,
    status: 'commit-uncertain',
    retries: attempts,
  };
  if (lastError !== undefined) result.lastError = lastError;
  return result;
}
