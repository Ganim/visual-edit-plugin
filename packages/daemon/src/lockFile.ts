import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readDaemonLock, type DaemonLockData } from '@visual-edit/shared';

// Re-export from shared for backward compatibility (daemon-internal consumers).
// readLock and LockData are now canonical in @visual-edit/shared.
export { readDaemonLock as readLock };
export type { DaemonLockData as LockData };

const LOCK_DIR = '.visual-edit';
const LOCK_FILE = 'daemon.lock';

export interface WriteLockInput {
  pid: number;
  port: number;
  daemonVersion: string;
  /** Optional state hash; defaults to a zero hash if omitted. */
  stateHash?: string;
}

export async function writeLock(root: string, fields: WriteLockInput): Promise<void> {
  await mkdir(join(root, LOCK_DIR), { recursive: true });
  const now = new Date().toISOString();
  const lock: DaemonLockData = {
    pid: fields.pid,
    port: fields.port,
    daemonVersion: fields.daemonVersion,
    startedAt: now,
    heartbeat: now,
    stateHash: fields.stateHash ?? createHash('sha256').update('').digest('hex'),
    version: '1',
  };
  await writeFile(join(root, LOCK_DIR, LOCK_FILE), JSON.stringify(lock, null, 2), 'utf8');
}

export async function updateHeartbeat(root: string, stateHash?: string): Promise<void> {
  const path = join(root, LOCK_DIR, LOCK_FILE);
  let cur: DaemonLockData;
  try {
    cur = JSON.parse(await readFile(path, 'utf8')) as DaemonLockData;
  } catch {
    return;
  }
  cur.heartbeat = new Date().toISOString();
  if (stateHash !== undefined) cur.stateHash = stateHash;
  await writeFile(path, JSON.stringify(cur, null, 2), 'utf8');
}

export async function removeLock(root: string): Promise<void> {
  try {
    await unlink(join(root, LOCK_DIR, LOCK_FILE));
  } catch {
    // ignore — already gone
  }
}
