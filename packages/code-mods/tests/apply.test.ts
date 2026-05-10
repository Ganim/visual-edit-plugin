import { describe, it, expect } from 'vitest';
import { apply } from '../src/apply.js';

describe('apply', () => {
  it('applies a single replacement', () => {
    const src = 'hello world';
    const result = apply(src, [{ start: 6, end: 11, replacement: 'there', reason: 't' }]);
    expect(result.after).toBe('hello there');
    expect(result.before).toBe(src);
    expect(result.beforeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.afterHash).not.toBe(result.beforeHash);
  });

  it('applies multiple non-overlapping patches in any order', () => {
    const src = 'aaa bbb ccc';
    const result = apply(src, [
      { start: 8, end: 11, replacement: 'CCC', reason: 'c' },
      { start: 0, end: 3, replacement: 'AAA', reason: 'a' },
    ]);
    expect(result.after).toBe('AAA bbb CCC');
  });

  it('rejects overlapping patches', () => {
    const src = 'abcdef';
    expect(() =>
      apply(src, [
        { start: 0, end: 3, replacement: 'X', reason: '1' },
        { start: 2, end: 5, replacement: 'Y', reason: '2' },
      ]),
    ).toThrow(/overlapping patches/);
  });

  it('handles empty patches array (no-op)', () => {
    const src = 'unchanged';
    const result = apply(src, []);
    expect(result.after).toBe(src);
    expect(result.before).toBe(src);
    expect(result.beforeHash).toBe(result.afterHash);
  });
});
