import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import type { WalEntry, WalOp } from './types.js';

const WAL_PATH = '.visual-edit/queue.wal';
const WAL_VERSION = '1';

function walPath(root: string): string { return join(root, WAL_PATH); }

function shaOfPayload(seq: number, op: WalOp): string {
  const payload = JSON.stringify({ seq, version: WAL_VERSION, op });
  return createHash('sha256').update(payload).digest('hex');
}

const seqCache = new Map<string, number>(); // root → last seq

function nextSeq(root: string): number {
  if (!seqCache.has(root)) {
    // Initialize from disk on first use.
    if (!existsSync(walPath(root))) seqCache.set(root, 0);
    else {
      const lines = readFileSync(walPath(root), 'utf8').split('\n').filter(Boolean);
      let max = 0;
      for (const line of lines) {
        try { const e = JSON.parse(line) as WalEntry; if (e.seq > max) max = e.seq; } catch { /* ignore */ }
      }
      seqCache.set(root, max);
    }
  }
  const next = seqCache.get(root)! + 1;
  seqCache.set(root, next);
  return next;
}

export function appendWalEntry(root: string, op: WalOp): WalEntry {
  mkdirSync(join(root, '.visual-edit'), { recursive: true });
  const seq = nextSeq(root);
  const sha256 = shaOfPayload(seq, op);
  const entry: WalEntry = { seq, version: WAL_VERSION, sha256, op };
  appendFileSync(walPath(root), JSON.stringify(entry) + '\n', 'utf8');
  const fd = openSync(walPath(root), 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  return entry;
}

/**
 * Read all WAL entries, validating sha256 + version per entry. Returns entries up to the
 * first corrupted/invalid one (exclusive). Refuses to read if any entry has a version other
 * than '1' — that's a hard error requiring manual reset, per spec §3.3.
 */
export function readWalEntries(root: string): WalEntry[] {
  const path = walPath(root);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const out: WalEntry[] = [];
  for (const line of lines) {
    let entry: WalEntry;
    try { entry = JSON.parse(line) as WalEntry; }
    catch { break; } // corrupt JSON — stop
    if (entry.version !== WAL_VERSION) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_QUEUE_005_WAL_VERSION_MISMATCH,
        message: `[VE_QUEUE_005]: WAL version mismatch — got ${entry.version}, expected ${WAL_VERSION}`,
        severity: 'fatal',
        recovery: 'user-action',
        blame: 'environment',
        hint: 'Delete .visual-edit/queue.wal to reset the queue (loses pending items).',
      }));
    }
    const expected = shaOfPayload(entry.seq, entry.op);
    if (expected !== entry.sha256) break; // corruption — stop at last valid
    out.push(entry);
  }
  return out;
}

/** Test/internal: clear the seq cache for a root (e.g. after rmSync). */
export function _resetSeqCache(root?: string): void {
  if (root) seqCache.delete(root);
  else seqCache.clear();
}
