import { describe, it } from 'vitest';
import fc from 'fast-check';
import { jsxNodeArb, renderJsx, wrapInModule } from './helpers/tsxGenerator.ts';
import { editArb } from './helpers/randomEdit.ts';
import { instrument } from '../src/instrument.ts';
import { runEditPipeline } from '../src/pipeline.ts';

describe('property: random TSX × random edits preserve invariants', () => {
  it('1000 iterations clean', () => {
    fc.assert(
      fc.property(jsxNodeArb, (node) => {
        const source = wrapInModule(renderJsx(node));
        const { sourceMap } = instrument(source, 'gen.tsx');
        const vids = Object.keys(sourceMap);
        if (vids.length === 0) return; // generator may produce empty trees occasionally; skip
        return fc.assert(
          fc.property(editArb(vids), (edit) => {
            runEditPipeline({
              filePath: 'gen.tsx',
              source,
              pickEdit: () => edit,
            });
            return true;
          }),
          { numRuns: 5 },
        );
      }),
      { numRuns: 200 }, // 200 outer × 5 inner = 1000 total
    );
  }, 120_000);
});
