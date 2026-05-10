import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';

describe('CSS Module detection in instrument', () => {
  it('records cssModule on JSX element using styles.X', () => {
    const src = `import styles from './Home.module.css';
export const X = () => <h2 className={styles.subtitle}>hi</h2>;
`;
    const result = instrument(src, 'Home.tsx');
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.cssModule).toEqual({
      importedAs: 'styles',
      importPath: './Home.module.css',
      binding: 'subtitle',
    });
  });

  it('null cssModule for plain string className', () => {
    const src = `export const X = () => <div className="plain">hi</div>;\n`;
    const result = instrument(src, 'X.tsx');
    expect(Object.values(result.sourceMap)[0]!.cssModule).toBeNull();
  });

  it('null cssModule for non-module CSS import', () => {
    const src = `import s from './styles.css';
export const X = () => <div className={s.foo}>hi</div>;
`;
    const result = instrument(src, 'X.tsx');
    expect(Object.values(result.sourceMap)[0]!.cssModule).toBeNull();
  });

  it('handles renamed default import', () => {
    const src = `import classes from './Card.module.css';
export const X = () => <div className={classes.card}>hi</div>;
`;
    const result = instrument(src, 'Card.tsx');
    expect(Object.values(result.sourceMap)[0]!.cssModule).toEqual({
      importedAs: 'classes',
      importPath: './Card.module.css',
      binding: 'card',
    });
  });
});
