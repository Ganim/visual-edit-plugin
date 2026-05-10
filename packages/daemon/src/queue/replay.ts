import { readWalEntries } from './wal.js';
import type { AskAIItem } from './types.js';

/**
 * Replay the WAL into a Map<askId, AskAIItem>. Idempotent by construction:
 * - enqueue adds if absent
 * - lease updates state (only if currently pending)
 * - resolve marks resolved (no-op if already resolved)
 * - lease-expired reverts to pending (only if still leased)
 */
export function replayWal(root: string): AskAIItem[] {
  const entries = readWalEntries(root);
  const items = new Map<string, AskAIItem>();
  for (const e of entries) {
    const op = e.op;
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
