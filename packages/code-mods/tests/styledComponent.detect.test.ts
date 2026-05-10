import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';

describe('styled-components detection in instrument', () => {
  it('records styledComponent on <Title> when const Title = styled.h1`color: blue;`', () => {
    const src = `
import styled from 'styled-components';
const Title = styled.h1\`color: blue;\`;
export const X = () => <Title>hello</Title>;
`;
    const result = instrument(src, 'X.tsx');
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.tagName).toBe('Title');
    expect(entry.styledComponent).not.toBeNull();
    expect(entry.styledComponent!.componentName).toBe('Title');
    // The template content should be 'color: blue;'
    const content = result.instrumented.slice(
      entry.styledComponent!.templateStart,
      entry.styledComponent!.templateEnd,
    );
    expect(content).toBe('color: blue;');
  });

  it('null styledComponent for non-styled tag (<div>hi</div>)', () => {
    const src = `export const X = () => <div>hi</div>;\n`;
    const result = instrument(src, 'X.tsx');
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.styledComponent).toBeNull();
  });

  it('skips styled with interpolated template (no styledComponent recorded)', () => {
    const src = `
import styled from 'styled-components';
const color = 'blue';
const Title = styled.h1\`color: \${color};\`;
export const X = () => <Title>hello</Title>;
`;
    const result = instrument(src, 'X.tsx');
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.tagName).toBe('Title');
    expect(entry.styledComponent).toBeNull();
  });
});

describe('planEdits styled-prop refusals', () => {
  it('refuses styled-prop on cross-file imported component (uppercase tag, no local definition)', () => {
    // Simulate a file that uses an imported styled component (no local styled definition)
    const src = `
import { Title } from './styled';
export const X = () => <Title>hello</Title>;
`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    // Confirm instrument sees Title as uppercase with no styledComponent
    expect(sourceMap[vid]!.tagName).toBe('Title');
    expect(sourceMap[vid]!.styledComponent).toBeNull();

    expect(() =>
      planEdits({
        filePath: 'X.tsx',
        source: instrumented,
        sourceMap,
        edits: [{ kind: 'styled-prop', element: vid, newTemplateContent: 'color: red;' }],
        resolvePath: () => '',
        readExternalFile: () => '',
      }),
    ).toThrow(/VE_STYLED_001/);
  });

  it('refuses styled-prop when template has interpolation (styledComponent null, uppercase tag → VE_STYLED_001)', () => {
    // Interpolated template: instrument skips recording styledComponent
    const src = `
import styled from 'styled-components';
const color = 'blue';
const Title = styled.h1\`color: \${color};\`;
export const X = () => <Title>hello</Title>;
`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    expect(sourceMap[vid]!.tagName).toBe('Title');
    expect(sourceMap[vid]!.styledComponent).toBeNull();

    expect(() =>
      planEdits({
        filePath: 'X.tsx',
        source: instrumented,
        sourceMap,
        edits: [{ kind: 'styled-prop', element: vid, newTemplateContent: 'color: green;' }],
        resolvePath: () => '',
        readExternalFile: () => '',
      }),
    ).toThrow(/VE_STYLED_001/);
  });
});
