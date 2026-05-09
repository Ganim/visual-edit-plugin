import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.ts';
import { planEdits } from '../src/planEdits.ts';

describe('planEdits — className', () => {
  it('replaces string-literal className value', () => {
    const src = `const x = <div className="foo" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: vid, newValue: 'bar baz' },
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(instrumented.slice(patch.start, patch.end)).toBe('foo');
    expect(patch.replacement).toBe('bar baz');
  });

  it('throws when element vid is unknown', () => {
    const src = `const x = <div className="foo" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    expect(() =>
      planEdits(instrumented, sourceMap, [
        { kind: 'className', element: 'deadbeef', newValue: 'x' },
      ]),
    ).toThrow(/unknown element/i);
  });

  it('adds className attr when absent', () => {
    const src = `const x = <div id="a" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: vid, newValue: 'newcls' },
    ]);
    expect(patches).toHaveLength(1);
    // Should insert ` className="newcls"` at attrsInsertPos.
    expect(patches[0]!.replacement).toBe(' className="newcls"');
    const entry = sourceMap[vid]!;
    expect(patches[0]!.start).toBe(entry.attrsInsertPos);
    expect(patches[0]!.end).toBe(entry.attrsInsertPos);
  });
});

describe('planEdits — style', () => {
  it('replaces existing style={{...}} expression entirely', () => {
    const src = `const x = <div style={{ color: 'red' }} />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'style', element: vid, newObjectText: "{ color: 'blue', padding: 4 }" },
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(instrumented.slice(patch.start, patch.end)).toBe(`style={{ color: 'red' }}`);
    expect(patch.replacement).toBe(`style={{ color: 'blue', padding: 4 }}`);
  });

  it('adds style attr when absent', () => {
    const src = `const x = <div className="foo" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'style', element: vid, newObjectText: "{ color: 'blue' }" },
    ]);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.replacement).toBe(` style={{ color: 'blue' }}`);
  });

  it('plans both className and style edits in one call', () => {
    const src = `const x = <div />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: vid, newValue: 'cls' },
      { kind: 'style', element: vid, newObjectText: '{ color: "red" }' },
    ]);
    expect(patches).toHaveLength(2);
  });
});
