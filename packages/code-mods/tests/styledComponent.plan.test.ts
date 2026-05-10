import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';

describe('planEdits with styled-prop', () => {
  it('produces a single-file patch on the styled template content', () => {
    const src = `
import styled from 'styled-components';
const Title = styled.h1\`color: blue;\`;
export const X = () => <Title>hello</Title>;
`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const entry = sourceMap[vid]!;
    expect(entry.styledComponent).not.toBeNull();

    const planned = planEdits({
      filePath: 'X.tsx',
      source: instrumented,
      sourceMap,
      edits: [{ kind: 'styled-prop', element: vid, newTemplateContent: 'color: green;' }],
      resolvePath: () => '',
      readExternalFile: () => '',
    });

    expect(planned).toHaveLength(1);
    const file = planned[0]!;
    expect(file.filePath).toBe('X.tsx');
    expect(file.patches).toHaveLength(1);
    const patch = file.patches[0]!;
    expect(patch.replacement).toBe('color: green;');

    // Verify the patch targets the right positions (the original template content)
    const originalContent = instrumented.slice(patch.start, patch.end);
    expect(originalContent).toBe('color: blue;');
  });
});
