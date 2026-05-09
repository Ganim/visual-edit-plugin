import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEphemeralPreview } from '../src/generate.js';
import type { AdapterInput } from '../src/types.js';
import type { ProjectInfo, PageEntry } from '@visual-edit/shared';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 've-test-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('generateEphemeralPreview', () => {
  it('creates entry.tsx + vite.config.ts + index.html in .visual-edit/preview-<hash>/', async () => {
    const info: ProjectInfo = {
      root: workdir as never,
      framework: 'vite',
      reactVersion: '18.3.1',
      packageManager: 'npm',
      styling: ['tailwind'],
      tsconfigPaths: { '@/*': ['./src/*'] },
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
    const input: AdapterInput = {
      info,
      page,
      config: null,
      schemas: [],
      port: 5180,
      sessionId: 'abc12345',
      env: { VITE_PUBLIC_FOO: 'bar' },
    };

    const result = await generateEphemeralPreview(input);
    expect(existsSync(result.entryPath)).toBe(true);
    expect(existsSync(result.viteConfigPath)).toBe(true);
    expect(existsSync(result.indexHtmlPath)).toBe(true);

    const entry = readFileSync(result.entryPath, 'utf8');
    // Entry must use a RELATIVE import (not a Windows absolute path).
    expect(entry).toMatch(/import Page from '\.\.\/.+\/Home\.tsx';/);
    expect(entry).not.toMatch(/import Page from '[A-Za-z]:\//);
    expect(entry).toContain('createRoot');

    const html = readFileSync(result.indexHtmlPath, 'utf8');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain(`<script type="module" src="/entry.tsx"></script>`);

    const viteCfg = readFileSync(result.viteConfigPath, 'utf8');
    expect(viteCfg).toContain(`alias: {`);
    expect(viteCfg).toContain(`'@'`);
    expect(viteCfg).toContain(`port: 5180`);
    // Must embed EPHEMERAL_DIR as a string literal, NOT use __dirname (undefined in ESM).
    expect(viteCfg).not.toContain(`__dirname`);
    expect(viteCfg).toContain(`const EPHEMERAL_DIR =`);
    expect(viteCfg).toContain(`server: {`);
    expect(viteCfg).toContain(`fs: {`);
    expect(viteCfg).toContain(`allow: [USER_ROOT, EPHEMERAL_DIR]`);
  });

  it('preserves user vite.config aliases by extending', async () => {
    const info: ProjectInfo = {
      root: workdir as never,
      framework: 'vite',
      reactVersion: '18.3.1',
      packageManager: 'npm',
      styling: [],
      tsconfigPaths: { '@components/*': ['./src/components/*'], '@/*': ['./src/*'] },
      workspaces: null,
      publicDir: null,
      envFiles: [],
      routes: [],
      config: null,
    };
    const page: PageEntry = {
      route: 'src/pages/X.tsx',
      filePath: join(workdir, 'src/pages/X.tsx'),
      isClientOnly: true,
      cssImports: [],
    };
    const input: AdapterInput = {
      info,
      page,
      config: null,
      schemas: [],
      port: 5181,
      sessionId: 's',
      env: {},
    };
    const result = await generateEphemeralPreview(input);
    const viteCfg = readFileSync(result.viteConfigPath, 'utf8');
    expect(viteCfg).toContain(`'@components'`);
    expect(viteCfg).toContain(`'@'`);
  });
});
