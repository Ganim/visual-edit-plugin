import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoutes } from '../src/findRoutes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '__fixtures__/projects/vite-tailwind');

describe('findRoutes', () => {
  it('finds .tsx files under src/pages by default', async () => {
    const routes = await findRoutes(FIXTURE, undefined);
    expect(routes).toHaveLength(2);
    const paths = routes.map((r) => r.filePath).sort();
    expect(paths[0]).toMatch(/About\.tsx$/);
    expect(paths[1]).toMatch(/Home\.tsx$/);
  });

  it('uses config.routes glob when provided', async () => {
    const routes = await findRoutes(FIXTURE, 'src/components/**/*.tsx');
    expect(routes).toHaveLength(1);
    expect(routes[0]!.filePath).toMatch(/Button\.tsx$/);
  });

  it('returns empty array when no matches', async () => {
    const routes = await findRoutes(FIXTURE, 'src/nonexistent/**/*.tsx');
    expect(routes).toEqual([]);
  });

  it('PageEntry shape includes route, filePath, isClientOnly, cssImports', async () => {
    const routes = await findRoutes(FIXTURE, undefined);
    const home = routes.find((r) => r.filePath.endsWith('Home.tsx'))!;
    expect(home.route).toBe('src/pages/Home.tsx');
    expect(home.isClientOnly).toBe(true);
    expect(home.cssImports).toEqual([]);
  });
});
