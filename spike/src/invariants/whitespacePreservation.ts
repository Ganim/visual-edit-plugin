import type { TextPatch } from '../types.ts';

/**
 * Assert that everything in `before` outside of patched ranges appears verbatim in `after`,
 * and that everything in `after` outside of (shifted) patched ranges matches `before`.
 */
export function assertWhitespacePreservedOutsidePatches(
  before: string,
  after: string,
  patches: TextPatch[],
): void {
  if (patches.length === 0) {
    if (before !== after) throw new Error('no patches but content differs');
    return;
  }

  const sorted = [...patches].sort((a, b) => a.start - b.start);

  // Build aligned segment list: alternating "context" (must match) and "patched" (replaced).
  let beforeCursor = 0;
  let afterCursor = 0;

  for (const p of sorted) {
    const contextLen = p.start - beforeCursor;
    const beforeContext = before.slice(beforeCursor, p.start);
    const afterContext = after.slice(afterCursor, afterCursor + contextLen);
    if (beforeContext !== afterContext) {
      throw new Error(
        `whitespace/content outside patch differs at before[${beforeCursor},${p.start}) vs after[${afterCursor},${afterCursor + contextLen})`,
      );
    }
    afterCursor += contextLen;
    // Skip the patch in `before`, advance `after` by replacement length.
    beforeCursor = p.end;
    afterCursor += p.replacement.length;
  }

  // Trailing context.
  const beforeTail = before.slice(beforeCursor);
  const afterTail = after.slice(afterCursor);
  if (beforeTail !== afterTail) {
    throw new Error(
      `trailing content differs: before[${beforeCursor}..]='${beforeTail.slice(0, 40)}...' vs after[${afterCursor}..]='${afterTail.slice(0, 40)}...'`,
    );
  }
}
