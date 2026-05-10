import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';

describe('instrument', () => {
  it('injects data-vid into a single JSX element', () => {
    const src = `export const X = () => <div className="x">hi</div>;\n`;
    const result = instrument(src, 'X.tsx');
    expect(result.instrumented).toMatch(/<div className="x" data-vid="[a-f0-9]{8}">hi<\/div>/);
    expect(Object.keys(result.sourceMap)).toHaveLength(1);
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.tagName).toBe('div');
    expect(entry.classNameAttr).not.toBeNull();
    expect(entry.styleAttr).toBeNull();
  });

  it('preserves an existing data-vid', () => {
    const src = `export const X = () => <p data-vid="abc12345">hi</p>;\n`;
    const result = instrument(src, 'X.tsx');
    expect(result.instrumented).toBe(src);
    expect(result.sourceMap['abc12345']).toBeDefined();
  });

  it('handles self-closing elements', () => {
    const src = `export const X = () => <img src="a.png" />;\n`;
    const result = instrument(src, 'X.tsx');
    expect(result.instrumented).toMatch(/<img src="a.png" data-vid="[a-f0-9]{8}" \/>/);
  });

  it('records expression-style className range', () => {
    const src = `export const X = () => <div className={cn('a', 'b')}>hi</div>;\n`;
    const result = instrument(src, 'X.tsx');
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.classNameAttr?.valueKind).toBe('expression');
  });
});
