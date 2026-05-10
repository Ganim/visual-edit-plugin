import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';

describe('planEdits with css-module', () => {
  it('produces a patch on the .module.css file', () => {
    const tsxSrc = `import styles from './X.module.css';
export const X = () => <h2 className={styles.title}>hi</h2>;
`;
    const cssSrc = `.title { color: red; }
.body { padding: 8px; }
`;
    const { instrumented, sourceMap } = instrument(tsxSrc, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const planned = planEdits({
      filePath: 'X.tsx',
      source: instrumented,
      sourceMap,
      edits: [{ kind: 'css-module', element: vid, binding: 'title', newRuleBody: 'color: blue;' }],
      resolvePath: () => '/abs/X.module.css',
      readExternalFile: () => cssSrc,
    });
    const cssFile = planned.find((p) => p.filePath === '/abs/X.module.css');
    expect(cssFile).toBeDefined();
    expect(cssFile!.patches).toHaveLength(1);
    expect(cssFile!.patches[0]!.replacement.trim()).toBe('color: blue;');
  });

  it('refuses when element has no CSS Module binding', () => {
    const tsxSrc = `export const X = () => <div className="plain">hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(tsxSrc, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    expect(() => planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'css-module', element: vid, binding: 'foo', newRuleBody: 'x: y;' }],
      resolvePath: () => '', readExternalFile: () => '',
    })).toThrow(/VE_CODEMOD_001/);
  });

  it('propagates VE_CSSMOD_002 when binding not found in CSS', () => {
    const tsxSrc = `import styles from './X.module.css';
export const X = () => <h2 className={styles.subtitle}>hi</h2>;
`;
    const cssSrc = `.title { color: red; }`;
    const { instrumented, sourceMap } = instrument(tsxSrc, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    expect(() => planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'css-module', element: vid, binding: 'subtitle', newRuleBody: 'x:y' }],
      resolvePath: () => '/abs/X.module.css', readExternalFile: () => cssSrc,
    })).toThrow(/VE_CSSMOD_002/);
  });
});
