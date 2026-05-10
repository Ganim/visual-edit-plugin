import { createHash } from 'node:crypto';
import type { TextPatch } from './types.js';

export interface ApplyResult {
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  patches: TextPatch[];
}

export function apply(source: string, patches: TextPatch[]): ApplyResult {
  const sorted = [...patches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return patches.indexOf(a) - patches.indexOf(b);
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start < prev.end) {
      throw new Error(
        `apply: overlapping patches detected: [${prev.start},${prev.end}) and [${cur.start},${cur.end})`,
      );
    }
  }

  const reversed = [...sorted].reverse();
  let out = source;
  for (const p of reversed) {
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }

  return {
    before: source,
    after: out,
    beforeHash: createHash('sha256').update(source).digest('hex'),
    afterHash: createHash('sha256').update(out).digest('hex'),
    patches,
  };
}
