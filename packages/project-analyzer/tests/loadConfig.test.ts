import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/loadConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VITE_FIXTURE = resolve(__dirname, '__fixtures__/projects/vite-tailwind');
const UNSAFE_FIXTURE = resolve(__dirname, '__fixtures__/projects/unsafe-env');

describe('loadConfig', () => {
  it('returns null when visual-edit.config.ts is absent', async () => {
    // Use a tmp dir with no config
    const cfg = await loadConfig('/no/such/dir/__missing__');
    expect(cfg).toBeNull();
  });

  it('loads a valid config and returns wrapPage', async () => {
    const cfg = await loadConfig(VITE_FIXTURE);
    expect(cfg).not.toBeNull();
    expect(typeof cfg!.wrapPage).toBe('function');
    expect(cfg!.safeEnvPrefixes).toEqual(['VITE_', 'PUBLIC_']);
  });

  it('throws VE_CONFIG_001 when config touches an unsafe env var', async () => {
    await expect(loadConfig(UNSAFE_FIXTURE)).rejects.toThrow(/VE_CONFIG_001/);
  });
});
