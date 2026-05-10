import { randomBytes } from 'node:crypto';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { appendWalEntry } from './wal.js';
import { replayWal } from './replay.js';
import type { AskAIItem, AskAIOutcome } from './types.js';

const DEFAULT_LEASE_TTL_MS = 15 * 60_000;

export interface QueueManagerOpts {
  leaseTtlMs?: number;
}

export interface EnqueueInput {
  element: string;
  filePath: string;
  prompt: string;
}

export interface ResolveInput {
  askId: string;
  leaseId: string;
  outcome: AskAIOutcome;
  summary: string;
  commitId?: string;
}

export interface DrainResult {
  items: AskAIItem[];
  leases: Record<string, string>;  // askId → leaseId
}

export class QueueManager {
  private items = new Map<string, AskAIItem>();
  private leaseTtlMs: number;

  constructor(private root: string, opts: QueueManagerOpts = {}) {
    this.leaseTtlMs = opts.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    for (const it of replayWal(root)) this.items.set(it.askId, it);
  }

  list(): AskAIItem[] { return [...this.items.values()]; }

  enqueue(input: EnqueueInput): AskAIItem {
    const askId = randomBytes(4).toString('hex');
    const timestamp = new Date().toISOString();
    appendWalEntry(this.root, { op: 'enqueue', askId, element: input.element, filePath: input.filePath, prompt: input.prompt, timestamp });
    const item: AskAIItem = {
      askId,
      element: input.element,
      filePath: input.filePath,
      prompt: input.prompt,
      state: 'pending',
      enqueuedAt: timestamp,
    };
    this.items.set(askId, item);
    return item;
  }

  expireStaleLeases(): number {
    const now = Date.now();
    let count = 0;
    for (const it of this.items.values()) {
      if (it.state === 'leased' && it.leaseExpiresAt && Date.parse(it.leaseExpiresAt) <= now) {
        appendWalEntry(this.root, { op: 'lease-expired', askId: it.askId, timestamp: new Date().toISOString() });
        it.state = 'pending';
        delete it.leaseId;
        delete it.leaseExpiresAt;
        count++;
      }
    }
    return count;
  }

  drain(): DrainResult {
    // 1) Expire any leases past TTL.
    this.expireStaleLeases();
    // 2) Lease all pending items.
    const now = Date.now();
    const items: AskAIItem[] = [];
    const leases: Record<string, string> = {};
    for (const it of this.items.values()) {
      if (it.state !== 'pending') continue;
      const leaseId = randomBytes(4).toString('hex');
      const expiresAt = new Date(now + this.leaseTtlMs).toISOString();
      appendWalEntry(this.root, { op: 'lease', askId: it.askId, leaseId, expiresAt, timestamp: new Date().toISOString() });
      it.state = 'leased';
      it.leaseId = leaseId;
      it.leaseExpiresAt = expiresAt;
      leases[it.askId] = leaseId;
      items.push({ ...it });
    }
    return { items, leases };
  }

  resolve(input: ResolveInput): AskAIItem {
    const item = this.items.get(input.askId);
    if (!item) throw new VisualEditError(makeEnvelope({
      code: CODES.VE_QUEUE_001_UNKNOWN_ASK,
      message: `[VE_QUEUE_001]: unknown askId ${input.askId}`,
      severity: 'error', recovery: 'none', blame: 'user-code',
    }));
    if (item.state === 'resolved') return item; // idempotent
    if (item.state !== 'leased') throw new VisualEditError(makeEnvelope({
      code: CODES.VE_QUEUE_002_NOT_LEASED,
      message: `[VE_QUEUE_002]: askId ${input.askId} is not leased (state=${item.state})`,
      severity: 'error', recovery: 'none', blame: 'user-code',
    }));
    if (item.leaseId !== input.leaseId) throw new VisualEditError(makeEnvelope({
      code: CODES.VE_QUEUE_003_LEASE_MISMATCH,
      message: `[VE_QUEUE_003]: lease mismatch for ${input.askId}`,
      severity: 'error', recovery: 'none', blame: 'user-code',
    }));
    const timestamp = new Date().toISOString();
    appendWalEntry(this.root, {
      op: 'resolve',
      askId: input.askId,
      leaseId: input.leaseId,
      outcome: input.outcome,
      summary: input.summary,
      ...(input.commitId !== undefined ? { commitId: input.commitId } : {}),
      timestamp,
    });
    item.state = 'resolved';
    item.outcome = input.outcome;
    item.summary = input.summary;
    if (input.commitId !== undefined) item.commitId = input.commitId;
    item.resolvedAt = timestamp;
    delete item.leaseId;
    delete item.leaseExpiresAt;
    return { ...item };
  }
}
