import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.ts';

describe('instrument — baseline', () => {
  it('adds data-vid to single self-closing element', () => {
    const src = `const x = <img src="a.png" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vids = Object.keys(sourceMap);
    expect(vids).toHaveLength(1);
    expect(instrumented).toContain(`data-vid="${vids[0]}"`);
    expect(instrumented).toContain(`src="a.png"`);
    expect(instrumented).toMatch(/<img src="a\.png" data-vid="[0-9a-f]{8}" \/>/);
  });

  it('adds data-vid to single element with children', () => {
    const src = `const x = <div className="foo">hello</div>;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(1);
    expect(instrumented).toMatch(/<div className="foo" data-vid="[0-9a-f]{8}">hello<\/div>/);
  });

  it('records classNameAttr range when present', () => {
    const src = `const x = <div className="foo" />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    const entry = Object.values(sourceMap)[0]!;
    expect(entry.classNameAttr).not.toBeNull();
    expect(entry.classNameAttr!.valueKind).toBe('string-literal');
    const valueText = src.slice(entry.classNameAttr!.valueStart, entry.classNameAttr!.valueEnd);
    expect(valueText).toBe('foo');
  });

  it('records styleAttr range when present', () => {
    const src = `const x = <div style={{ color: 'red' }} />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    const entry = Object.values(sourceMap)[0]!;
    expect(entry.styleAttr).not.toBeNull();
    expect(entry.styleAttr!.valueKind).toBe('expression');
  });

  it('reports null classNameAttr and styleAttr when absent', () => {
    const src = `const x = <div id="a" />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    const entry = Object.values(sourceMap)[0]!;
    expect(entry.classNameAttr).toBeNull();
    expect(entry.styleAttr).toBeNull();
  });
});

describe('instrument — complex shapes', () => {
  it('handles nested elements with unique vids', () => {
    const src = `const x = <div><span>a</span><span>b</span></div>;`;
    const { sourceMap, instrumented } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(3); // div + 2 spans
    const vids = Object.keys(sourceMap);
    expect(new Set(vids).size).toBe(3); // all unique
    for (const v of vids) {
      expect(instrumented).toContain(`data-vid="${v}"`);
    }
  });

  it('skips fragments (<>...</>)', () => {
    const src = `const x = <><div /><span /></>;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    // Fragment itself has no opening tag we instrument; only div + span.
    expect(Object.keys(sourceMap)).toHaveLength(2);
    const tagNames = Object.values(sourceMap).map((e) => e.tagName).sort();
    expect(tagNames).toEqual(['div', 'span']);
  });

  it('handles conditional JSX', () => {
    const src = `const x = cond ? <div /> : <span />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(2);
  });

  it('handles JSX inside expression children', () => {
    const src = `const x = <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(2); // ul + li
  });

  it('is idempotent (re-instrumentation does not add new patches; sourceMap is repopulated from existing vids)', () => {
    const src = `const x = <div className="foo" />;`;
    const r1 = instrument(src, 'a.tsx');
    const r2 = instrument(r1.instrumented, 'a.tsx');
    // No new patches — instrumented string unchanged.
    expect(r2.instrumented).toBe(r1.instrumented);
    // Same vids on both passes (positions in instrumented are stable across reruns,
    // and existing vids are read back from data-vid attrs).
    expect(Object.keys(r2.sourceMap).sort()).toEqual(Object.keys(r1.sourceMap).sort());
  });
});
