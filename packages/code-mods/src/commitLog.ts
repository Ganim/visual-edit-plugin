import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';

export interface CommitLogEntry {
  commitId: string;
  filePath: string;
  sha256Before: string;
  sha256After: string;
  kind: 'commit' | 'rollback' | 'instrument';
  timestamp: string;
  rollbackOf?: string;
}

function logPath(root: string): string {
  return join(root, '.visual-edit', 'commit-log.jsonl');
}

export function appendCommit(root: string, entry: CommitLogEntry): void {
  mkdirSync(join(root, '.visual-edit'), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(logPath(root), line, 'utf8');
  // fsync so the entry survives a crash before the next operation.
  const fd = openSync(logPath(root), 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function readCommitLog(root: string): CommitLogEntry[] {
  const p = logPath(root);
  if (!existsSync(p)) return [];
  const entries: CommitLogEntry[] = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      entries.push(JSON.parse(line) as CommitLogEntry);
    } catch {
      process.stderr.write(`[visual-edit] commitLog: skipping corrupted line: ${line}\n`);
    }
  }
  return entries;
}

export function findCommit(root: string, commitId: string): CommitLogEntry | null {
  const all = readCommitLog(root);
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.commitId === commitId) return all[i]!;
  }
  return null;
}
