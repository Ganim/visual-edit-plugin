import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface LockData {
  pid: number;
  port: number;
  daemonVersion: string;
  startedAt: string;
  version: '1';
}

const LOCK_DIR = '.visual-edit';
const LOCK_FILE = 'daemon.lock';

export async function writeLock(
  root: string,
  fields: Pick<LockData, 'pid' | 'port' | 'daemonVersion'>,
): Promise<void> {
  await mkdir(join(root, LOCK_DIR), { recursive: true });
  const lock: LockData = {
    ...fields,
    startedAt: new Date().toISOString(),
    version: '1',
  };
  await writeFile(join(root, LOCK_DIR, LOCK_FILE), JSON.stringify(lock, null, 2), 'utf8');
}

export async function readLock(root: string): Promise<LockData | null> {
  try {
    const raw = await readFile(join(root, LOCK_DIR, LOCK_FILE), 'utf8');
    return JSON.parse(raw) as LockData;
  } catch {
    return null;
  }
}

export async function removeLock(root: string): Promise<void> {
  try {
    await unlink(join(root, LOCK_DIR, LOCK_FILE));
  } catch {
    // ignore — already gone
  }
}
