import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/loadConfig.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

describe('loadConfig sandbox', () => {
  it('rejects a config that imports fs', async () => {
    await expect(loadConfig(resolve(FIXTURES, 'config-with-fs'))).rejects.toThrow(/VE_CONFIG_002/);
  });

  it('rejects a config that calls fetch', async () => {
    await expect(loadConfig(resolve(FIXTURES, 'config-with-net'))).rejects.toThrow(/VE_CONFIG_002/);
  });

  it('accepts a clean config', async () => {
    const cfg = await loadConfig(resolve(FIXTURES, 'config-clean'));
    expect(cfg).not.toBeNull();
    expect(typeof cfg!.wrapPage).toBe('function');
  });
});
