import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyze.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '__fixtures__/projects/vite-tailwind');

describe('analyze', () => {
  it('detects Vite + React + Tailwind from package.json', async () => {
    const info = await analyze(FIXTURE);
    expect(info.framework).toBe('vite');
    expect(info.reactVersion).toBe('18.3.1');
    expect(info.styling).toContain('tailwind');
    expect(info.packageManager).toBe('npm'); // default fallback
  });

  it('extracts tsconfig paths', async () => {
    const info = await analyze(FIXTURE);
    expect(info.tsconfigPaths['@/*']).toEqual(['./src/*']);
  });

  it('returns publicDir as null when not present', async () => {
    const info = await analyze(FIXTURE);
    expect(info.publicDir).toBeNull();
  });

  it('returns config: null when visual-edit.config.ts is absent', async () => {
    const info = await analyze(FIXTURE);
    expect(info.config).toBeNull();
  });
});
