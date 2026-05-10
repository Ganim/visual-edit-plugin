import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readWalEntries } from './wal.js';
import { readSnapshot } from './compaction.js';
import type { AskAIItem } from './types.js';

/**
 * Replay the WAL into a Map<askId, AskAIItem>. Idempotent by construction:
 * - enqueue adds if absent
 * - lease updates state (only if currently pending)
 * - resolve marks resolved (no-op if already resolved)
 * - lease-expired reverts to pending (only if still leased)
 *
 * If the first WAL entry is a snapshot-ref, the snapshot is loaded and its SHA-256
 * is validated before seeding the items map. Subsequent entries are applied on top.
 */
export function replayWal(root: string): AskAIItem[] {
  const entries = readWalEntries(root);
  const items = new Map<string, AskAIItem>();

  // First entry might be a snapshot-ref; if so, load the snapshot and skip it.
  let startIdx = 0;
  if (entries[0]?.op.op === 'snapshot-ref') {
    const ref = entries[0]!.op as { op: 'snapshot-ref'; snapshotPath: string; snapshotSha256: string };
    // Validate sha before trusting snapshot contents.
    const raw = readFileSync(ref.snapshotPath, 'utf8');
    const sha = createHash('sha256').update(raw).digest('hex');
    if (sha !== ref.snapshotSha256) {
      throw new Error(`[VE_QUEUE_004]: snapshot sha mismatch — refusing to replay`);
    }
    const snapshot = readSnapshot(root);
    if (snapshot) {
      for (const item of snapshot) items.set(item.askId, item);
    }
    startIdx = 1;
  }

  for (let i = startIdx; i < entries.length; i++) {
    const e = entries[i]!;
    const op = e.op;

    // snapshot-ref should only appear at index 0; ignore if it appears elsewhere
    if (op.op === 'snapshot-ref') continue;

    if (op.op === 'enqueue') {
      if (!items.has(op.askId)) {
        items.set(op.askId, {
          askId: op.askId,
          element: op.element,
          filePath: op.filePath,
          prompt: op.prompt,
          state: 'pending',
          enqueuedAt: op.timestamp,
        });
      }
      continue;
    }
    const cur = items.get(op.askId);
    if (!cur) continue;
    if (op.op === 'lease') {
      if (cur.state !== 'pending') continue;
      cur.state = 'leased';
      cur.leaseId = op.leaseId;
      cur.leaseExpiresAt = op.expiresAt;
      continue;
    }
    if (op.op === 'resolve') {
      if (cur.state === 'resolved') continue;
      cur.state = 'resolved';
      cur.outcome = op.outcome;
      cur.summary = op.summary;
      if (op.commitId !== undefined) cur.commitId = op.commitId;
      cur.resolvedAt = op.timestamp;
      delete cur.leaseId;
      delete cur.leaseExpiresAt;
      continue;
    }
    if (op.op === 'lease-expired') {
      if (cur.state !== 'leased') continue;
      cur.state = 'pending';
      delete cur.leaseId;
      delete cur.leaseExpiresAt;
      continue;
    }
  }
  return [...items.values()];
}
