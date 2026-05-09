import { join, relative, resolve, sep } from 'node:path';
import fg from 'fast-glob';
import type { PageEntry } from '@visual-edit/shared';

const DEFAULT_GLOB = 'src/pages/**/*.tsx';

export async function findRoutes(root: string, configRoutesGlob: string | undefined): Promise<PageEntry[]> {
  const pattern = configRoutesGlob ?? DEFAULT_GLOB;
  const canonicalRoot = resolve(root) + sep; // trailing sep prevents 'src' matching 'src-other'
  const matches = await fg(pattern, { cwd: root, absolute: true });
  return matches
    // Defense in depth: glob can't normally escape root, but symlinks/aliases can.
    // Drop anything outside canonical root so the adapter's fs.allow doesn't refuse it later.
    .filter((absPath) => resolve(absPath).startsWith(canonicalRoot))
    .map<PageEntry>((absPath) => ({
      route: relative(root, absPath).replace(/\\/g, '/'),
      filePath: absPath,
      isClientOnly: true, // Phase 1.A: assume all are client-only; SSR detection is post-MVP
      cssImports: [],     // Populated when we instrument; stays empty here
    }));
}
