import fc from 'fast-check';
import type { ElementId, SpikeEdit } from '../../src/types.ts';

export const editArb = (vids: ElementId[]): fc.Arbitrary<SpikeEdit> =>
  fc.oneof(
    fc.record({
      kind: fc.constant('className' as const),
      element: fc.constantFrom(...vids),
      newValue: fc
        .array(fc.constantFrom('flex', 'p-4', 'text-blue-500', 'rounded', 'gap-2'), { minLength: 1, maxLength: 4 })
        .map((a) => a.join(' ')),
    }),
    fc.record({
      kind: fc.constant('style' as const),
      element: fc.constantFrom(...vids),
      newObjectText: fc.constantFrom(
        "{ color: 'blue' }",
        "{ padding: 8, margin: 4 }",
        "{ background: '#fff' }",
      ),
    }),
  );
