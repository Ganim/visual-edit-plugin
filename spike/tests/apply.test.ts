import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { apply } from '../src/apply.ts';
import type { TextPatch } from '../src/types.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('apply', () => {
  it('returns identical content when no patches', () => {
    const src = 'hello world';
    const r = apply(src, []);
    expect(r.after).toBe(src);
    expect(r.beforeHash).toBe(sha(src));
    expect(r.afterHash).toBe(sha(src));
  });

  it('applies a single patch', () => {
    const src = 'hello world';
    const patches: TextPatch[] = [{ start: 6, end: 11, replacement: 'there', reason: 'test' }];
    const r = apply(src, patches);
    expect(r.after).toBe('hello there');
  });

  it('applies multiple non-overlapping patches in any input order', () => {
    const src = 'AAA BBB CCC';
    const patches: TextPatch[] = [
      { start: 8, end: 11, replacement: 'ccc', reason: 'c' },
      { start: 0, end: 3, replacement: 'aaa', reason: 'a' },
      { start: 4, end: 7, replacement: 'bbb', reason: 'b' },
    ];
    const r = apply(src, patches);
    expect(r.after).toBe('aaa bbb ccc');
  });

  it('throws on overlapping patches', () => {
    const src = 'hello world';
    const patches: TextPatch[] = [
      { start: 0, end: 5, replacement: 'X', reason: 'a' },
      { start: 3, end: 8, replacement: 'Y', reason: 'b' },
    ];
    expect(() => apply(src, patches)).toThrow(/overlap/i);
  });

  it('hashes before and after', () => {
    const src = 'abc';
    const patches: TextPatch[] = [{ start: 1, end: 2, replacement: 'X', reason: '' }];
    const r = apply(src, patches);
    expect(r.beforeHash).toBe(sha('abc'));
    expect(r.afterHash).toBe(sha('aXc'));
  });

  it('preserves before/after content in the result', () => {
    const src = 'hello';
    const r = apply(src, []);
    expect(r.before).toBe('hello');
    expect(r.after).toBe('hello');
  });
});
