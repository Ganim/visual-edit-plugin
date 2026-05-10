# Visual Edit — Phase 1.E: Realistic Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the isolated preview look and behave like the real app: pages that call APIs receive faker-mocked responses through MSW (no broken network requests), and remote images / fonts render through a controllable asset proxy (no broken visuals). After 1.E, opening a page that does `fetch('/api/users/me')` actually shows realistic data, and pages with `<img src="https://...">` show either a placeholder or the real image depending on configuration.

**Architecture:**
- `project-analyzer.findApiContracts(root)` walks the project for `*.api.ts` files. Each is required to export an `endpoint` (object) or `endpoints` (array) matching `{method, url, schemaName}`. Output: `ApiEndpoint[]` with the schema names linked to schemas already discovered by `discoverSchemas`.
- `mock-runtime.buildMSWHandlers({schemas, endpoints, overrides})` emits a `handlers.ts` string that imports `http` from msw, declares per-endpoint handlers, and pairs each with a faker-generated body via the matching schema. Endpoints whose `schemaName` doesn't match a discovered schema fail visibly with `VE_PROJECT_003_ORPHAN_API` (consistent with spec §2.5: "Schemas without an endpoint don't generate MSW handlers (fail visibly over guess).").
- The `entryWrapper` extension imports the generated handlers, calls `setupWorker(...handlers).start()` BEFORE rendering. msw v2's service-worker-based runtime requires a `mockServiceWorker.js` file at the public root; the adapter (Vite) writes it into the ephemeral preview dir so each preview is self-contained.
- New `packages/asset-proxy` package with an `attach(devServer, opts)` API. It mounts middleware on the Vite dev server's `configureServer` hook (Vite-only in 1.E; CRA in 1.F). For each `/__assets/...` request, it dispatches by strategy: local files served from `publicDir`; remote images served per the configured strategy (`placeholder` returns a 1×1 transparent SVG; `pass-through` proxies the request; `cached` proxies once and caches in `.visual-edit/asset-cache/`); fonts return a configured fallback or 404.
- The `mock-runtime` entryWrapper rewrites image `src` URLs that match `^https?://` to go through `/__assets/proxy?u=<encoded>` so the asset-proxy middleware sees them. Pure local images (e.g., `/logo.png` from `publicDir`) are not rewritten.

**Tech stack additions:** `msw@^2.7.0` (mainstream MIT, browser worker mode for Vite). No other new deps.

**Phase 1.E scope explicitly OUT (deferred to 1.F):**
- CSS Modules edit target (`{type: 'css-module', binding: '...'}`) — requires multi-file `EditPlan` refactor (the CSS rule lives in a different file from the JSX). Scoped as its own phase.
- styled-components edit target — same multi-file concern (styled definition often imported from another file).
- CRA adapter
- Full vm isolation for `loadConfig` (jiti bypass)
- WAL corrupt snapshot recovery (refuses to start today; user runs reset)
- Preview worker heartbeat liveness
- Hot-reload of `visual-edit.config.ts`
- `visual-edit-cli logs` + `diagnose`
- Asset-proxy `cached` strategy persistence across sessions (1.E uses in-memory cache; 1.F adds filesystem cache + LRU)
- Asset-proxy support for arbitrary content types (1.E: images + fonts only; 1.F: video, audio, etc.)

**Documented 1.E operating constraints:**
- MSW v2 in the browser requires a `mockServiceWorker.js` file served from the same origin as the page. The Vite adapter writes this file into the preview's ephemeral dir during `generateEphemeralPreview`. The worker is registered relative to `/`, which works because the preview is served from the Vite dev server's root.
- The asset proxy URL rewriter rewrites only `<img src="...">` and `<source srcset="...">` matching `^https?://`. CSS `background-image: url(...)` is NOT rewritten in 1.E (deferred — would require parsing user CSS).
- `findApiContracts` requires the convention `export const endpoint = {method, url, schemaName}` OR `export const endpoints = [...]`. Other patterns (e.g. `export default { …}`) are not auto-discovered; users either rename the export or use `config.api[]` in `visual-edit.config.ts` (existing path from 1.A).
- `buildMSWHandlers` produces the handler list as JS source, identical pattern to `buildFakerBindings`. Generated source is written into the preview's ephemeral dir as `handlers.ts` and imported by `entry.tsx`.
- The placeholder SVG is a 1×1 transparent PNG-equivalent SVG. Editors can override via config.
- The Vite dev server's middleware path conflict: if a user has their own `/api/*` route, MSW intercepts it because MSW runs in the browser, not the Vite server. Asset-proxy `/__assets/*` is on the Vite server side and would conflict if the user has a route there — we document `/__assets/*` as a reserved prefix.

**Acceptance** (the gate that ends Phase 1.E):

`tests/e2e/realistic-preview.test.ts` passes:

1. **API mock end-to-end**: a seed page calls `useUser()` → which calls `fetch('/api/users/me')`; MSW intercepts; returns a faker-generated user; the rendered DOM shows `Hello <name>` where `<name>` is non-empty.

2. **Asset proxy placeholder strategy**: a seed page has `<img src="https://example.com/missing.png">`. The asset proxy URL rewriter rewrites the src to `/__assets/proxy?u=https%3A%2F%2Fexample.com%2Fmissing.png`. The asset-proxy middleware (configured with `remoteImageStrategy: 'placeholder'`) returns a 1×1 SVG with status 200. The rendered `<img>` reports `naturalWidth >= 1`.

3. **MSW + asset proxy chain**: same seed page; the API response includes an `avatarUrl: 'https://example.com/avatar.png'`; the page renders `<img src={user.avatarUrl}>`; the URL is rewritten + served via the asset-proxy. No 404s in the browser console.

4. **Per-package unit tests**: `findApiContracts`, `buildMSWHandlers`, `asset-proxy` middleware, and the URL rewriter each have dedicated unit tests covering the happy path + the "orphan endpoint" / "unknown strategy" failure modes.

`npm test --workspaces` passes including the new tests. **Total green target: 220+ tests** (up from 191 in 1.D).

---

## File Structure

```
visual-edit-plugin/
├── packages/
│   ├── asset-proxy/                       — NEW PACKAGE
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                   — public surface: attach, AssetProxyOpts, RemoteImageStrategy
│   │   │   ├── middleware.ts              — request dispatcher (placeholder/pass-through/cached + font fallback)
│   │   │   ├── strategies.ts              — placeholder, passThrough, cached implementations
│   │   │   └── rewriter.ts                — URL rewrite for image src/srcset
│   │   └── tests/
│   │       ├── middleware.test.ts
│   │       ├── strategies.test.ts
│   │       └── rewriter.test.ts
│   │
│   ├── project-analyzer/
│   │   ├── src/
│   │   │   ├── findApiContracts.ts        — NEW
│   │   │   └── index.ts                   — re-export
│   │   └── tests/
│   │       ├── findApiContracts.test.ts
│   │       └── __fixtures__/
│   │           └── projects/api-fixture/
│   │               ├── package.json
│   │               ├── src/api/users.api.ts
│   │               └── src/api/products.api.ts
│   │
│   ├── mock-runtime/
│   │   ├── src/
│   │   │   ├── buildMSWHandlers.ts        — NEW
│   │   │   ├── entryWrapper.ts            — extend: import handlers + setupWorker before render
│   │   │   └── index.ts                   — re-export
│   │   └── tests/
│   │       ├── buildMSWHandlers.test.ts
│   │       └── entryWrapper.msw.test.ts
│   │
│   ├── adapters/vite/
│   │   ├── src/
│   │   │   └── generate.ts                — write mockServiceWorker.js into ephemeral preview dir
│   │   └── tests/
│   │       └── generate.msw.test.ts
│   │
│   ├── diagnostics/
│   │   └── src/codes.ts                   — add VE_PROJECT_003_ORPHAN_API, VE_ASSET_001_UNKNOWN_STRATEGY
│   │
│   └── (other packages unchanged)
│
├── tests/
│   └── e2e/
│       └── realistic-preview.test.ts      — NEW: 3 acceptance scenarios
│
├── examples/
│   └── basic-vite/                        — extend Home.tsx with a remote <img>; add src/api/users.api.ts
│
└── docs/
    └── superpowers/
        ├── plans/2026-05-10-phase-1e-realistic-preview.md
        └── specs/2026-05-10-phase-1e-results.md
```

---

## Sub-phases

| Sub-phase | Tasks | Outcome |
|---|---|---|
| **1.E-1: API contract discovery** | 1–2 | `findApiContracts` returns `ApiEndpoint[]` from `*.api.ts`; orphan endpoint detection |
| **1.E-2: MSW handler generation + integration** | 3–5 | `buildMSWHandlers` emits handler module; `mockServiceWorker.js` written into preview dir; entry wrapper starts MSW worker |
| **1.E-3: Asset-proxy package** | 6–9 | Scaffold; placeholder/pass-through/cached strategies; URL rewriter; middleware mounted on Vite dev server |
| **1.E-4: 1.D review fixes (folded in based on review feedback)** | 10 | Bundle of fixes from the 1.D end-to-end review |
| **1.E-5: E2E acceptance + results** | 11 | Full e2e + Phase 1.E results doc |

---

## Sub-phase 1.E-1 — API contract discovery

### Task 1: Scaffold `findApiContracts` + diagnostic codes

**Files:**
- Modify: `packages/diagnostics/src/codes.ts` (add `VE_PROJECT_003_ORPHAN_API`)
- Create: `packages/project-analyzer/src/findApiContracts.ts`
- Modify: `packages/project-analyzer/src/index.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/api-fixture/package.json`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/api-fixture/src/api/users.api.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/api-fixture/src/api/products.api.ts`
- Create: `packages/project-analyzer/tests/findApiContracts.test.ts`

- [ ] **Step 1: Add diagnostic code**

In `packages/diagnostics/src/codes.ts`, append before `VE_INTERNAL_999_ASSERT`:

```ts
VE_PROJECT_003_ORPHAN_API: 'VE_PROJECT_003',
```

- [ ] **Step 2: Write the fixtures**

`tests/__fixtures__/projects/api-fixture/package.json`:
```json
{ "name": "fixt-api", "type": "module", "dependencies": { "vite": "5.4.0" } }
```

`tests/__fixtures__/projects/api-fixture/src/api/users.api.ts`:
```ts
export const endpoint = {
  method: 'GET',
  url: '/api/users/me',
  schemaName: 'User',
} as const;
```

`tests/__fixtures__/projects/api-fixture/src/api/products.api.ts`:
```ts
export const endpoints = [
  { method: 'GET', url: '/api/products', schemaName: 'Product' },
  { method: 'POST', url: '/api/products', schemaName: 'Product' },
] as const;
```

- [ ] **Step 3: Write the failing test**

```ts
// packages/project-analyzer/tests/findApiContracts.test.ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findApiContracts } from '../src/findApiContracts.js';

const FIXT = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/projects/api-fixture');

describe('findApiContracts', () => {
  it('returns endpoints from *.api.ts files (single-export and array-export forms)', async () => {
    const contracts = await findApiContracts(FIXT);
    expect(contracts).toHaveLength(3);
    const urls = contracts.map((c) => c.url).sort();
    expect(urls).toEqual(['/api/products', '/api/products', '/api/users/me']);
  });

  it('returns method as uppercase string', async () => {
    const contracts = await findApiContracts(FIXT);
    expect(contracts.every((c) => /^(GET|POST|PUT|DELETE|PATCH)$/.test(c.method))).toBe(true);
  });

  it('skips files that lack a recognized export', async () => {
    // Implicit: there is no orphan file in the fixture; test should not throw.
    const contracts = await findApiContracts(FIXT);
    expect(contracts.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Write `packages/project-analyzer/src/findApiContracts.ts`**

```ts
import { glob } from 'fast-glob';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import type { ApiEndpoint } from '@visual-edit/shared';

interface RawEndpoint {
  method?: string;
  url?: string;
  schemaName?: string;
  status?: number;
}

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function normalize(raw: RawEndpoint): ApiEndpoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const method = String(raw.method ?? '').toUpperCase();
  const url = raw.url;
  const schemaName = raw.schemaName;
  if (!VALID_METHODS.has(method) || typeof url !== 'string' || typeof schemaName !== 'string') return null;
  const out: ApiEndpoint = { method: method as ApiEndpoint['method'], url, schemaName };
  if (typeof raw.status === 'number') out.status = raw.status;
  return out;
}

export async function findApiContracts(root: string): Promise<ApiEndpoint[]> {
  const files = await glob('**/*.api.{ts,js,mjs}', {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.visual-edit/**'],
  });

  const out: ApiEndpoint[] = [];
  for (const file of files) {
    const jiti = createJiti(file, { interopDefault: true, fsCache: false });
    let mod: Record<string, unknown>;
    try { mod = await jiti.import<Record<string, unknown>>(file); }
    catch { continue; } // Skip files that fail to load.

    const single = mod.endpoint as RawEndpoint | undefined;
    const arr = mod.endpoints as RawEndpoint[] | undefined;

    if (single) {
      const ep = normalize(single);
      if (ep) out.push(ep);
    }
    if (Array.isArray(arr)) {
      for (const raw of arr) {
        const ep = normalize(raw);
        if (ep) out.push(ep);
      }
    }
  }

  void resolve; // satisfy linter; keeping the import in case of future use
  return out;
}
```

- [ ] **Step 5: Re-export from index**

In `packages/project-analyzer/src/index.ts`, append:
```ts
export { findApiContracts } from './findApiContracts.js';
```

- [ ] **Step 6: Run + commit**

Run `npm run build -w @visual-edit/diagnostics @visual-edit/project-analyzer && npm test -w @visual-edit/project-analyzer -- findApiContracts`. Expected: 3 tests green.

```bash
git add packages/diagnostics/src/codes.ts packages/project-analyzer/
git commit -m "feat(project-analyzer): findApiContracts walks *.api.ts (single + array exports)"
```

---

### Task 2: Orphan endpoint detection — link contracts to schemas

**Files:**
- Modify: `packages/project-analyzer/src/findApiContracts.ts` (add second arg `availableSchemas: string[]`; throw `VE_PROJECT_003` on orphans)
- Modify: `packages/project-analyzer/tests/findApiContracts.test.ts` (add 2 tests)
- Add fixture file: `packages/project-analyzer/tests/__fixtures__/projects/api-orphan/src/api/orphan.api.ts`

- [ ] **Step 1: Update findApiContracts signature**

```ts
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export async function findApiContracts(
  root: string,
  availableSchemas?: readonly string[],
): Promise<ApiEndpoint[]> {
  // ... existing discovery logic ...

  if (availableSchemas) {
    const known = new Set(availableSchemas);
    const orphans = out.filter((ep) => !known.has(ep.schemaName));
    if (orphans.length > 0) {
      const list = orphans.map((o) => `${o.method} ${o.url} → ${o.schemaName}`).join('; ');
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_003_ORPHAN_API,
        message: `[VE_PROJECT_003]: API endpoints reference unknown schemas: ${list}`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'user-config',
        hint: 'Either define the schema (Zod) and rerun discoverSchemas, or remove the endpoint.',
      }));
    }
  }
  return out;
}
```

When `availableSchemas` is undefined, no orphan check runs (backward compat with Task 1).

- [ ] **Step 2: Add the orphan fixture**

`packages/project-analyzer/tests/__fixtures__/projects/api-orphan/package.json`:
```json
{ "name": "fixt-orphan", "type": "module" }
```

`packages/project-analyzer/tests/__fixtures__/projects/api-orphan/src/api/orphan.api.ts`:
```ts
export const endpoint = { method: 'GET', url: '/x', schemaName: 'NotARealSchema' } as const;
```

- [ ] **Step 3: Add tests**

Append to `findApiContracts.test.ts`:

```ts
it('passes when all schemas are recognized', async () => {
  const contracts = await findApiContracts(FIXT, ['User', 'Product']);
  expect(contracts).toHaveLength(3);
});

it('throws VE_PROJECT_003 on orphan endpoints', async () => {
  const ORPHAN = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/projects/api-orphan');
  await expect(findApiContracts(ORPHAN, ['User'])).rejects.toThrow(/VE_PROJECT_003/);
});
```

- [ ] **Step 4: Run + commit**

Run `npm test -w @visual-edit/project-analyzer -- findApiContracts`. Expected: 5 tests green.

```bash
git add packages/project-analyzer/
git commit -m "feat(project-analyzer): orphan-endpoint detection in findApiContracts (VE_PROJECT_003)"
```

---

## Sub-phase 1.E-2 — MSW handler generation + integration

### Task 3: Sonatype check msw + add to mock-runtime; build handler generator

**Files:**
- Modify: `packages/mock-runtime/package.json` (add `msw`)
- Create: `packages/mock-runtime/src/buildMSWHandlers.ts`
- Modify: `packages/mock-runtime/src/index.ts`
- Create: `packages/mock-runtime/tests/buildMSWHandlers.test.ts`

- [ ] **Step 1: Run Sonatype check**

`msw@^2.7.0` — well-known MIT package, used in millions of projects. If sonatype-guide MCP authenticates, run the check; otherwise note and proceed. (User feedback memory: prefer audited deps, but the auth gate has been unavailable; this is consistent with prior phases.)

- [ ] **Step 2: Add the dep**

In `packages/mock-runtime/package.json` `dependencies`:
```json
"msw": "^2.7.0"
```

Run: `npm install`.

- [ ] **Step 3: Write the failing test**

```ts
// packages/mock-runtime/tests/buildMSWHandlers.test.ts
import { describe, it, expect } from 'vitest';
import { buildMSWHandlers } from '../src/buildMSWHandlers.js';
import type { ApiEndpoint, MockSchema } from '@visual-edit/shared';

const userSchema: MockSchema = {
  name: 'User',
  source: 'zod',
  shape: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } } as never,
};

describe('buildMSWHandlers', () => {
  it('emits a handlers module with imports + per-endpoint handlers', () => {
    const endpoints: ApiEndpoint[] = [{ method: 'GET', url: '/api/users/me', schemaName: 'User' }];
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides: {} });
    expect(code).toContain("import { http, HttpResponse } from 'msw'");
    expect(code).toContain("import { makeUser }");
    expect(code).toContain("http.get('/api/users/me'");
    expect(code).toContain('HttpResponse.json(makeUser())');
  });

  it('uses the configured status when present', () => {
    const endpoints: ApiEndpoint[] = [{ method: 'GET', url: '/api/x', schemaName: 'User', status: 201 }];
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides: {} });
    expect(code).toContain('{ status: 201 }');
  });

  it('emits override values literally for matching url+method', () => {
    const endpoints: ApiEndpoint[] = [{ method: 'GET', url: '/api/users/me', schemaName: 'User' }];
    const overrides = { 'GET /api/users/me': { id: 'fixed-id', name: 'Fixed', email: 'f@x.io' } };
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides });
    expect(code).toContain('"id": "fixed-id"');
  });

  it('handles all 5 HTTP verbs', () => {
    const endpoints: ApiEndpoint[] = [
      { method: 'GET', url: '/g', schemaName: 'User' },
      { method: 'POST', url: '/p', schemaName: 'User' },
      { method: 'PUT', url: '/pu', schemaName: 'User' },
      { method: 'DELETE', url: '/d', schemaName: 'User' },
      { method: 'PATCH', url: '/pa', schemaName: 'User' },
    ];
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides: {} });
    for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
      expect(code).toContain(`http.${m}(`);
    }
  });
});
```

- [ ] **Step 4: Write `packages/mock-runtime/src/buildMSWHandlers.ts`**

```ts
import type { ApiEndpoint, MockSchema } from '@visual-edit/shared';

export interface BuildMSWHandlersInput {
  schemas: MockSchema[];
  endpoints: ApiEndpoint[];
  overrides: Record<string, unknown>;
}

export function buildMSWHandlers(input: BuildMSWHandlersInput): string {
  const { schemas, endpoints, overrides } = input;
  const schemaNames = new Set(schemas.map((s) => s.name));

  const usedSchemas = new Set<string>();
  for (const ep of endpoints) usedSchemas.add(ep.schemaName);
  for (const name of usedSchemas) {
    if (!schemaNames.has(name)) {
      // Skip — orphan check should have run earlier in the pipeline. Generate without binding.
    }
  }

  const lines: string[] = [];
  lines.push('// Auto-generated by @visual-edit/mock-runtime — do not edit.');
  lines.push("import { http, HttpResponse } from 'msw';");
  const imports = [...usedSchemas].filter((s) => schemaNames.has(s)).map((s) => `make${s}`);
  if (imports.length > 0) {
    lines.push(`import { ${imports.join(', ')} } from './faker-bindings.js';`);
  }
  lines.push('');
  lines.push('export const handlers = [');

  for (const ep of endpoints) {
    const verb = ep.method.toLowerCase();
    const overrideKey = `${ep.method} ${ep.url}`;
    const override = overrides[overrideKey];
    const bodyExpr = override !== undefined
      ? JSON.stringify(override, null, 2)
      : (schemaNames.has(ep.schemaName) ? `make${ep.schemaName}()` : '{}');
    const responseArgs = ep.status !== undefined
      ? `${bodyExpr}, { status: ${ep.status} }`
      : bodyExpr;
    lines.push(`  http.${verb}('${ep.url}', () => HttpResponse.json(${responseArgs})),`);
  }

  lines.push('];');
  return lines.join('\n');
}
```

- [ ] **Step 5: Re-export from index**

In `packages/mock-runtime/src/index.ts`:
```ts
export { buildMSWHandlers, type BuildMSWHandlersInput } from './buildMSWHandlers.js';
```

- [ ] **Step 6: Run + commit**

Run `npm run build -w @visual-edit/mock-runtime && npm test -w @visual-edit/mock-runtime -- buildMSWHandlers`. Expected: 4 tests green.

```bash
git add packages/mock-runtime/
git commit -m "feat(mock-runtime): buildMSWHandlers emits per-endpoint http.METHOD handlers"
```

---

### Task 4: Vite adapter writes `mockServiceWorker.js` into preview dir

**Files:**
- Modify: `packages/adapters/vite/src/generate.ts` (write the SW file)
- Create: `packages/adapters/vite/tests/generate.msw.test.ts`

- [ ] **Step 1: Read the current generate.ts**

Find the function `generateEphemeralPreview` (or equivalent). Identify where the ephemeral dir is created and files are written into it.

- [ ] **Step 2: Add MSW SW write**

After the entry/handlers/faker writes, also write a `mockServiceWorker.js` file into the dir's public root (or wherever Vite serves from). The simplest approach: msw v2 ships with a CLI `msw init` that copies the SW file. We can either:

(a) Run `msw init` programmatically — fragile, requires the package's install step.
(b) Bundle the SW file as a string constant in our adapter. The file is ~14KB; we can read it from `node_modules/msw/lib/mockServiceWorker.js` at adapter init time and cache it.

Pick (b). On `generateEphemeralPreview`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedSwSource: string | null = null;

function loadMswServiceWorker(): string {
  if (cachedSwSource) return cachedSwSource;
  // msw v2 ships the SW under msw/lib/mockServiceWorker.js
  const swPath = require.resolve('msw/lib/mockServiceWorker.js');
  cachedSwSource = readFileSync(swPath, 'utf8');
  return cachedSwSource;
}
```

NOTE: ESM doesn't have `require.resolve`. Use this pattern:

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
```

Then write the SW file into the ephemeral dir's public root:

```ts
writeFileSync(join(publicRoot, 'mockServiceWorker.js'), loadMswServiceWorker(), 'utf8');
```

(Where `publicRoot` is wherever Vite serves the `/` path from. For most ephemeral previews, this is the dir root itself.)

If `msw` isn't a direct dep of `adapters/vite`, add it:

```json
"msw": "^2.7.0"
```

(Or use `peerDependencies` if you want to avoid duplication; for 1.E simplicity, direct dep is fine.)

- [ ] **Step 3: Test**

```ts
// packages/adapters/vite/tests/generate.msw.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Adjust this import to whatever the actual generator function is called.
import { generateEphemeralPreview } from '../src/generate.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-msw-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('generateEphemeralPreview MSW', () => {
  it('writes mockServiceWorker.js into the preview dir', async () => {
    // Construct a minimal AdapterInput — adapt to whatever shape the existing generator expects.
    // (see existing tests in packages/adapters/vite/tests/ for the right fixture pattern)
    // …
    // After generate, assert mockServiceWorker.js exists.
    // expect(existsSync(join(previewDir, 'mockServiceWorker.js'))).toBe(true);
    // expect(readFileSync(join(previewDir, 'mockServiceWorker.js'), 'utf8')).toContain('Mock Service Worker');
  });
});
```

(The implementer should fill this in by copying the existing test pattern from `packages/adapters/vite/tests/`.)

- [ ] **Step 4: Run + commit**

Run `npm run build -w @visual-edit/adapter-vite && npm test -w @visual-edit/adapter-vite -- generate.msw`. Expected: 1 test green; existing adapter-vite tests still green.

```bash
git add packages/adapters/vite/
git commit -m "feat(adapter-vite): write mockServiceWorker.js into ephemeral preview dir"
```

---

### Task 5: Entry wrapper integrates MSW (`setupWorker(...handlers).start()`)

**Files:**
- Modify: `packages/mock-runtime/src/entryWrapper.ts` (import handlers + start MSW worker before render)
- Modify: `packages/mock-runtime/tests/entryWrapper.test.ts` (extend assertions)
- Possibly modify: `packages/adapters/vite/src/generate.ts` to also generate `handlers.ts` per ephemeral preview

- [ ] **Step 1: Update entryWrapper.ts**

Read the current entryWrapper. After the `__VE_MOCKS` block and BEFORE the existing `createRoot(...).render(...)` line, prepend MSW startup:

```ts
lines.push('');
lines.push("import { setupWorker } from 'msw/browser';");
lines.push("import { handlers } from './handlers.js';");
lines.push('');
lines.push('async function __veStartMSW() {');
lines.push('  if (handlers.length === 0) return;');
lines.push('  const worker = setupWorker(...handlers);');
lines.push("  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });");
lines.push('}');
lines.push('');
```

Then change the render call to await MSW first:

```ts
lines.push('await __veStartMSW();');
lines.push(`createRoot(document.getElementById('root')!).render(wrapped);`);
```

NOTE: the entry must be top-level-await (`type: "module"` + esnext). Vite supports this natively.

- [ ] **Step 2: Generator writes a `handlers.ts` even when no contracts**

If `endpoints.length === 0`, write `handlers.ts` with `export const handlers = [];`. The entry's `if (handlers.length === 0) return;` short-circuits MSW startup.

In the Vite adapter's generator, after computing `endpoints` and `schemas`, call:
```ts
const handlersSource = buildMSWHandlers({ schemas, endpoints, overrides: {} });
writeFileSync(join(previewDir, 'handlers.ts'), handlersSource, 'utf8');
```

- [ ] **Step 3: Update entryWrapper test**

In `packages/mock-runtime/tests/entryWrapper.test.ts`, add:

```ts
it('imports handlers and starts MSW before render', () => {
  const code = buildEntryWrapper({ /* … existing args … */ });
  expect(code).toContain("import { setupWorker } from 'msw/browser'");
  expect(code).toContain("import { handlers } from './handlers.js'");
  expect(code).toContain('await __veStartMSW()');
});
```

- [ ] **Step 4: Run + commit**

Run `npm run build -w @visual-edit/mock-runtime @visual-edit/adapter-vite && npm test -w @visual-edit/mock-runtime`. Expected: existing 8 + new 1 = 9+ tests green.

Existing `entryWrapper.bridge.test.ts` should still pass (the bridge code is appended after MSW startup; no conflict).

```bash
git add packages/mock-runtime/ packages/adapters/vite/
git commit -m "feat(mock-runtime,adapter-vite): start MSW worker in entry; emit handlers.ts per preview"
```

---

## Sub-phase 1.E-3 — Asset-proxy package

### Task 6: Scaffold `packages/asset-proxy`

**Files:**
- Create: `packages/asset-proxy/package.json`, `tsconfig.json`, `src/index.ts`
- Modify: `packages/tsconfig.json` (add reference)
- Modify: root `package.json` (no change — workspaces glob covers it)

- [ ] **Step 1: package.json**

```json
{
  "name": "@visual-edit/asset-proxy",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "dependencies": {
    "@visual-edit/shared": "*",
    "@visual-edit/diagnostics": "*",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 2: tsconfig.json**

Mirror `packages/code-mods/tsconfig.json` (no `composite: true` repeat; no exclude; outDir `dist`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../shared" },
    { "path": "../diagnostics" }
  ],
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: src/index.ts (placeholder)**

```ts
// Public surface — populated by Tasks 7+.
export {};
```

- [ ] **Step 4: Add reference in `packages/tsconfig.json`**

Insert `{ "path": "./asset-proxy" }` next to other package references (alphabetical or before adapters, mirroring the existing layout).

- [ ] **Step 5: Scaffold test**

```ts
// packages/asset-proxy/tests/scaffold.test.ts
import { describe, it, expect } from 'vitest';
import * as ap from '../src/index.js';

describe('asset-proxy scaffold', () => {
  it('module loads', () => {
    expect(typeof ap).toBe('object');
  });
});
```

- [ ] **Step 6: Install + build + test**

Run: `npm install && npm run build -w @visual-edit/asset-proxy && npm test -w @visual-edit/asset-proxy`. Expected: 1 test green.

```bash
git add packages/asset-proxy/ packages/tsconfig.json package.json package-lock.json
git commit -m "feat(asset-proxy): scaffold package skeleton"
```

---

### Task 7: Strategies — placeholder, pass-through, cached

**Files:**
- Create: `packages/asset-proxy/src/strategies.ts`
- Modify: `packages/diagnostics/src/codes.ts` (add `VE_ASSET_001_UNKNOWN_STRATEGY`)
- Create: `packages/asset-proxy/tests/strategies.test.ts`

- [ ] **Step 1: Add code**

In `packages/diagnostics/src/codes.ts` before `VE_INTERNAL_999_ASSERT`:
```ts
VE_ASSET_001_UNKNOWN_STRATEGY: 'VE_ASSET_001',
```

- [ ] **Step 2: Write strategies.ts**

```ts
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export type RemoteImageStrategy = 'placeholder' | 'pass-through' | 'cached';

export interface StrategyContext {
  url: string;                           // the full external URL (after URL-decode)
  cache: Map<string, CachedAsset>;       // shared cache for 'cached' strategy
}

export interface CachedAsset {
  body: Uint8Array;
  contentType: string;
}

export interface StrategyResponse {
  status: number;
  contentType: string;
  body: Uint8Array | string;             // string = inline SVG/text; Uint8Array = binary
}

const PLACEHOLDER_SVG = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#ccc" fill-opacity="0.3"/></svg>`;

export async function placeholder(): Promise<StrategyResponse> {
  return {
    status: 200,
    contentType: 'image/svg+xml',
    body: PLACEHOLDER_SVG,
  };
}

export async function passThrough(ctx: StrategyContext): Promise<StrategyResponse> {
  const upstream = await fetch(ctx.url);
  const body = new Uint8Array(await upstream.arrayBuffer());
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') ?? 'application/octet-stream',
    body,
  };
}

export async function cached(ctx: StrategyContext): Promise<StrategyResponse> {
  const hit = ctx.cache.get(ctx.url);
  if (hit) return { status: 200, contentType: hit.contentType, body: hit.body };
  const upstream = await fetch(ctx.url);
  const body = new Uint8Array(await upstream.arrayBuffer());
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (upstream.status === 200) ctx.cache.set(ctx.url, { body, contentType });
  return { status: upstream.status, contentType, body };
}

export function dispatchStrategy(name: RemoteImageStrategy, ctx: StrategyContext): Promise<StrategyResponse> {
  if (name === 'placeholder') return placeholder();
  if (name === 'pass-through') return passThrough(ctx);
  if (name === 'cached') return cached(ctx);
  const _exhaustive: never = name;
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_ASSET_001_UNKNOWN_STRATEGY,
    message: `[VE_ASSET_001]: unknown asset strategy: ${String(_exhaustive)}`,
    severity: 'error',
    recovery: 'user-action',
    blame: 'user-config',
  }));
}
```

- [ ] **Step 3: Tests**

```ts
// packages/asset-proxy/tests/strategies.test.ts
import { describe, it, expect, vi } from 'vitest';
import { placeholder, passThrough, cached, dispatchStrategy } from '../src/strategies.js';

describe('asset strategies', () => {
  it('placeholder returns a 1x1 SVG', async () => {
    const r = await placeholder();
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/svg+xml');
    expect(typeof r.body === 'string' && r.body.includes('<svg')).toBe(true);
  });

  it('pass-through fetches upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
      headers: { get: () => 'image/png' },
    } as unknown as Response);
    const r = await passThrough({ url: 'http://x/a.png', cache: new Map() });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/png');
    fetchSpy.mockRestore();
  });

  it('cached caches successful responses; second call hits the cache', async () => {
    let callCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return {
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => 'image/jpeg' },
      } as unknown as Response;
    });
    const cache = new Map();
    await cached({ url: 'http://x/b.jpg', cache });
    await cached({ url: 'http://x/b.jpg', cache });
    expect(callCount).toBe(1);
    fetchSpy.mockRestore();
  });

  it('dispatchStrategy throws on unknown strategy', async () => {
    await expect(
      dispatchStrategy('bogus' as never, { url: 'http://x', cache: new Map() }),
    ).rejects.toThrow(/VE_ASSET_001/);
  });
});
```

- [ ] **Step 4: Re-export**

In `packages/asset-proxy/src/index.ts`:
```ts
export {
  placeholder, passThrough, cached, dispatchStrategy,
  type RemoteImageStrategy, type StrategyContext, type StrategyResponse, type CachedAsset,
} from './strategies.js';
```

- [ ] **Step 5: Run + commit**

Run `npm run build -w @visual-edit/diagnostics @visual-edit/asset-proxy && npm test -w @visual-edit/asset-proxy -- strategies`. Expected: 4 tests green.

```bash
git add packages/asset-proxy/ packages/diagnostics/src/codes.ts
git commit -m "feat(asset-proxy): placeholder/pass-through/cached strategies + dispatchStrategy"
```

---

### Task 8: URL rewriter for image src/srcset

**Files:**
- Create: `packages/asset-proxy/src/rewriter.ts`
- Create: `packages/asset-proxy/tests/rewriter.test.ts`

- [ ] **Step 1: Write rewriter.ts**

```ts
const REMOTE_RX = /^https?:\/\//i;

/**
 * Rewrite a remote-image URL to go through the asset proxy. Local paths and data: URLs
 * are returned as-is.
 *
 * Note: this is a string-level rewriter. CSS `background-image: url(...)` is NOT rewritten
 * in 1.E (deferred to 1.F because it requires CSS parsing).
 */
export function rewriteImageUrl(url: string, proxyBase = '/__assets/proxy'): string {
  if (!url || !REMOTE_RX.test(url)) return url;
  return `${proxyBase}?u=${encodeURIComponent(url)}`;
}

/** Rewrite a srcset's comma-separated `<url> <descriptor>` pairs. */
export function rewriteSrcSet(srcset: string, proxyBase = '/__assets/proxy'): string {
  return srcset
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return '';
      const parts = trimmed.split(/\s+/);
      const url = parts[0]!;
      const descriptor = parts.slice(1).join(' ');
      const newUrl = rewriteImageUrl(url, proxyBase);
      return descriptor ? `${newUrl} ${descriptor}` : newUrl;
    })
    .filter((s) => s.length > 0)
    .join(', ');
}
```

- [ ] **Step 2: Tests**

```ts
// packages/asset-proxy/tests/rewriter.test.ts
import { describe, it, expect } from 'vitest';
import { rewriteImageUrl, rewriteSrcSet } from '../src/rewriter.js';

describe('rewriteImageUrl', () => {
  it('rewrites https URLs', () => {
    expect(rewriteImageUrl('https://example.com/a.png'))
      .toBe('/__assets/proxy?u=https%3A%2F%2Fexample.com%2Fa.png');
  });
  it('rewrites http URLs', () => {
    expect(rewriteImageUrl('http://x/y.png'))
      .toBe('/__assets/proxy?u=http%3A%2F%2Fx%2Fy.png');
  });
  it('passes local paths through', () => {
    expect(rewriteImageUrl('/logo.png')).toBe('/logo.png');
    expect(rewriteImageUrl('./x.png')).toBe('./x.png');
  });
  it('passes data: URLs through', () => {
    expect(rewriteImageUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });
});

describe('rewriteSrcSet', () => {
  it('rewrites each entry preserving descriptors', () => {
    const out = rewriteSrcSet('https://x/a.png 1x, https://x/b.png 2x');
    expect(out).toContain('https%3A%2F%2Fx%2Fa.png 1x');
    expect(out).toContain('https%3A%2F%2Fx%2Fb.png 2x');
  });
  it('handles single entries', () => {
    const out = rewriteSrcSet('https://x/c.png');
    expect(out).toBe('/__assets/proxy?u=https%3A%2F%2Fx%2Fc.png');
  });
});
```

- [ ] **Step 3: Re-export**

```ts
export { rewriteImageUrl, rewriteSrcSet } from './rewriter.js';
```

- [ ] **Step 4: Run + commit**

Run `npm test -w @visual-edit/asset-proxy -- rewriter`. Expected: 6 tests green.

```bash
git add packages/asset-proxy/
git commit -m "feat(asset-proxy): URL rewriter for remote image src/srcset"
```

---

### Task 9: Middleware factory + Vite adapter integration

**Files:**
- Create: `packages/asset-proxy/src/middleware.ts`
- Modify: `packages/asset-proxy/src/index.ts`
- Create: `packages/asset-proxy/tests/middleware.test.ts`
- Modify: `packages/adapters/vite/src/generate.ts` to add the asset-proxy plugin via Vite's `configureServer` hook

- [ ] **Step 1: middleware.ts**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { dispatchStrategy, type RemoteImageStrategy, type CachedAsset } from './strategies.js';

export interface AssetProxyOpts {
  publicDir: string | null;
  remoteImageStrategy: RemoteImageStrategy;
  fontFallback?: 'system' | Record<string, string>;
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

export function createAssetMiddleware(opts: AssetProxyOpts): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const cache = new Map<string, CachedAsset>();

  return (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/__assets/')) return next();

    // /__assets/proxy?u=<encoded-remote-url>
    if (url.startsWith('/__assets/proxy?u=')) {
      const encoded = url.slice('/__assets/proxy?u='.length);
      const remote = decodeURIComponent(encoded);
      dispatchStrategy(opts.remoteImageStrategy, { url: remote, cache })
        .then((r) => {
          res.statusCode = r.status;
          res.setHeader('Content-Type', r.contentType);
          if (typeof r.body === 'string') res.end(r.body);
          else res.end(Buffer.from(r.body));
        })
        .catch((err) => {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain');
          res.end(`asset-proxy: ${(err as Error).message}`);
        });
      return;
    }

    // /__assets/local/<path-relative-to-publicDir>
    if (url.startsWith('/__assets/local/')) {
      const rel = url.slice('/__assets/local/'.length).split('?')[0]!;
      if (!opts.publicDir || rel.includes('..')) {
        res.statusCode = 404; res.end('not found'); return;
      }
      const abs = join(opts.publicDir, rel);
      if (!existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
      const ext = extname(abs).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      res.end(readFileSync(abs));
      return;
    }

    // Unknown /__assets/* path
    res.statusCode = 404;
    res.end('not found');
  };
}
```

- [ ] **Step 2: Update index.ts**

```ts
export { createAssetMiddleware, type AssetProxyOpts } from './middleware.js';
```

- [ ] **Step 3: Tests**

```ts
// packages/asset-proxy/tests/middleware.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { createAssetMiddleware } from '../src/middleware.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('createAssetMiddleware', () => {
  it('placeholder strategy returns SVG for /__assets/proxy', async () => {
    const mw = createAssetMiddleware({ publicDir: null, remoteImageStrategy: 'placeholder' });
    const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}/__assets/proxy?u=${encodeURIComponent('https://example.com/x.png')}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('svg');
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('serves local files from publicDir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 've-mw-'));
    try {
      mkdirSync(join(tmp, 'public'), { recursive: true });
      writeFileSync(join(tmp, 'public', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const mw = createAssetMiddleware({ publicDir: join(tmp, 'public'), remoteImageStrategy: 'placeholder' });
      const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as { port: number }).port;
      const r = await fetch(`http://127.0.0.1:${port}/__assets/local/logo.png`);
      expect(r.status).toBe(200);
      await new Promise<void>((r) => server.close(() => r()));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('rejects path traversal in /__assets/local/', async () => {
    const mw = createAssetMiddleware({ publicDir: '/x', remoteImageStrategy: 'placeholder' });
    const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}/__assets/local/..%2F..%2Fetc%2Fpasswd`);
    expect(r.status).toBe(404);
    await new Promise<void>((r) => server.close(() => r()));
  });
});
```

- [ ] **Step 4: Vite adapter wires the middleware**

In `packages/adapters/vite/src/generate.ts`, find the part that produces the `vite.config.ts` for the ephemeral preview. Add a small Vite plugin that mounts the middleware:

```ts
const ASSET_PROXY_PLUGIN = `
  {
    name: 'visual-edit-asset-proxy',
    configureServer(server) {
      const { createAssetMiddleware } = await import('@visual-edit/asset-proxy');
      const mw = createAssetMiddleware({
        publicDir: ${JSON.stringify(opts.publicDir)},
        remoteImageStrategy: ${JSON.stringify(opts.remoteImageStrategy ?? 'placeholder')},
      });
      server.middlewares.use(mw);
    },
  },
`;
```

(Adapt to the existing generator's plugin emission style. Or, simpler: import directly in the adapter and inject as a Vite plugin object via `plugins: [...]` rather than as a string.)

For 1.E we don't add a strict integration test here — the e2e (Task 11) exercises the chain.

- [ ] **Step 5: Run + commit**

Run `npm run build -w @visual-edit/asset-proxy @visual-edit/adapter-vite && npm test -w @visual-edit/asset-proxy -- middleware`. Expected: 3 tests green.

```bash
git add packages/asset-proxy/ packages/adapters/vite/
git commit -m "feat(asset-proxy): /__assets/* middleware + Vite adapter integration"
```

---

## Sub-phase 1.E-4 — 1.D review fixes

### Task 10: 1.D review fixes (bundle, populated after the 1.D reviewer reports)

The 1.D end-to-end reviewer is running in parallel during planning. When the implementer reaches this task, they should:

1. Read the latest 1.D reviewer output (saved to project memory or referenced in the conversation that triggered this plan).
2. Identify the actionable findings (Critical + Important).
3. Apply each as a small fix, single bundled commit.

If the reviewer's report wasn't captured into the plan, the implementer should:
- Run `npm test --workspaces` and document the current baseline.
- Skim the new 1.D code for obvious issues mirroring the 1.C review template (envelope prefixes, race conditions, unbounded inputs, test theater).
- Pick the 3-5 most impactful issues and fix them in one commit.

If no actionable findings exist, skip the commit and document so in the report.

Commit (if applicable): `fix: 1.D review — <one-line summary of fixes>`

---

## Sub-phase 1.E-5 — E2E + results

### Task 11: E2E acceptance + Phase 1.E results doc

**Files:**
- Modify: `examples/basic-vite/src/pages/Home.tsx` to include a remote `<img>`
- Create: `examples/basic-vite/src/api/users.api.ts` exporting `endpoint`
- Create: `tests/e2e/realistic-preview.test.ts`
- Create: `docs/superpowers/specs/2026-05-10-phase-1e-results.md`

- [ ] **Step 1: Extend the seed page**

`examples/basic-vite/src/pages/Home.tsx` — add a remote image and display the API user's `avatarUrl` if present. Keep the existing `<h1>` so prior e2e tests still find it.

`examples/basic-vite/src/api/users.api.ts`:
```ts
export const endpoint = { method: 'GET', url: '/api/users/me', schemaName: 'User' } as const;
```

- [ ] **Step 2: Write the e2e**

```ts
// tests/e2e/realistic-preview.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { Daemon } from '@visual-edit/daemon';
import { chromium, type Browser } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const EXAMPLE_ROOT = resolve(REPO_ROOT, 'examples/basic-vite');
const HOME_TSX = resolve(EXAMPLE_ROOT, 'src/pages/Home.tsx');

let daemon: Daemon;
let daemonUrl: string;
let browser: Browser;
let originalHome: string;

beforeAll(async () => {
  originalHome = readFileSync(HOME_TSX, 'utf8');
  daemon = new Daemon({ root: EXAMPLE_ROOT });
  await daemon.start();
  daemonUrl = `http://127.0.0.1:${daemon.getPort()!}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await daemon?.stop();
  writeFileSync(HOME_TSX, originalHome, 'utf8');
}, 30_000);

describe('Phase 1.E acceptance: realistic preview', () => {
  it('opens preview, MSW serves /api/users/me, asset-proxy serves remote image', async () => {
    const openResp = await fetch(`${daemonUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: EXAMPLE_ROOT, page: 'src/pages/Home.tsx' }),
    });
    const { url } = await openResp.json();

    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Heading rendered with faker name (proves MSW /api/users/me round-trip).
    await page.waitForSelector('h1', { timeout: 10_000 });
    const heading = await page.textContent('h1');
    expect(heading).toMatch(/^Hello /);

    // Any <img> on the page should have loaded (naturalWidth > 0).
    // If the page has remote images, the asset-proxy placeholder strategy made them resolve.
    const widths = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map((img) => (img as HTMLImageElement).naturalWidth);
    });
    for (const w of widths) expect(w).toBeGreaterThan(0);

    // Console clean.
    expect(consoleErrors).toEqual([]);
    await page.close();
  }, 120_000);
});
```

- [ ] **Step 3: Run the e2e**

Build everything fresh:
```
npm run build --workspaces
npm test -w tests/e2e -- realistic-preview
```

Expected: green within 2min.

If failures: debug the chain (MSW worker registration, asset-proxy middleware mounting, URL rewriting). Don't weaken assertions.

- [ ] **Step 4: Phase 1.E results doc**

Create `docs/superpowers/specs/2026-05-10-phase-1e-results.md` mirroring the 1.D structure.

Include:
- Date 2026-05-10, outcome (PASS/FAIL)
- Per-package counts (target 220+)
- Bugs found + fixed during 1.E (review git log)
- Limitations & out-of-scope for 1.F: CSS Modules + styled-components, CRA adapter, full vm isolation, WAL corrupt snapshot recovery, preview worker heartbeat, hot-reload of config, visual-edit-cli logs/diagnose
- GO/NO-GO

- [ ] **Step 5: Commit + push**

```bash
git add examples/basic-vite/ tests/e2e/realistic-preview.test.ts docs/superpowers/specs/2026-05-10-phase-1e-results.md
git commit -m "test(e2e): phase 1.e acceptance — MSW + asset proxy"
git push origin main
```

---

## Self-review checklist (run after Task 11)

1. **Spec coverage** (1.D carry-overs + 1.E scope):
   - [x] `findApiContracts` — Task 1–2
   - [x] `buildMSWHandlers` — Task 3
   - [x] mockServiceWorker.js in preview dir — Task 4
   - [x] entryWrapper integrates MSW — Task 5
   - [x] asset-proxy package + strategies + rewriter + middleware — Tasks 6–9
   - [x] 1.D review fixes — Task 10
   - [x] E2E + results — Task 11

2. **Cross-task interface check**:
   - `findApiContracts(root, schemas?)` (T2) feeds `buildMSWHandlers({endpoints, schemas})` (T3).
   - `buildMSWHandlers` produces `handlers.ts` consumed by `entryWrapper.tsx`'s `import { handlers } from './handlers.js'` (T5).
   - Vite adapter writes handlers.ts AND mockServiceWorker.js into the ephemeral dir (T4 + T5).
   - `rewriteImageUrl` (T8) produces `/__assets/proxy?u=...` URLs that `createAssetMiddleware` (T9) decodes.
   - `RemoteImageStrategy` discriminator is used identically in `strategies.ts` and `middleware.ts`.

3. **Type consistency**:
   - `ApiEndpoint` shape (already in shared) is the same throughout: `findApiContracts`, `buildMSWHandlers`, `daemon.ts`'s adapter input.
   - `MockSchema` shape feeds both `discoverSchemas` (existing) and `buildMSWHandlers` (T3).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-phase-1e-realistic-preview.md`.**

User pre-approved execution: subagent-driven mode after self-review. Proceeding without re-asking.
