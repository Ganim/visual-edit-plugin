import { describe, it, expect } from 'vitest';
import { runEditPipeline } from '../src/pipeline.js';

describe('runEditPipeline', () => {
  it('end-to-end: instrument, plan, apply, validate', () => {
    const src = `// page
export default function Home() {
  return (
    <main className="p-4">
      <h1 className="text-3xl">Hello</h1>
    </main>
  );
}
`;
    const result = runEditPipeline({
      filePath: 'Home.tsx',
      source: src,
      pickEdit: (vids, sourceMap) => {
        const h1 = Object.entries(sourceMap).find(([, e]) => e.tagName === 'h1')![0];
        return { kind: 'className', element: h1, newValue: 'text-3xl text-red-500' };
      },
    });
    expect(result.after).toContain('text-3xl text-red-500');
    expect(result.after).toContain('// page'); // comment preserved
    expect(result.beforeHash).not.toBe(result.afterHash);
    expect(result.patches).toHaveLength(1);
  });

  it('throws when result fails to parse (mutateAfter corrupts)', () => {
    const src = `export const X = () => <div>hi</div>;\n`;
    expect(() =>
      runEditPipeline({
        filePath: 'X.tsx',
        source: src,
        pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'p-2' }),
        mutateAfter: (s) => s.replace('</div>', ''), // strip closing tag
      }),
    ).toThrow(/VE_CODEMOD_002/);
  });
});
