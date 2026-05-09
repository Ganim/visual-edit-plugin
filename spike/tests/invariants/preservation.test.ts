import { describe, it, expect } from 'vitest';
import { assertCommentsPreserved } from '../../src/invariants/commentPreservation.ts';
import { assertWhitespacePreservedOutsidePatches } from '../../src/invariants/whitespacePreservation.ts';
import type { TextPatch } from '../../src/types.ts';

describe('assertCommentsPreserved', () => {
  it('passes when comment count and texts match', () => {
    const a = `// hello\nconst x = 1; /* yo */`;
    const b = `// hello\nconst x = 2; /* yo */`;
    expect(() => assertCommentsPreserved(a, b)).not.toThrow();
  });

  it('fails when a comment is removed', () => {
    const a = `// hello\nconst x = 1;`;
    const b = `const x = 1;`;
    expect(() => assertCommentsPreserved(a, b)).toThrow(/comment/i);
  });

  it('fails when comment text changed', () => {
    const a = `// hello\nconst x = 1;`;
    const b = `// world\nconst x = 1;`;
    expect(() => assertCommentsPreserved(a, b)).toThrow(/comment/i);
  });
});

describe('assertWhitespacePreservedOutsidePatches', () => {
  it('passes when only patched ranges differ', () => {
    const before = 'aaa BBB ccc';
    const after = 'aaa XXX ccc';
    const patches: TextPatch[] = [{ start: 4, end: 7, replacement: 'XXX', reason: '' }];
    expect(() => assertWhitespacePreservedOutsidePatches(before, after, patches)).not.toThrow();
  });

  it('fails when content outside patch ranges differs', () => {
    const before = 'aaa BBB ccc';
    const after = 'aXa XXX ccc';
    const patches: TextPatch[] = [{ start: 4, end: 7, replacement: 'XXX', reason: '' }];
    expect(() => assertWhitespacePreservedOutsidePatches(before, after, patches)).toThrow(/outside/i);
  });

  it('handles insertions (start === end)', () => {
    const before = 'abc';
    const after = 'aXbc';
    const patches: TextPatch[] = [{ start: 1, end: 1, replacement: 'X', reason: '' }];
    expect(() => assertWhitespacePreservedOutsidePatches(before, after, patches)).not.toThrow();
  });
});
