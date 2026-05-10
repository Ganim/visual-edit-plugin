import type { ProjectRoot, RouteSpec } from './ids.js';

export interface ProjectInfo {
  root: ProjectRoot;
  framework: 'vite' | 'cra' | 'unknown';
  reactVersion: string | null;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  styling: ('tailwind' | 'css-modules' | 'styled-components' | 'plain-css')[];
  tsconfigPaths: Record<string, string[]>;
  workspaces: string[] | null;
  publicDir: string | null;
  envFiles: string[];
  routes: PageEntry[];
  config: VisualEditConfig | null;
}

export interface PageEntry {
  route: RouteSpec;
  filePath: string;
  isClientOnly: boolean;
  cssImports: string[];
}

export interface VisualEditConfig {
  wrapPage: WrapPageFn;
  api?: ApiEndpoint[];
  routes?: string;
  mocks?: Record<string, unknown>;
  safeEnvPrefixes?: string[];
  assetProxy?: {
    remoteImageStrategy?: 'placeholder' | 'pass-through' | 'cached';
    fontFallback?: 'system' | Record<string, string>;
  };
}

/**
 * Opaque function type — we never call wrapPage in Node; it runs in the synthetic
 * preview entry. Typed loosely here so the analyzer doesn't depend on React.
 */
export type WrapPageFn = (children: unknown) => unknown;

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string | RegExp;
  schemaName: string;
  status?: number;
}

export interface MockSchema {
  name: string;
  source: 'zod' | 'ts-type' | 'heuristic';
  /** JSON Schema draft 7 shape — we use a small subset (object/array/string/number/boolean) */
  shape: Record<string, unknown>;
  endpoint?: ApiEndpoint;
}
