import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { join, basename } from 'node:path';

export interface BackupOps {
  root: string;        // project root (visual-edit.config.ts root)
  filePath: string;    // absolute path of the user file being backed up
  commitId: string;    // assigned by commit pipeline
  content: string;     // exact bytes to persist (pre-commit)
}

function backupsDir(root: string): string {
  return join(root, '.visual-edit', 'backups');
}

function backupPath(root: string, filePath: string, commitId: string): string {
  return join(backupsDir(root), `${basename(filePath)}-${commitId}`);
}

export function writeBackup(opts: BackupOps): string {
  const dir = backupsDir(opts.root);
  mkdirSync(dir, { recursive: true });
  const path = backupPath(opts.root, opts.filePath, opts.commitId);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, opts.content, 'utf8');
  // fsync so the bytes hit the platter before we trust the backup.
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  // Atomic rename on the same filesystem.
  renameSync(tmp, path);
  return path;
}

export function readBackup(opts: { root: string; filePath: string; commitId: string }): string {
  const path = backupPath(opts.root, opts.filePath, opts.commitId);
  if (!existsSync(path)) throw new Error(`backup not found: ${path}`);
  return readFileSync(path, 'utf8');
}

export function listBackups(opts: { root: string; filePath: string }): string[] {
  const dir = backupsDir(opts.root);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(opts.filePath)}-`;
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs, id: name.slice(prefix.length) }))
    .sort((a, b) => a.mtime - b.mtime)
    .map((e) => e.id);
}
