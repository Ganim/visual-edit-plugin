import { describe, it, expect } from 'vitest';
import { assertEditEquivalence } from '../../src/invariants/astEquivalence.ts';

describe('assertEditEquivalence', () => {
  it('passes when only className changed on targeted vid', () => {
    const before = `const x = <div data-vid="abc12345" className="foo" />;`;
    const after = `const x = <div data-vid="abc12345" className="bar baz" />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).not.toThrow();
  });

  it('passes when only style changed on targeted vid', () => {
    const before = `const x = <div data-vid="abc12345" />;`;
    const after = `const x = <div data-vid="abc12345" style={{ color: 'red' }} />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).not.toThrow();
  });

  it('passes when className added on targeted vid', () => {
    const before = `const x = <div data-vid="abc12345" />;`;
    const after = `const x = <div data-vid="abc12345" className="x" />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).not.toThrow();
  });

  it('fails when an unrelated attribute changes', () => {
    const before = `const x = <div data-vid="abc12345" id="a" className="foo" />;`;
    const after = `const x = <div data-vid="abc12345" id="b" className="bar" />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).toThrow(/unrelated/i);
  });

  it('fails when a non-targeted vid is modified', () => {
    const before = `<><div data-vid="aaaa1111" className="x" /><div data-vid="bbbb2222" className="y" /></>`;
    const after = `<><div data-vid="aaaa1111" className="X" /><div data-vid="bbbb2222" className="Y" /></>`;
    expect(() => assertEditEquivalence(before, after, ['aaaa1111'])).toThrow(/non-targeted/i);
  });

  it('fails when structure changes (element added)', () => {
    const before = `const x = <div data-vid="abc12345" />;`;
    const after = `const x = <div data-vid="abc12345"><span /></div>;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).toThrow(/structure/i);
  });
});
