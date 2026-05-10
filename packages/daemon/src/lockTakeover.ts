import { readLock } from './lockFile.js';

const STALE_HEARTBEAT_MS = 30_000;

export type LockAction =
  | { kind: 'bind' }
  | { kind: 'connect'; url: string; pid: number; port: number }
  | { kind: 'takeover'; reason: 'pid-dead' | 'heartbeat-stale' }
  | { kind: 'refuse'; reason: string };

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function decideLockAction(root: string): Promise<LockAction> {
  const lock = await readLock(root);
  if (!lock) return { kind: 'bind' };
  if (lock.version !== '1') {
    return { kind: 'refuse', reason: `unknown lock version: ${lock.version}` };
  }
  const alive = isProcessAlive(lock.pid);
  if (!alive) return { kind: 'takeover', reason: 'pid-dead' };
  const hbAge = lock.heartbeat ? Date.now() - Date.parse(lock.heartbeat) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(hbAge) || hbAge > STALE_HEARTBEAT_MS) {
    return { kind: 'takeover', reason: 'heartbeat-stale' };
  }
  return {
    kind: 'connect',
    url: `http://127.0.0.1:${lock.port}`,
    pid: lock.pid,
    port: lock.port,
  };
}
