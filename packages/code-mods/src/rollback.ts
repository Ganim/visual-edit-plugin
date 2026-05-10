import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { findCommit, appendCommit } from './commitLog.js';
import { readBackup } from './backups.js';

export interface RollbackInput {
  root: string;
  commitId: string;
}

export interface RollbackResult {
  commitId: string;          // the rollback's own id
  rollbackOf: string;
  filePath: string;
  sha256Before: string;
  sha256After: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function rollback(input: RollbackInput): Promise<RollbackResult> {
  const original = findCommit(input.root, input.commitId);
  if (!original) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_003_STALE_DRY_RUN,
      message: `[VE_CODEMOD_003]: rollback target commit '${input.commitId}' not found in commit log`,
      severity: 'error',
      recovery: 'user-action',
      blame: 'user-config',
    }));
  }
  if (original.kind !== 'commit') {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_003_STALE_DRY_RUN,
      message: `[VE_CODEMOD_003]: rollback target ${input.commitId} has kind '${original.kind}' — only 'commit' entries can be rolled back`,
      severity: 'error',
      recovery: 'user-action',
      blame: 'user-config',
    }));
  }
  const current = readFileSync(original.filePath, 'utf8');
  const currentHash = sha(current);
  if (currentHash !== original.sha256After) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_FS_003_VERIFY_MISMATCH,
      message: `[VE_FS_003]: cannot rollback — file ${original.filePath} no longer matches commit's sha256After`,
      severity: 'error',
      recovery: 'user-action',
      blame: 'environment',
      hint: 'The file was modified after this commit. Resolve manually before rollback.',
    }));
  }
  const restored = readBackup({ root: input.root, filePath: original.filePath, commitId: original.commitId });
  // Atomic write the restored content.
  const tmp = `${original.filePath}.rb.tmp`;
  writeFileSync(tmp, restored, 'utf8');
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, original.filePath);

  const newCommitId = randomBytes(4).toString('hex');
  appendCommit(input.root, {
    commitId: newCommitId,
    filePath: original.filePath,
    sha256Before: original.sha256After,
    sha256After: original.sha256Before,
    kind: 'rollback',
    timestamp: new Date().toISOString(),
    rollbackOf: original.commitId,
  });

  return {
    commitId: newCommitId,
    rollbackOf: original.commitId,
    filePath: original.filePath,
    sha256Before: original.sha256After,
    sha256After: original.sha256Before,
  };
}
