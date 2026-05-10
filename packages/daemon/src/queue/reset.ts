import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function resetQueueFiles(root: string): { removed: string[] } {
  const wal = join(root, '.visual-edit', 'queue.wal');
  const snapshot = join(root, '.visual-edit', 'queue-snapshot.json');
  const removed: string[] = [];
  if (existsSync(wal)) { unlinkSync(wal); removed.push(wal); }
  if (existsSync(snapshot)) { unlinkSync(snapshot); removed.push(snapshot); }
  return { removed };
}
