import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface RunResetQueueInput {
  root: string;
  /** When true, removes WAL + snapshot without confirmation. */
  yes: boolean;
}

export function runResetQueue(input: RunResetQueueInput): { removed: string[] } {
  const wal = join(input.root, '.visual-edit', 'queue.wal');
  const snapshot = join(input.root, '.visual-edit', 'queue-snapshot.json');
  const removed: string[] = [];
  if (existsSync(wal)) {
    unlinkSync(wal);
    removed.push(wal);
  }
  if (existsSync(snapshot)) {
    unlinkSync(snapshot);
    removed.push(snapshot);
  }
  if (!input.yes && removed.length === 0) {
    return { removed: [] };
  }
  return { removed };
}
