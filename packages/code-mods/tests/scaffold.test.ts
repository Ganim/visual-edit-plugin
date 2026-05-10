import { describe, it, expect } from 'vitest';
import * as codemods from '../src/index.js';

describe('code-mods scaffold', () => {
  it('exports a stable public surface (placeholder until Task 2+)', () => {
    expect(codemods).toBeDefined();
    expect(typeof codemods).toBe('object');
  });
});
