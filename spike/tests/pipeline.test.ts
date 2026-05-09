import { describe, it, expect } from 'vitest';
import { runEditPipeline } from '../src/pipeline.ts';

describe('runEditPipeline', () => {
  it('end-to-end: instrument → plan → apply, all invariants hold', () => {
    const src = `// hello\nconst x = <div className="foo">hi</div>;`;
    const { sourceMap, after, patches } = runEditPipeline({
      filePath: 'a.tsx',
      source: src,
      pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'bar' }),
    });
    expect(Object.keys(sourceMap)).toHaveLength(1);
    expect(after).toContain('className="bar"');
    expect(after).toContain('// hello');
    expect(patches.length).toBeGreaterThan(0);
  });

  it('throws when invariants fail (synthetic corruption)', () => {
    expect(() => {
      const src = `<div className="x" />`;
      runEditPipeline({
        filePath: 'a.tsx',
        source: src,
        pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'y' }),
        // Corrupt: replace the entire result to force a mismatch.
        mutateAfter: () => `<span className="y" />`,
      });
    }).toThrow();
  });
});
