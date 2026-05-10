import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export interface StartupSnapshot {
  daemonVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  pid: number;
  startedAt: string;
  rootGitSha: string | null;        // null if not a git repo
  rootGitDirty: boolean | null;     // null if not a git repo
  filesystemType: string | null;    // unknown for now
  packageManager: string | null;    // detected from lockfile
  cwd: string;
}

export function writeStartupSnapshot(root: string, info: { daemonVersion: string }): StartupSnapshot {
  const today = new Date().toISOString().slice(0, 10);
  const dir = join(root, '.visual-edit', 'logs', today);
  mkdirSync(dir, { recursive: true });

  const snapshot: StartupSnapshot = {
    daemonVersion: info.daemonVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    rootGitSha: tryGitSha(root),
    rootGitDirty: tryGitDirty(root),
    filesystemType: null,
    packageManager: detectPackageManager(root),
    cwd: process.cwd(),
  };

  writeFileSync(join(dir, 'startup.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
}

function tryGitSha(root: string): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function tryGitDirty(root: string): boolean | null {
  try {
    const out = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

function detectPackageManager(root: string): string | null {
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  return null;
}
