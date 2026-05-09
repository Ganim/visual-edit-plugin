import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectInfo, ProjectRoot } from '@visual-edit/shared';

export async function analyze(rootInput: string): Promise<ProjectInfo> {
  const root = rootInput as ProjectRoot;
  const pkgJsonPath = join(root, 'package.json');
  const pkgRaw = await readFile(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

  const deps = {
    ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
  };

  const framework = deps['vite']
    ? 'vite'
    : deps['react-scripts']
      ? 'cra'
      : 'unknown';

  const reactVersion = deps['react'] ?? null;

  const styling: ProjectInfo['styling'] = [];
  if (deps['tailwindcss']) styling.push('tailwind');
  if (deps['styled-components']) styling.push('styled-components');
  // CSS modules detection requires file scan — Phase 1.C.

  const tsconfigPaths = await readTsconfigPaths(root);
  const publicDir = (await dirExists(join(root, 'public'))) ? 'public' : null;
  const envFiles = await listEnvFiles(root);
  const packageManager = await detectPackageManager(root);

  return {
    root,
    framework,
    reactVersion,
    packageManager,
    styling,
    tsconfigPaths,
    workspaces: (pkg.workspaces as string[] | undefined) ?? null,
    publicDir,
    envFiles,
    routes: [], // populated by findRoutes
    config: null, // populated by loadConfig
  };
}

async function readTsconfigPaths(
  root: string,
): Promise<Record<string, string[]>> {
  try {
    const raw = await readFile(join(root, 'tsconfig.json'), 'utf8');
    // Strip JSON-with-comments — minimal stripper: remove // ... and /* ... */
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    return parsed.compilerOptions?.paths ?? {};
  } catch {
    return {};
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listEnvFiles(root: string): Promise<string[]> {
  const candidates = ['.env', '.env.local', '.env.development', '.env.production'];
  const found: string[] = [];
  for (const c of candidates) {
    if (await dirExists(join(root, c))) found.push(c);
  }
  return found;
}

async function detectPackageManager(
  root: string,
): Promise<ProjectInfo['packageManager']> {
  if (await dirExists(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await dirExists(join(root, 'yarn.lock'))) return 'yarn';
  if (await dirExists(join(root, 'bun.lockb'))) return 'bun';
  if (await dirExists(join(root, 'package-lock.json'))) return 'npm';
  return 'npm'; // default
}
