import { describe, it, expect } from 'vitest';
import { computeVid } from '../src/vid.ts';

describe('computeVid', () => {
  it('produces 8-char hex string', () => {
    const vid = computeVid({ filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' });
    expect(vid).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = computeVid({ filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' });
    const b = computeVid({ filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' });
    expect(a).toBe(b);
  });

  it('differs when any input differs', () => {
    const base = { filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' };
    expect(computeVid(base)).not.toBe(computeVid({ ...base, filePath: 'src/B.tsx' }));
    expect(computeVid(base)).not.toBe(computeVid({ ...base, start: 11 }));
    expect(computeVid(base)).not.toBe(computeVid({ ...base, end: 51 }));
    expect(computeVid(base)).not.toBe(computeVid({ ...base, tagName: 'span' }));
  });
});
