import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readDaemonLock, type DaemonLockData } from '@visual-edit/shared';

// Re-export from shared for backward compatibility (daemon-internal consumers).
// readLock and LockData are now canonical in @visual-edit/shared.
export { readDaemonLock as readLock };
export type { DaemonLockData as LockData };

const LOCK_DIR = '.visual-edit';
const LOCK_FILE = 'daemon.lock';

export async function writeLock(
  root: string,
  fields: Pick<DaemonLockData, 'pid' | 'port' | 'daemonVersion'>,
): Promise<void> {
  await mkdir(join(root, LOCK_DIR), { recursive: true });
  const lock: DaemonLockData = {
    ...fields,
    startedAt: new Date().toISOString(),
    version: '1',
  };
  await writeFile(join(root, LOCK_DIR, LOCK_FILE), JSON.stringify(lock, null, 2), 'utf8');
}

export async function removeLock(root: string): Promise<void> {
  try {
    await unlink(join(root, LOCK_DIR, LOCK_FILE));
  } catch {
    // ignore — already gone
  }
}
