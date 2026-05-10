import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { writeBackup, readBackup } from './backups.js';
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

// ---------------------------------------------------------------------------
// Multi-file atomic commit
// ---------------------------------------------------------------------------

export interface MultiFileCommitInput {
  root: string;
  files: Array<{
    filePath: string;
    expectedBeforeHash: string;
    newContent: string;
  }>;
  /** Test hook only — production code uses Node's fs.renameSync. */
  _renameImpl?: (from: string, to: string) => void;
}

export interface MultiFileCommitResult {
  commitId: string;       // SAME id for all files in this commit (correlated)
  files: Array<{
    filePath: string;
    sha256Before: string;
    sha256After: string;
    status: 'committed' | 'reverted' | 'commit-uncertain';
  }>;
  status: 'committed' | 'commit-uncertain';
  retries: number;
  lastError?: string;
}

export async function commitMultiFile(input: MultiFileCommitInput): Promise<MultiFileCommitResult> {
  const commitId = randomBytes(4).toString('hex');
  const renameFn = input._renameImpl ?? renameSync;

  // Phase 1: validate all current hashes match expected.
  for (const f of input.files) {
    const current = readFileSync(f.filePath, 'utf8');
    const currentHash = sha(current);
    if (currentHash !== f.expectedBeforeHash) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CODEMOD_003_STALE_DRY_RUN,
        message: `[VE_CODEMOD_003]: ${f.filePath} sha mismatch — expected ${f.expectedBeforeHash.slice(0, 8)}, found ${currentHash.slice(0, 8)}`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'environment',
        hint: 'The file changed since the dry-run. Re-plan and try again.',
      }));
    }
  }

  // Phase 2: backup all files (still pre-commit).
  for (const f of input.files) {
    const current = readFileSync(f.filePath, 'utf8');
    writeBackup({ root: input.root, filePath: f.filePath, commitId, content: current });
  }

  // Phase 3: write all .tmp files + fsync.
  const tmpPaths: string[] = [];
  try {
    for (const f of input.files) {
      const tmp = `${f.filePath}.${commitId}.tmp`;
      writeFileSync(tmp, f.newContent, 'utf8');
      const fd = openSync(tmp, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      tmpPaths.push(tmp);
    }

    // Phase 4: rename in order. On any failure, revert renamed files using backups.
    const renamed: string[] = [];
    let lastError: string | undefined;
    let renameSuccess = true;

    for (let i = 0; i < input.files.length; i++) {
      const f = input.files[i]!;
      try {
        renameFn(tmpPaths[i]!, f.filePath);
        renamed.push(f.filePath);
      } catch (err) {
        lastError = `${(err as NodeJS.ErrnoException).code ?? 'ERR'}: ${(err as Error).message}`;
        renameSuccess = false;
        break;
      }
    }

    if (!renameSuccess) {
      // Revert renamed files using backups (best-effort).
      for (const filePath of renamed) {
        try {
          const backupContent = readBackup({ root: input.root, filePath, commitId });
          writeFileSync(filePath, backupContent, 'utf8');
        } catch { /* best-effort revert */ }
      }
      return {
        commitId,
        files: input.files.map((f) => ({
          filePath: f.filePath,
          sha256Before: sha(readFileSync(f.filePath, 'utf8')),
          sha256After: sha(f.newContent),
          status: 'reverted' as const,
        })),
        status: 'commit-uncertain',
        retries: 0,
        lastError: lastError ?? 'unknown',
      };
    }

    // Phase 5: verify all files match expected new sha.
    for (const f of input.files) {
      const verify = sha(readFileSync(f.filePath, 'utf8'));
      if (verify !== sha(f.newContent)) {
        return {
          commitId,
          files: input.files.map((g) => ({
            filePath: g.filePath,
            sha256Before: g.expectedBeforeHash,
            sha256After: sha(g.newContent),
            status: 'commit-uncertain' as const,
          })),
          status: 'commit-uncertain',
          retries: 0,
          lastError: `verify-mismatch on ${f.filePath}`,
        };
      }
    }

    // Phase 6: append per-file commit log entries (one per file, shared commitId).
    for (const f of input.files) {
      appendCommit(input.root, {
        commitId,
        filePath: f.filePath,
        sha256Before: f.expectedBeforeHash,
        sha256After: sha(f.newContent),
        kind: 'commit',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      commitId,
      files: input.files.map((f) => ({
        filePath: f.filePath,
        sha256Before: f.expectedBeforeHash,
        sha256After: sha(f.newContent),
        status: 'committed' as const,
      })),
      status: 'committed',
      retries: 0,
    };
  } finally {
    // Best-effort cleanup of any tmp files that survived (already-renamed paths are gone).
    for (const tmp of tmpPaths) {
      try { unlinkSync(tmp); } catch { /* already-renamed or already-gone */ }
    }
  }
}
