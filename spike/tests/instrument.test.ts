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
