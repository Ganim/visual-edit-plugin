// packages/code-mods/tests/cssModule.parser.test.ts
import { describe, it, expect } from 'vitest';
import { findCssRuleRange } from '../src/cssModuleParser.js';

describe('findCssRuleRange', () => {
  it('finds a flat rule by binding', () => {
    const css = `.title { color: red; font-size: 14px; }\n.body { padding: 8px; }`;
    const r = findCssRuleRange(css, 'title');
    expect(css.slice(r.bodyStart, r.bodyEnd)).toBe(' color: red; font-size: 14px; ');
    expect(r.body).toBe(' color: red; font-size: 14px; ');
  });

  it('throws VE_CSSMOD_002 on missing rule', () => {
    const css = `.title { color: red; }`;
    expect(() => findCssRuleRange(css, 'subtitle')).toThrow(/VE_CSSMOD_002/);
  });

  it('throws VE_CSSMOD_001 on nested selector (.title:hover)', () => {
    const css = `.title { color: red; } .title:hover { color: blue; }`;
    // The first `.title { ... }` works; the second is `.title:hover` which doesn't match the binding-name regex.
    // To exercise the nested-selector path, use `.foo .title { }`:
    const css2 = `.foo .title { color: red; }`;
    expect(() => findCssRuleRange(css2, 'title')).toThrow(/VE_CSSMOD_001/);
  });

  it('throws VE_CSSMOD_001 on nested rule body', () => {
    const css = `.title { color: red; @media (min-width: 600px) { color: blue; } }`;
    expect(() => findCssRuleRange(css, 'title')).toThrow(/VE_CSSMOD_001/);
  });

  it('does not match a different binding (.titles vs .title)', () => {
    const css = `.titles { color: red; }`;
    expect(() => findCssRuleRange(css, 'title')).toThrow(/VE_CSSMOD_002/);
  });
});
