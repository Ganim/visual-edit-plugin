import { describe, it, expect } from 'vitest';
import { rewriteImageUrl, rewriteSrcSet } from '../src/rewriter.js';

describe('rewriteImageUrl', () => {
  it('rewrites https URLs', () => {
    expect(rewriteImageUrl('https://example.com/a.png'))
      .toBe('/__assets/proxy?u=https%3A%2F%2Fexample.com%2Fa.png');
  });
  it('rewrites http URLs', () => {
    expect(rewriteImageUrl('http://x/y.png'))
      .toBe('/__assets/proxy?u=http%3A%2F%2Fx%2Fy.png');
  });
  it('passes local paths through', () => {
    expect(rewriteImageUrl('/logo.png')).toBe('/logo.png');
    expect(rewriteImageUrl('./x.png')).toBe('./x.png');
  });
  it('passes data: URLs through', () => {
    expect(rewriteImageUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });
});

describe('rewriteSrcSet', () => {
  it('rewrites each entry preserving descriptors', () => {
    const out = rewriteSrcSet('https://x/a.png 1x, https://x/b.png 2x');
    expect(out).toContain('https%3A%2F%2Fx%2Fa.png 1x');
    expect(out).toContain('https%3A%2F%2Fx%2Fb.png 2x');
  });
  it('handles single entries', () => {
    const out = rewriteSrcSet('https://x/c.png');
    expect(out).toBe('/__assets/proxy?u=https%3A%2F%2Fx%2Fc.png');
  });
});
