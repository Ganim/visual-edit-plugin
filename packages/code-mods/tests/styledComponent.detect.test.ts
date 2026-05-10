import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';

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
