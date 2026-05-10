import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';
import type { Edit } from '@visual-edit/shared';

describe('planEdits', () => {
  it('plans a className replacement on existing string-literal className', () => {
    const src = `export const X = () => <div className="a b">hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const edits: Edit[] = [{ kind: 'className', element: vid, newValue: 'text-red-500' }];
    const result = planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap, edits,
      resolvePath: () => '', readExternalFile: () => '',
    });
    const patches = result.find((f) => f.filePath === 'X.tsx')!.patches;
    expect(patches).toHaveLength(1);
    expect(patches[0]!.replacement).toBe('text-red-500');
    const before = sourceMap[vid]!.classNameAttr!;
    expect(patches[0]!.start).toBe(before.valueStart);
    expect(patches[0]!.end).toBe(before.valueEnd);
  });

  it('inserts new className when missing', () => {
    const src = `export const X = () => <div>hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const result = planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'className', element: vid, newValue: 'p-4' }],
      resolvePath: () => '', readExternalFile: () => '',
    });
    const patches = result.find((f) => f.filePath === 'X.tsx')!.patches;
    expect(patches[0]!.replacement).toBe(' className="p-4"');
  });

  it('plans a style edit (object text replacement)', () => {
    const src = `export const X = () => <div style={{ color: 'blue' }}>hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const result = planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'style', element: vid, newObjectText: "{ color: 'red' }" }],
      resolvePath: () => '', readExternalFile: () => '',
    });
    const patches = result.find((f) => f.filePath === 'X.tsx')!.patches;
    expect(patches[0]!.replacement).toBe("style={{ color: 'red' }}");
  });

  it('throws on unknown vid', () => {
    const src = `export const X = () => <div>hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    expect(() =>
      planEdits({
        filePath: 'X.tsx', source: instrumented, sourceMap,
        edits: [{ kind: 'className', element: 'deadbeef', newValue: 'x' }],
        resolvePath: () => '', readExternalFile: () => '',
      }),
    ).toThrow(/VE_CODEMOD_001/);
  });

  it('plans multiple edits across multiple elements', () => {
    const src = `export const X = () => <div className="a"><span className="b" /></div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const [vid1, vid2] = Object.keys(sourceMap);
    const result = planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [
        { kind: 'className', element: vid1!, newValue: 'A' },
        { kind: 'className', element: vid2!, newValue: 'B' },
      ],
      resolvePath: () => '', readExternalFile: () => '',
    });
    const patches = result.find((f) => f.filePath === 'X.tsx')!.patches;
    expect(patches).toHaveLength(2);
    expect(patches.map((p) => p.replacement).sort()).toEqual(['A', 'B']);
  });
});
