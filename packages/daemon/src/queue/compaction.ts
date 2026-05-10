import {
  writeFileSync,
  statSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { appendWalEntry, _resetSeqCache } from './wal.js';
import type { AskAIItem } from './types.js';

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export interface CompactionThresholds {
  maxEntries?: number;
  maxBytes?: number;
}

export function shouldCompact(root: string, thresholds: CompactionThresholds = {}): boolean {
  const path = join(root, '.visual-edit', 'queue.wal');
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  if (stat.size > (thresholds.maxBytes ?? DEFAULT_MAX_BYTES)) return true;
  const lineCount = readFileSync(path, 'utf8').split('\n').filter(Boolean).length;
  return lineCount > (thresholds.maxEntries ?? DEFAULT_MAX_ENTRIES);
}

/**
 * Write a compacted snapshot of the current queue state and reset the WAL.
 *
 * **Data-loss window (deferred to 1.F):** There is a brief window between the WAL
 * truncation (`writeFileSync(walPath, '')`) and the `appendWalEntry` that writes the
 * `snapshot-ref` record. A process crash inside this window leaves the WAL empty with
 * no snapshot-ref, so `replayWal` starts from scratch and loses all queued items that
 * were only in the snapshot file.
 *
 * Full fix (write snapshot-ref BEFORE truncating the old WAL) is deferred to Phase 1.F.
 * For now, callers should treat compaction as a best-effort operation and avoid crashing
 * the daemon during the compaction critical section.
 */
export function compactWal(
  root: string,
  items: AskAIItem[],
): { snapshotPath: string; snapshotSha256: string } {
  const dir = join(root, '.visual-edit');
  mkdirSync(dir, { recursive: true });
  const snapshotPath = join(dir, 'queue-snapshot.json');
  const payload = JSON.stringify({ version: '1', items });
  const tmpPath = `${snapshotPath}.tmp`;
  writeFileSync(tmpPath, payload, 'utf8');
  const fd = openSync(tmpPath, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmpPath, snapshotPath);
  const sha = createHash('sha256').update(payload).digest('hex');
  // Truncate the WAL and reset the seq cache so the next appendWalEntry starts at seq 1.
  const walPath = join(dir, 'queue.wal');
  writeFileSync(walPath, '', 'utf8');
  _resetSeqCache(root);
  appendWalEntry(root, {
    op: 'snapshot-ref',
    snapshotPath,
    snapshotSha256: sha,
    timestamp: new Date().toISOString(),
  });
  return { snapshotPath, snapshotSha256: sha };
}

export function readSnapshot(root: string): AskAIItem[] | null {
  const path = join(root, '.visual-edit', 'queue-snapshot.json');
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as { version: string; items: AskAIItem[] };
  if (parsed.version !== '1') return null;
  return parsed.items;
}
