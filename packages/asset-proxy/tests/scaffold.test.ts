import { describe, it, expect } from 'vitest';
import * as ap from '../src/index.js';

describe('asset-proxy scaffold', () => {
  it('module loads', () => {
    expect(typeof ap).toBe('object');
  });
});
