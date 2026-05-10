import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEphemeralPreview, loadMswServiceWorker } from '../src/generate.js';
import type { AdapterInput } from '../src/types.js';
import type { ProjectInfo, PageEntry } from '@visual-edit/shared';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 've-msw-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function makeInput(overrides: Partial<AdapterInput> = {}): AdapterInput {
  const info: ProjectInfo = {
    root: workdir as never,
    framework: 'vite',
    reactVersion: '18.3.1',
    packageManager: 'npm',
    styling: [],
    tsconfigPaths: {},
    workspaces: null,
    publicDir: null,
    envFiles: [],
    routes: [],
    config: null,
  };
  const page: PageEntry = {
    route: 'src/pages/Home.tsx',
    filePath: join(workdir, 'src/pages/Home.tsx'),
    isClientOnly: true,
    cssImports: [],
  };
  return {
    info,
    page,
    config: null,
    schemas: [],
    port: 5199,
    sessionId: 'msw-test',
    env: {},
    ...overrides,
  };
}

describe('generateEphemeralPreview — MSW service worker', () => {
  it('writes mockServiceWorker.js into the ephemeral preview dir', async () => {
    const result = await generateEphemeralPreview(makeInput());
    const swPath = join(result.ephemeralDir, 'mockServiceWorker.js');
    expect(existsSync(swPath)).toBe(true);
  });

  it('mockServiceWorker.js content contains "Mock Service Worker" preamble', async () => {
    const result = await generateEphemeralPreview(makeInput());
    const swPath = join(result.ephemeralDir, 'mockServiceWorker.js');
    const content = readFileSync(swPath, 'utf8');
    expect(content).toContain('Mock Service Worker');
  });
});

describe('loadMswServiceWorker', () => {
  it('returns a non-empty string', () => {
    const src = loadMswServiceWorker();
    expect(typeof src).toBe('string');
    expect(src.length).toBeGreaterThan(0);
  });

  it('contains the MSW service worker preamble', () => {
    const src = loadMswServiceWorker();
    expect(src).toContain('Mock Service Worker');
  });

  it('returns the same reference on repeated calls (caching)', () => {
    const first = loadMswServiceWorker();
    const second = loadMswServiceWorker();
    expect(first).toBe(second);
  });
});
