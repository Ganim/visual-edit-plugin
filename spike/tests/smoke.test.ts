import { describe, it, expect } from 'vitest';
import { SPIKE_VERSION } from '../src/index.ts';

describe('smoke', () => {
  it('module loads', () => {
    expect(SPIKE_VERSION).toBe('0.0.0');
  });
});
