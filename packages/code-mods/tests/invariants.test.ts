import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';
import { apply } from '../src/apply.js';
import {
  assertEditEquivalence,
  assertCommentsPreserved,
  assertWhitespacePreservedOutsidePatches,
} from '../src/index.js';

describe('invariants', () => {
  it('passes on a benign className edit', () => {
    const src =
      '// header comment\n' +
      'export const X = () => (\n' +
      '  <div className="old">\n' +
      '    {/* keep me */}\n' +
      '    <span>child</span>\n' +
      '  </div>\n' +
      ');\n';
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const divVid = Object.entries(sourceMap).find(([, e]) => e.tagName === 'div')![0];
    const result = planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'className', element: divVid, newValue: 'new' }],
      resolvePath: () => '', readExternalFile: () => '',
    });
    const patches = result.find((f) => f.filePath === 'X.tsx')!.patches;
    const { after } = apply(instrumented, patches);
    expect(() => assertEditEquivalence(instrumented, after, [divVid])).not.toThrow();
    expect(() => assertCommentsPreserved(instrumented, after)).not.toThrow();
    expect(() => assertWhitespacePreservedOutsidePatches(instrumented, after, patches)).not.toThrow();
  });

  it('rejects mutation of an unrelated className', () => {
    const src = `export const X = () => <><div className="a"></div><div className="b"></div></>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vids = Object.keys(sourceMap);
    const targetVid = vids[0]!;
    // Manually corrupt the OTHER div's className.
    const corrupted = instrumented.replace('"b"', '"BAD"');
    expect(() => assertEditEquivalence(instrumented, corrupted, [targetVid])).toThrow(
      /non-targeted className/,
    );
  });

  it('rejects loss of a comment', () => {
    const src = '// keep\nexport const X = () => <div />;\n';
    const corrupted = 'export const X = () => <div />;\n';
    expect(() => assertCommentsPreserved(src, corrupted)).toThrow(/comment count mismatch/);
  });
});
