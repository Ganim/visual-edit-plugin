import { mkdir, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildEntryWrapper, buildFakerBindings, buildMSWHandlers } from '@visual-edit/mock-runtime';
import type { AdapterInput, GenerateResult } from './types.js';

const _require = createRequire(import.meta.url);

let _cachedSwSource: string | null = null;

export function loadMswServiceWorker(): string {
  if (_cachedSwSource) return _cachedSwSource;
  // msw/lib/mockServiceWorker.js is not listed in the package's "exports" map,
  // so require.resolve('msw/lib/mockServiceWorker.js') throws. We resolve the
  // package root via its package.json (which IS exported implicitly) and then
  // navigate to the SW file by filesystem path.
  const mswRoot = join(_require.resolve('msw/package.json'), '..');
  const swPath = join(mswRoot, 'lib', 'mockServiceWorker.js');
  _cachedSwSource = readFileSync(swPath, 'utf8');
  return _cachedSwSource;
}

const CANDIDATE_CSS = ['src/index.css', 'src/main.css', 'src/app.css', 'src/styles.css'];

export async function generateEphemeralPreview(input: AdapterInput): Promise<GenerateResult> {
  const hash = createHash('sha256')
    .update(input.page.filePath)
    .update(input.sessionId)
    .digest('hex')
    .slice(0, 8);

  const ephemeralDir = resolve(input.info.root, '.visual-edit', `preview-${hash}`);
  await mkdir(ephemeralDir, { recursive: true });

  // Detect a global CSS file for Tailwind / user styles. Optional — entry import is conditional.
  // Note: app/globals.css (Next.js App Router) is intentionally NOT in the candidate list —
  // Next.js is out of scope for 1.A and will get a dedicated adapter later.
  const userCssAbs = await findFirstExisting(input.info.root, CANDIDATE_CSS);
  if (userCssAbs) {
    // Log to stderr so the daemon's log captures which CSS file was auto-detected.
    // If the wrong file is picked, the user can see it in the worker output.
    process.stderr.write(`[adapter-vite] using global css: ${userCssAbs}\n`);
  }

  // All entry imports are computed RELATIVE to ephemeralDir so Vite's module
  // resolver does not have to handle Windows absolute paths like `C:/...`.
  const toRelPosix = (absPath: string): string => {
    let r = relative(ephemeralDir, absPath).replace(/\\/g, '/');
    if (!r.startsWith('.')) r = './' + r;
    return r;
  };

  // Write faker bindings (sibling of entry)
  const fakerBindingsPath = join(ephemeralDir, 'faker-bindings.ts');
  await writeFile(fakerBindingsPath, buildFakerBindings(input.schemas), 'utf8');

  // Write MSW handlers module (sibling of entry). endpoints defaults to [] when not
  // provided in AdapterInput — the handler list will be empty and MSW startup short-
  // circuits via `if (handlers.length === 0) return;` in the entry wrapper.
  const handlersPath = join(ephemeralDir, 'handlers.ts');
  const handlersSource = buildMSWHandlers({
    schemas: input.schemas,
    endpoints: input.endpoints ?? [],
    overrides: {},
  });
  await writeFile(handlersPath, handlersSource, 'utf8');

  // Write entry — ALL paths are relative to ephemeralDir
  const entryPath = join(ephemeralDir, 'entry.tsx');
  const entry = buildEntryWrapper({
    pageImportPath: toRelPosix(input.page.filePath),
    configImportPath: input.config
      ? toRelPosix(join(input.info.root, 'visual-edit.config.ts'))
      : null,
    fakerBindingsImportPath: './faker-bindings.ts',
    userCssImportPath: userCssAbs ? toRelPosix(userCssAbs) : null,
    sessionId: input.sessionId,
  });
  await writeFile(entryPath, entry, 'utf8');

  // Write index.html
  const indexHtmlPath = join(ephemeralDir, 'index.html');
  await writeFile(indexHtmlPath, renderIndexHtml(input.sessionId), 'utf8');

  // Write vite.config.ts
  const viteConfigPath = join(ephemeralDir, 'vite.config.ts');
  await writeFile(viteConfigPath, renderViteConfig(input, ephemeralDir), 'utf8');

  // Write MSW service worker so the browser can register it at /mockServiceWorker.js.
  // The ephemeral dir is the Vite root (and therefore the public root), so placing it
  // here makes it available at the correct origin-relative path.
  const mswSwPath = join(ephemeralDir, 'mockServiceWorker.js');
  await writeFile(mswSwPath, loadMswServiceWorker(), 'utf8');

  return { ephemeralDir, entryPath, viteConfigPath, indexHtmlPath };
}

async function findFirstExisting(root: string, relPaths: string[]): Promise<string | null> {
  for (const rel of relPaths) {
    const abs = join(root, rel);
    try { await access(abs); return abs; } catch { /* keep searching */ }
  }
  return null;
}

function renderIndexHtml(sessionId: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Visual Edit Preview (${sessionId})</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/entry.tsx"></script>
  </body>
</html>
`;
}

function renderViteConfig(input: AdapterInput, ephemeralDir: string): string {
  const aliasEntries = Object.entries(input.info.tsconfigPaths)
    .map(([k, vs]) => {
      const cleanKey = k.replace(/\/\*$/, '');
      const cleanVal = (vs[0] ?? '').replace(/\/\*$/, '');
      return `      '${cleanKey}': resolve(USER_ROOT, '${cleanVal}'),`;
    })
    .join('\n');

  const userRootJs = JSON.stringify(input.info.root.replace(/\\/g, '/'));
  const ephemeralJs = JSON.stringify(ephemeralDir.replace(/\\/g, '/'));
  const publicDirJs = input.info.publicDir
    ? JSON.stringify(input.info.publicDir)
    : 'false';

  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const USER_ROOT = ${userRootJs};
const EPHEMERAL_DIR = ${ephemeralJs};

export default defineConfig({
  root: EPHEMERAL_DIR,
  publicDir: ${publicDirJs === 'false' ? 'false' : `resolve(USER_ROOT, ${publicDirJs})`},
  plugins: [
    react(),
    {
      name: 'visual-edit-asset-proxy',
      async configureServer(server) {
        const { createAssetMiddleware } = await import('@visual-edit/asset-proxy');
        server.middlewares.use(createAssetMiddleware({
          publicDir: ${JSON.stringify(input.info.publicDir ?? null)},
          remoteImageStrategy: ${JSON.stringify(input.remoteImageStrategy ?? 'placeholder')},
        }));
      },
    },
  ],
  css: {
    // PostCSS picks up the user's postcss.config.* automatically when scanning from USER_ROOT
    postcss: USER_ROOT,
  },
  resolve: {
    alias: {
${aliasEntries}
    },
  },
  server: {
    port: ${input.port},
    strictPort: true,
    host: '127.0.0.1',
    fs: {
      // Allow Vite to serve files from the user's project root (outside ephemeralDir).
      allow: [USER_ROOT, EPHEMERAL_DIR],
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client'],
  },
});
`;
}
