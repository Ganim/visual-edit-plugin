import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DaemonLockData {
  pid: number;
  port: number;
  daemonVersion: string;
  startedAt: string;
  heartbeat: string;   // ISO timestamp; updated every 5s by daemon
  stateHash: string;   // sha256 of recent activity (used to detect drift)
  version: '1';
}

const LOCK_DIR = '.visual-edit';
const LOCK_FILE = 'daemon.lock';

export async function readDaemonLock(root: string): Promise<DaemonLockData | null> {
  try {
    const raw = await readFile(join(root, LOCK_DIR, LOCK_FILE), 'utf8');
    return JSON.parse(raw) as DaemonLockData;
  } catch {
    return null;
  }
}
