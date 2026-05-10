export type AskAIState = 'pending' | 'leased' | 'resolved';
export type AskAIOutcome = 'committed' | 'rejected' | 'failed' | 'no-op';

export interface AskAIItem {
  askId: string;
  element: string;          // data-vid
  filePath: string;
  prompt: string;
  state: AskAIState;
  enqueuedAt: string;
  leaseId?: string;
  leaseExpiresAt?: string;
  outcome?: AskAIOutcome;
  summary?: string;
  commitId?: string;
  resolvedAt?: string;
}

export type WalOp =
  | { op: 'enqueue'; askId: string; element: string; filePath: string; prompt: string; timestamp: string }
  | { op: 'lease'; askId: string; leaseId: string; expiresAt: string; timestamp: string }
  | { op: 'resolve'; askId: string; leaseId: string; outcome: AskAIOutcome; summary: string; commitId?: string; timestamp: string }
  | { op: 'lease-expired'; askId: string; timestamp: string }
  | { op: 'snapshot-ref'; snapshotPath: string; snapshotSha256: string; timestamp: string };

export interface WalEntry {
  seq: number;
  version: '1';
  sha256: string;
  op: WalOp;
}
