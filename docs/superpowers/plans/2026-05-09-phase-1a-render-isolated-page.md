# Visual Edit — Phase 1.A: Render Isolated Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a TSX page in isolation and render it in a browser. User runs `/visual <page>` in a connected agent (or invokes the MCP `open_page` tool); the daemon spins up a synthetic Vite dev server that renders that page wrapped by the user-provided `wrapPage` function with faker-derived mock data, and the user sees it live in their browser. **No editing yet** — Phase 1.B adds the overlay + commit pipeline.

**Architecture:** npm workspaces monorepo. Pure-function packages (`shared`, `protocol`, `diagnostics`, `project-analyzer`, `mock-runtime`) feed orchestration packages (`adapters/vite`, `preview-worker`, `daemon`). `mcp-server` exposes 3 tools over stdio (`open_page`, `close_preview`, `get_status`); `editor-ui` is a minimal Vite app that loads the synthetic preview in an iframe. `apps/claude-plugin` ships a `/visual <page>` slash command + `.mcp.json` registering the MCP server. The Phase 0 spike code stays put in `spike/` — Phase 1.B will port the parts we need.

**Tech Stack:** Node 22+ (ESM-only), TypeScript 5.6+, npm workspaces, vitest, Zod, jiti (TS config loader), `@faker-js/faker`, `@modelcontextprotocol/sdk` (stdio), `chokidar` (Phase 1.C), Vite 5, React 18, Tailwind 3, Zustand, `ws` for WebSocket, `cross-spawn` for child processes.

**Phase 1.A scope explicitly OUT:** code-mods (no editing), editor-ui in any form (iframe wrapper, overlay, properties panel, handles, color picker — entire `packages/editor-ui/` deferred to 1.B), Ask-AI queue + WAL, asset-proxy beyond placeholder strategy, multi-session daemon discovery, CRA adapter, `findApiContracts`, `buildMSWHandlers`, full diagnostics logger redaction policy, lock-file takeover, ProjectAnalyzer cache invalidation, MCP-driven daemon auto-spawn (user starts daemon manually for 1.A), HMR validation in e2e (HMR works because Vite handles it natively, but proving it in a Playwright test is deferred). These belong to Phase 1.B / 1.C.

**Documented 1.A operating constraints:**
- `loadConfig` env-var sandbox via `Object.defineProperty(process, 'env', …)` is best-effort. jiti v2 may execute the user's config in a context that bypasses the swap, so unsafe-env detection is not a strong security guarantee in 1.A — Phase 1.C will harden this with a real VM context. The plan still installs the swap because it catches the common case (top-level `process.env.SECRET` reads) and provides the contract surface that the hardened version preserves.
- The MCP server requires the daemon to be already running (started in a separate terminal). Auto-spawn is deferred to 1.B.
- The e2e test (Task 19) requires `npm install` at the repo root before running, so workspace deps are hoisted and `examples/basic-vite/visual-edit.config.ts` can resolve `@tanstack/react-query` via jiti.
- Playwright tests require `npx playwright install --with-deps chromium` before the first run; this is added as a pretest hook in `tests/e2e/package.json`.

**Acceptance** (the gate that ends Phase 1.A): `examples/basic-vite/` is a real Vite+React+TS+Tailwind project with `visual-edit.config.ts` defining a `wrapPage` and one Zod-derived schema. Running:
```
node packages/daemon/dist/cli.js start --root examples/basic-vite &
# (mcp-server reads daemon port from .visual-edit/daemon.lock)
node packages/mcp-server/dist/cli.js call open_page '{"root":"examples/basic-vite","page":"src/pages/Home.tsx"}'
```
returns `{ url: "http://127.0.0.1:5180/", sessionId: "..." }`. Opening that URL **directly** in a browser shows `Home.tsx` rendered, wrapped by `wrapPage`, with Tailwind styles applied and `useUser()` showing faker-derived data sourced from `globalThis.__VE_MOCKS.makeUser()`. Console: zero errors. Interactive (clicks work). No editor-ui involved — that's 1.B.

---

## File Structure

```
visual-edit-plugin/
├── package.json                    — workspace root
├── tsconfig.base.json              — shared TS config (extended by every package)
├── .npmrc                          — sets workspace defaults
├── .prettierrc.json                — minimal style consistency
├── packages/
│   ├── shared/                     — pure types
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── ids.ts              — ProjectRoot, ElementId, RouteSpec
│   │   │   ├── project.ts          — ProjectInfo, PageEntry, VisualEditConfig, MockSchema, ApiEndpoint
│   │   │   └── runtime.ts          — PreviewSession, DaemonStatus
│   │   └── tests/
│   │
│   ├── protocol/                   — Zod schemas + PROTOCOL_VERSION
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── version.ts          — PROTOCOL_VERSION
│   │   │   ├── http.ts             — daemon HTTP request/response schemas
│   │   │   ├── ws.ts               — WebSocket message schemas (hello, snapshot, bye)
│   │   │   └── ipc.ts              — daemon↔preview-worker IPC schemas
│   │   └── tests/
│   │
│   ├── diagnostics/                — error envelope + logger
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── envelope.ts         — ErrorEnvelope, VisualEditError
│   │   │   ├── codes.ts            — VE_PROJECT_*, VE_PREVIEW_*, etc.
│   │   │   └── logger.ts           — basic NDJSON logger (full redaction in 1.C)
│   │   └── tests/
│   │
│   ├── project-analyzer/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── analyze.ts          — reads package.json, tsconfig, vite.config
│   │   │   ├── loadConfig.ts       — loads visual-edit.config.ts via jiti
│   │   │   ├── findRoutes.ts       — globs .tsx files in src/pages or per config
│   │   │   ├── discoverSchemas.ts  — finds *.schema.ts (Zod) + extracts shapes
│   │   │   └── safeEnv.ts          — filters .env by safeEnvPrefixes
│   │   └── tests/
│   │       └── __fixtures__/projects/   — synthetic test projects
│   │
│   ├── mock-runtime/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── fakerBindings.ts    — schema field name → faker call (heuristic table)
│   │   │   └── entryWrapper.ts     — generates the synthetic entry.tsx code
│   │   └── tests/
│   │
│   ├── adapters/
│   │   └── vite/
│   │       ├── package.json
│   │       ├── tsconfig.json
│   │       ├── src/
│   │       │   ├── index.ts
│   │       │   ├── generate.ts     — writes ephemeral .visual-edit/preview-<hash>/{entry.tsx,vite.config.ts,index.html}
│   │       │   └── spawn.ts        — runs `vite dev` in the ephemeral dir
│   │       └── tests/
│   │
│   ├── preview-worker/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            — worker entry: read AdapterInput from IPC, call adapter.start, send 'ready' or 'error'
│   │   │   └── ipc.ts              — typed wrappers around process.send / 'message' event
│   │   └── tests/
│   │
│   ├── daemon/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── daemon.ts           — Daemon class: openPreview, closePreview, getStatus
│   │   │   ├── lockFile.ts         — writes/reads .visual-edit/daemon.lock (no takeover yet — single-session for 1.A)
│   │   │   ├── http.ts             — HTTP server: POST /preview, POST /close, GET /status
│   │   │   ├── previewSupervisor.ts — forks preview-worker, awaits 'ready', tracks sessions
│   │   │   ├── ws.ts               — WebSocket server (just hello/snapshot for 1.A; no edits)
│   │   │   ├── portFinder.ts       — finds free port in 5180-5200
│   │   │   └── cli.ts              — `daemon start --root <path>`
│   │   └── tests/
│   │
│   └── mcp-server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts            — registers tools on a Server instance
│       │   ├── tools.ts            — open_page, close_preview, get_status
│       │   ├── daemonClient.ts     — HTTP client for talking to daemon
│       │   └── cli.ts              — stdio entry; reads .visual-edit/daemon.lock to discover daemon port
│       └── tests/
│
├── apps/
│   └── claude-plugin/
│       ├── plugin.json             — manifest
│       ├── .mcp.json               — registers visual-edit-mcp-server (npx)
│       ├── commands/
│       │   └── visual.md           — /visual <page>
│       └── skills/
│           └── using-visual-edit/
│               └── SKILL.md
│
├── examples/
│   └── basic-vite/                 — minimal Vite+React+Tailwind project for e2e
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       ├── visual-edit.config.ts   — defines wrapPage + one schema mapping
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── pages/
│           │   └── Home.tsx        — uses useUser() (a faked React Query hook)
│           ├── lib/
│           │   ├── queryClient.ts
│           │   └── api.ts          — useUser() implementation
│           └── schemas/
│               └── user.schema.ts  — Zod schema for User (the demo schema)
│
├── spike/                          — Phase 0 code, untouched
└── docs/                           — specs + plans (untouched)
```

---

## Sequencing & Dependency Notes

Tasks 1-4 lay the workspace + pure-type packages (parallelizable in theory; sequenced for clarity).
Tasks 5-8 build `project-analyzer` (each sub-piece TDD'd independently).
Tasks 9-10 build `mock-runtime`.
Tasks 11-12 build `adapters/vite` (generate, then spawn).
Task 13 builds `preview-worker` (depends on adapter's IPC contract).
Tasks 14-15 build `daemon` (lockFile + portFinder, then http + ws + supervisor + daemon orchestration).
Task 16: `mcp-server` (reads daemon port from lockfile).
Task 17: `apps/claude-plugin` (manifest + slash command + skill + .mcp.json).
Task 18: `examples/basic-vite` seed project.
Task 19: end-to-end smoke + acceptance gate (renamed from Task 20).
Task 20: doc updates (changelog, README, mark Phase 1.A complete in spec — renamed from Task 21).

**Note: editor-ui (`packages/editor-ui/`) is intentionally NOT in this plan.** It was originally Task 17 but was dropped during plan review — the 1.A acceptance criterion is "user opens the synthetic Vite URL directly", and the editor-ui only becomes load-bearing in Phase 1.B when an overlay is added. Building an empty iframe wrapper now would create routing complexity (editor-ui's port vs daemon's port vs synthetic preview's port, WebSocket proxying) without delivering 1.A value.

---

### Task 1: Monorepo bootstrap

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `packages/tsconfig.json` (solution file: composite project references in topological build order)
- Create: `.npmrc`
- Create: `.prettierrc.json`
- Modify: `.gitignore` (root, exists from spike)

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "visual-edit-monorepo",
  "private": true,
  "workspaces": ["packages/*", "packages/adapters/*", "apps/*", "examples/*"],
  "engines": { "node": ">=22.0.0" },
  "type": "module",
  "scripts": {
    "build": "tsc -b packages/tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "prettier --check .",
    "format": "prettier --write .",
    "clean": "tsc -b packages/tsconfig.json --clean && rimraf packages/*/dist packages/adapters/*/dist"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.4",
    "tsx": "4.19.2",
    "@types/node": "22.9.0",
    "prettier": "3.3.3",
    "rimraf": "6.0.1"
  }
}
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true,
    "lib": ["ES2022"],
    "types": ["node"]
  }
}
```

(Note: `allowImportingTsExtensions` is false here so packages can compile to dist/ and consume each other via package.json `exports`. The spike kept it true for direct .ts execution; production packages need real builds.)

- [ ] **Step 2.5: Create packages/tsconfig.json (solution file)**

This is the project-references solution file that `tsc -b` consumes. References must be in topological build order.

```json
{
  "files": [],
  "references": [
    { "path": "./shared" },
    { "path": "./protocol" },
    { "path": "./diagnostics" },
    { "path": "./project-analyzer" },
    { "path": "./mock-runtime" },
    { "path": "./adapters/vite" },
    { "path": "./preview-worker" },
    { "path": "./daemon" },
    { "path": "./mcp-server" }
  ]
}
```

- [ ] **Step 3: Create .npmrc**

```
prefer-workspace-packages=true
save-workspace-protocol=preserve
```

- [ ] **Step 4: Create .prettierrc.json**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

- [ ] **Step 5: Update .gitignore**

Append to existing `.gitignore`:
```
packages/*/dist/
packages/*/.tsbuildinfo
packages/adapters/*/dist/
packages/adapters/*/.tsbuildinfo
apps/*/dist/
.visual-edit/
```

- [ ] **Step 6: Install root deps + verify**

```bash
npm install
npx tsc --version
npx vitest --version
npx prettier --version
```

Expected: TypeScript 5.6.3, Vitest 2.1.4, Prettier 3.3.3.

- [ ] **Step 7: Commit + push**

```bash
git add package.json tsconfig.base.json packages/tsconfig.json .npmrc .prettierrc.json .gitignore package-lock.json
git commit -m "chore: bootstrap phase 1.a monorepo (npm workspaces)"
git push origin main
```

---

### Task 2: packages/shared

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/ids.ts`
- Create: `packages/shared/src/project.ts`
- Create: `packages/shared/src/runtime.ts`
- Create: `packages/shared/tests/types.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/shared/package.json`:
```json
{
  "name": "@visual-edit/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/shared/tests/types.test.ts`:
```ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  ElementId,
  ProjectRoot,
  RouteSpec,
  ProjectInfo,
  PageEntry,
  VisualEditConfig,
  MockSchema,
  ApiEndpoint,
  PreviewSession,
  DaemonStatus,
} from '../src/index.js';

describe('shared types', () => {
  it('ProjectInfo has the spec fields', () => {
    const info: ProjectInfo = {
      root: '/x' as ProjectRoot,
      framework: 'vite',
      reactVersion: '18.2.0',
      packageManager: 'npm',
      styling: ['tailwind'],
      tsconfigPaths: { '@/*': ['./src/*'] },
      workspaces: null,
      publicDir: 'public',
      envFiles: ['.env'],
      routes: [],
      config: null,
    };
    expectTypeOf(info.framework).toEqualTypeOf<'vite' | 'cra' | 'unknown'>();
  });

  it('PreviewSession.status is exhaustive', () => {
    const ok: PreviewSession['status'] = 'ready';
    const _ok2: PreviewSession['status'] = 'starting';
    const _ok3: PreviewSession['status'] = 'crashed';
    const _ok4: PreviewSession['status'] = 'closed';
    expectTypeOf(ok).toEqualTypeOf<'starting' | 'ready' | 'crashed' | 'closed'>();
  });
});
```

- [ ] **Step 3: Run test (fails: module not found)**

```bash
cd packages/shared && npx vitest run
```

Expected: FAIL — `Cannot find module '../src/index.js'`.

- [ ] **Step 4: Implement ids.ts**

`packages/shared/src/ids.ts`:
```ts
export type ProjectRoot = string & { readonly __brand: 'ProjectRoot' };
export type ElementId = string;
export type RouteSpec = string;
```

- [ ] **Step 5: Implement project.ts**

`packages/shared/src/project.ts`:
```ts
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
```

- [ ] **Step 6: Implement runtime.ts**

`packages/shared/src/runtime.ts`:
```ts
import type { PageEntry } from './project.js';

export interface PreviewSession {
  id: string;
  url: string;
  pageRef: PageEntry;
  startedAt: string;
  status: 'starting' | 'ready' | 'crashed' | 'closed';
}

export interface DaemonStatus {
  daemonVersion: string;
  uptime: number;
  activePreviews: number;
  workerHealth: Record<string, 'ok' | 'degraded' | 'down'>;
  // Phase 1.C will add: queueDepth, walSize.
}
```

- [ ] **Step 7: Implement index.ts**

`packages/shared/src/index.ts`:
```ts
export type { ProjectRoot, ElementId, RouteSpec } from './ids.js';
export type {
  ProjectInfo,
  PageEntry,
  VisualEditConfig,
  WrapPageFn,
  ApiEndpoint,
  MockSchema,
} from './project.js';
export type { PreviewSession, DaemonStatus } from './runtime.js';
```

- [ ] **Step 8: Build + test**

```bash
cd packages/shared && npm run build && npx vitest run
```

Expected: build succeeds (creates `dist/`); 2 tests pass.

- [ ] **Step 9: Commit + push**

```bash
git add packages/shared/
git commit -m "feat(shared): pure types for project, runtime, ids"
git push origin main
```

---

### Task 3: packages/protocol

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/version.ts`
- Create: `packages/protocol/src/http.ts`
- Create: `packages/protocol/src/ws.ts`
- Create: `packages/protocol/src/ipc.ts`
- Create: `packages/protocol/tests/protocol.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/protocol/package.json`:
```json
{
  "name": "@visual-edit/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "3.23.8"
  }
}
```

`packages/protocol/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

Run `npm install` from repo root to wire the workspace.

- [ ] **Step 2: Write the failing test**

`packages/protocol/tests/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  OpenPreviewRequest,
  OpenPreviewResponse,
  WsHelloMessage,
  WsSnapshotMessage,
  IpcReadyMessage,
} from '../src/index.js';

describe('protocol', () => {
  it('exposes PROTOCOL_VERSION = "1.0"', () => {
    expect(PROTOCOL_VERSION).toBe('1.0');
  });

  it('OpenPreviewRequest accepts valid input', () => {
    const parsed = OpenPreviewRequest.parse({ root: '/p', page: 'src/App.tsx' });
    expect(parsed.root).toBe('/p');
    expect(parsed.page).toBe('src/App.tsx');
  });

  it('OpenPreviewResponse requires url + sessionId', () => {
    const ok = OpenPreviewResponse.parse({ url: 'http://localhost:5180/?s=a', sessionId: 'a' });
    expect(ok.url).toMatch(/^http/);
    expect(() => OpenPreviewResponse.parse({ url: 'x' })).toThrow();
  });

  it('WsHelloMessage carries protocol version', () => {
    const m = WsHelloMessage.parse({
      kind: 'hello',
      version: '1.0',
      sessionId: 's',
    });
    expect(m.kind).toBe('hello');
    expect(m.version).toBe('1.0');
  });

  it('WsSnapshotMessage carries url + status', () => {
    const m = WsSnapshotMessage.parse({
      kind: 'snapshot',
      sessionId: 's',
      url: 'http://localhost:5180/?s=s',
      status: 'ready',
    });
    expect(m.status).toBe('ready');
  });

  it('IpcReadyMessage requires url', () => {
    const ok = IpcReadyMessage.parse({ kind: 'ready', url: 'http://localhost:5180' });
    expect(ok.url).toMatch(/^http/);
  });
});
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/protocol && npx vitest run
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement version.ts**

`packages/protocol/src/version.ts`:
```ts
export const PROTOCOL_VERSION = '1.0' as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;
```

- [ ] **Step 5: Implement http.ts**

`packages/protocol/src/http.ts`:
```ts
import { z } from 'zod';

export const OpenPreviewRequest = z.object({
  root: z.string().min(1),
  page: z.string().min(1),
});
export type OpenPreviewRequest = z.infer<typeof OpenPreviewRequest>;

export const OpenPreviewResponse = z.object({
  url: z.string().url(),
  sessionId: z.string().min(1),
});
export type OpenPreviewResponse = z.infer<typeof OpenPreviewResponse>;

export const ClosePreviewRequest = z.object({
  sessionId: z.string().min(1),
});
export type ClosePreviewRequest = z.infer<typeof ClosePreviewRequest>;

export const StatusResponse = z.object({
  daemonVersion: z.string(),
  uptime: z.number(),
  activePreviews: z.number().int().nonnegative(),
  workerHealth: z.record(z.string(), z.enum(['ok', 'degraded', 'down'])),
});
export type StatusResponse = z.infer<typeof StatusResponse>;
```

- [ ] **Step 6: Implement ws.ts**

`packages/protocol/src/ws.ts`:
```ts
import { z } from 'zod';

export const WsHelloMessage = z.object({
  kind: z.literal('hello'),
  version: z.literal('1.0'),
  sessionId: z.string().min(1),
});
export type WsHelloMessage = z.infer<typeof WsHelloMessage>;

export const WsSnapshotMessage = z.object({
  kind: z.literal('snapshot'),
  sessionId: z.string().min(1),
  url: z.string().url(),
  status: z.enum(['starting', 'ready', 'crashed', 'closed']),
});
export type WsSnapshotMessage = z.infer<typeof WsSnapshotMessage>;

export const WsByeMessage = z.object({
  kind: z.literal('bye'),
  sessionId: z.string().min(1),
});
export type WsByeMessage = z.infer<typeof WsByeMessage>;

export const WsMessage = z.union([WsHelloMessage, WsSnapshotMessage, WsByeMessage]);
export type WsMessage = z.infer<typeof WsMessage>;
```

- [ ] **Step 7: Implement ipc.ts**

`packages/protocol/src/ipc.ts`:
```ts
import { z } from 'zod';

export const IpcStartMessage = z.object({
  kind: z.literal('start'),
  adapterInput: z.unknown(), // typed in adapters package; protocol just transports
});
export type IpcStartMessage = z.infer<typeof IpcStartMessage>;

export const IpcReadyMessage = z.object({
  kind: z.literal('ready'),
  url: z.string().url(),
});
export type IpcReadyMessage = z.infer<typeof IpcReadyMessage>;

export const IpcErrorMessage = z.object({
  kind: z.literal('error'),
  message: z.string(),
  stack: z.string().optional(),
});
export type IpcErrorMessage = z.infer<typeof IpcErrorMessage>;

export const IpcMessage = z.union([IpcStartMessage, IpcReadyMessage, IpcErrorMessage]);
export type IpcMessage = z.infer<typeof IpcMessage>;
```

- [ ] **Step 8: Implement index.ts**

`packages/protocol/src/index.ts`:
```ts
export { PROTOCOL_VERSION, type ProtocolVersion } from './version.js';
export {
  OpenPreviewRequest,
  OpenPreviewResponse,
  ClosePreviewRequest,
  StatusResponse,
} from './http.js';
export {
  WsHelloMessage,
  WsSnapshotMessage,
  WsByeMessage,
  WsMessage,
} from './ws.js';
export {
  IpcStartMessage,
  IpcReadyMessage,
  IpcErrorMessage,
  IpcMessage,
} from './ipc.js';
```

- [ ] **Step 9: Build + test**

```bash
cd packages/protocol && npm run build && npx vitest run
```

Expected: build succeeds; 6 tests pass.

- [ ] **Step 10: Commit + push**

```bash
git add packages/protocol/ package-lock.json
git commit -m "feat(protocol): zod schemas + PROTOCOL_VERSION 1.0"
git push origin main
```

---

### Task 4: packages/diagnostics

**Files:**
- Create: `packages/diagnostics/package.json`
- Create: `packages/diagnostics/tsconfig.json`
- Create: `packages/diagnostics/src/index.ts`
- Create: `packages/diagnostics/src/envelope.ts`
- Create: `packages/diagnostics/src/codes.ts`
- Create: `packages/diagnostics/src/logger.ts`
- Create: `packages/diagnostics/tests/diagnostics.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/diagnostics/package.json`:
```json
{
  "name": "@visual-edit/diagnostics",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  }
}
```

`packages/diagnostics/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/diagnostics/tests/diagnostics.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  VisualEditError,
  makeEnvelope,
  CODES,
  Logger,
} from '../src/index.js';

describe('diagnostics', () => {
  it('makeEnvelope assigns a traceId and required fields', () => {
    const env = makeEnvelope({
      code: CODES.VE_PROJECT_001_MISSING_CONFIG,
      message: 'config missing',
      severity: 'fatal',
      recovery: 'user-action',
      blame: 'user-config',
    });
    expect(env.traceId).toMatch(/^[0-9a-f]{16}$/);
    expect(env.code).toBe('VE_PROJECT_001');
    expect(env.severity).toBe('fatal');
  });

  it('VisualEditError carries the envelope', () => {
    const err = new VisualEditError(
      makeEnvelope({
        code: CODES.VE_PREVIEW_001_WORKER_TIMEOUT,
        message: 'timeout',
        severity: 'error',
        recovery: 'automatic-retry',
        blame: 'tool',
      }),
    );
    expect(err.envelope.code).toBe('VE_PREVIEW_001');
    expect(err.message).toBe('timeout');
  });

  it('Logger writes NDJSON lines', async () => {
    const lines: string[] = [];
    const logger = new Logger({ write: (s) => lines.push(s) });
    logger.info('hello', { foo: 'bar' });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.foo).toBe('bar');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('Logger.error includes envelope when present', () => {
    const lines: string[] = [];
    const logger = new Logger({ write: (s) => lines.push(s) });
    const env = makeEnvelope({
      code: CODES.VE_INTERNAL_999_ASSERT,
      message: 'invariant violated',
      severity: 'fatal',
      recovery: 'unrecoverable',
      blame: 'tool',
    });
    logger.error('boom', { envelope: env });
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed.envelope.code).toBe('VE_INTERNAL_999');
    expect(parsed.envelope.traceId).toBe(env.traceId);
  });
});
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/diagnostics && npx vitest run
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Implement codes.ts**

`packages/diagnostics/src/codes.ts`:
```ts
export const CODES = {
  // Project / config
  VE_PROJECT_001_MISSING_CONFIG: 'VE_PROJECT_001',
  VE_PROJECT_002_ROUTE_NOT_FOUND: 'VE_PROJECT_002',
  VE_PROJECT_990_UNSUPPORTED_OS: 'VE_PROJECT_990',
  VE_PROJECT_991_NODE_TOO_OLD: 'VE_PROJECT_991',
  VE_PROJECT_992_NEXT_NOT_SUPPORTED: 'VE_PROJECT_992',
  VE_CONFIG_001_UNSAFE_ENV_ACCESS: 'VE_CONFIG_001',
  // Preview / adapter
  VE_PREVIEW_001_WORKER_TIMEOUT: 'VE_PREVIEW_001',
  VE_PREVIEW_002_WORKER_CRASHED: 'VE_PREVIEW_002',
  VE_PREVIEW_003_PORT_EXHAUSTED: 'VE_PREVIEW_003',
  // Protocol / IPC
  VE_PROTOCOL_001_VERSION_MISMATCH: 'VE_PROTOCOL_001',
  VE_PROTOCOL_002_INVALID_MESSAGE: 'VE_PROTOCOL_002',
  // Filesystem
  VE_FS_001_LOCK_HELD: 'VE_FS_001',
  // Internal
  VE_INTERNAL_999_ASSERT: 'VE_INTERNAL_999',
} as const;

export type ErrorCode = (typeof CODES)[keyof typeof CODES];
```

- [ ] **Step 5: Implement envelope.ts**

`packages/diagnostics/src/envelope.ts`:
```ts
import { randomBytes } from 'node:crypto';
import type { ErrorCode } from './codes.js';

export type Severity = 'info' | 'warn' | 'error' | 'fatal';
export type Recovery = 'none' | 'automatic-retry' | 'user-action' | 'unrecoverable';
export type Blame = 'user-config' | 'user-code' | 'tool' | 'environment' | 'unknown';

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  severity: Severity;
  recovery: Recovery;
  blame: Blame;
  hint?: string;
  context?: Record<string, unknown>;
  cause?: ErrorEnvelope;
  traceId: string;
}

export interface MakeEnvelopeInput {
  code: ErrorCode;
  message: string;
  severity: Severity;
  recovery: Recovery;
  blame: Blame;
  hint?: string;
  context?: Record<string, unknown>;
  cause?: ErrorEnvelope;
}

export function makeEnvelope(input: MakeEnvelopeInput): ErrorEnvelope {
  return {
    ...input,
    traceId: randomBytes(8).toString('hex'),
  };
}

export class VisualEditError extends Error {
  readonly envelope: ErrorEnvelope;
  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'VisualEditError';
    this.envelope = envelope;
  }
}
```

- [ ] **Step 6: Implement logger.ts**

`packages/diagnostics/src/logger.ts`:
```ts
import type { ErrorEnvelope } from './envelope.js';

export interface LogSink {
  write(line: string): void;
}

export interface LogContext {
  envelope?: ErrorEnvelope;
  [k: string]: unknown;
}

export class Logger {
  constructor(private sink: LogSink = { write: (s) => process.stderr.write(s) }) {}

  private emit(level: 'info' | 'warn' | 'error' | 'debug', msg: string, ctx?: LogContext): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(ctx ?? {}),
    }) + '\n';
    this.sink.write(line);
  }

  info(msg: string, ctx?: LogContext): void { this.emit('info', msg, ctx); }
  warn(msg: string, ctx?: LogContext): void { this.emit('warn', msg, ctx); }
  error(msg: string, ctx?: LogContext): void { this.emit('error', msg, ctx); }
  debug(msg: string, ctx?: LogContext): void { this.emit('debug', msg, ctx); }
}
```

(Note: full redaction policy with allowlist + `<HASH:length:summary>` placeholders is Phase 1.C work. For 1.A we keep the logger simple; callers are responsible for not logging secrets.)

- [ ] **Step 7: Implement index.ts**

`packages/diagnostics/src/index.ts`:
```ts
export { CODES, type ErrorCode } from './codes.js';
export {
  type ErrorEnvelope,
  type Severity,
  type Recovery,
  type Blame,
  type MakeEnvelopeInput,
  makeEnvelope,
  VisualEditError,
} from './envelope.js';
export { Logger, type LogSink, type LogContext } from './logger.js';
```

- [ ] **Step 8: Build + test**

```bash
cd packages/diagnostics && npm run build && npx vitest run
```

Expected: build succeeds; 4 tests pass.

- [ ] **Step 9: Commit + push**

```bash
git add packages/diagnostics/
git commit -m "feat(diagnostics): error envelope + basic NDJSON logger"
git push origin main
```

---

### Task 5: project-analyzer — analyze.ts

**Files:**
- Create: `packages/project-analyzer/package.json`
- Create: `packages/project-analyzer/tsconfig.json`
- Create: `packages/project-analyzer/src/index.ts`
- Create: `packages/project-analyzer/src/analyze.ts`
- Create: `packages/project-analyzer/tests/analyze.test.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/package.json`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/vite.config.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/tsconfig.json`

- [ ] **Step 1: Package skeleton**

`packages/project-analyzer/package.json`:
```json
{
  "name": "@visual-edit/project-analyzer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@visual-edit/shared": "*",
    "@visual-edit/diagnostics": "*",
    "fast-glob": "3.3.2",
    "jiti": "2.4.0",
    "typescript": "5.6.3"
  }
}
```

`packages/project-analyzer/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" },
    { "path": "../diagnostics" }
  ]
}
```

Run `npm install` from repo root.

- [ ] **Step 2: Create fixture project**

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/package.json`:
```json
{
  "name": "fixture-vite-tailwind",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "vite": "5.4.10",
    "@vitejs/plugin-react": "4.3.3",
    "tailwindcss": "3.4.14"
  }
}
```

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 3: Write the failing test**

`packages/project-analyzer/tests/analyze.test.ts`:
```ts
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
```

- [ ] **Step 4: Run test (fails)**

```bash
cd packages/project-analyzer && npx vitest run tests/analyze.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement analyze.ts**

`packages/project-analyzer/src/analyze.ts`:
```ts
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectInfo, ProjectRoot } from '@visual-edit/shared';

export async function analyze(rootInput: string): Promise<ProjectInfo> {
  const root = rootInput as ProjectRoot;
  const pkgJsonPath = join(root, 'package.json');
  const pkgRaw = await readFile(pkgJsonPath, 'utf8');
  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined ?? {}),
    ...(pkg.devDependencies as Record<string, string> | undefined ?? {}),
  };

  const framework = deps['vite'] ? 'vite'
    : deps['react-scripts'] ? 'cra'
    : 'unknown';

  const reactVersion = deps['react'] ?? null;

  const styling: ProjectInfo['styling'] = [];
  if (deps['tailwindcss']) styling.push('tailwind');
  if (deps['styled-components']) styling.push('styled-components');
  // CSS modules detection requires file scan — Phase 1.C.

  const tsconfigPaths = await readTsconfigPaths(root);
  const publicDir = await dirExists(join(root, 'public')) ? 'public' : null;
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
    routes: [],   // populated by findRoutes
    config: null, // populated by loadConfig
  };
}

async function readTsconfigPaths(root: string): Promise<Record<string, string[]>> {
  try {
    const raw = await readFile(join(root, 'tsconfig.json'), 'utf8');
    // Strip JSON-with-comments — minimal stripper: remove // ... and /* ... */
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const parsed = JSON.parse(stripped) as { compilerOptions?: { paths?: Record<string, string[]> } };
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

async function detectPackageManager(root: string): Promise<ProjectInfo['packageManager']> {
  if (await dirExists(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await dirExists(join(root, 'yarn.lock'))) return 'yarn';
  if (await dirExists(join(root, 'bun.lockb'))) return 'bun';
  if (await dirExists(join(root, 'package-lock.json'))) return 'npm';
  return 'npm'; // default
}
```

- [ ] **Step 6: Update index.ts**

`packages/project-analyzer/src/index.ts`:
```ts
export { analyze } from './analyze.js';
```

- [ ] **Step 7: Build + test**

```bash
cd packages/project-analyzer && npm run build && npx vitest run tests/analyze.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 8: Commit + push**

```bash
git add packages/project-analyzer/
git commit -m "feat(project-analyzer): analyze() detects framework, react, styling, paths"
git push origin main
```

---

### Task 6: project-analyzer — loadConfig.ts

**Files:**
- Create: `packages/project-analyzer/src/loadConfig.ts`
- Create: `packages/project-analyzer/src/safeEnv.ts`
- Create: `packages/project-analyzer/tests/loadConfig.test.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/visual-edit.config.ts` (one fixture with valid config)
- Create: `packages/project-analyzer/tests/__fixtures__/projects/unsafe-env/package.json`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/unsafe-env/visual-edit.config.ts` (config that touches `process.env.SECRET`)

- [ ] **Step 1: Add jiti + sandbox dep usage**

`jiti` is already declared in package.json from Task 5.

- [ ] **Step 2: Create fixtures**

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/visual-edit.config.ts`:
```ts
import type { VisualEditConfig } from '@visual-edit/shared';

const config: VisualEditConfig = {
  wrapPage: (children) => children,
  safeEnvPrefixes: ['VITE_', 'PUBLIC_'],
};
export default config;
```

`packages/project-analyzer/tests/__fixtures__/projects/unsafe-env/package.json`:
```json
{ "name": "unsafe-env", "private": true, "type": "module" }
```

`packages/project-analyzer/tests/__fixtures__/projects/unsafe-env/visual-edit.config.ts`:
```ts
const secret = process.env.SECRET; // unsafe access
export default { wrapPage: (c) => c, _leaked: secret };
```

- [ ] **Step 3: Write the failing test**

`packages/project-analyzer/tests/loadConfig.test.ts`:
```ts
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
```

- [ ] **Step 4: Run test (fails)**

```bash
cd packages/project-analyzer && npx vitest run tests/loadConfig.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement safeEnv.ts**

`packages/project-analyzer/src/safeEnv.ts`:
```ts
const DEFAULT_SAFE_PREFIXES = ['VITE_', 'PUBLIC_', 'NEXT_PUBLIC_'];

export function buildSafeProcessEnv(
  raw: NodeJS.ProcessEnv,
  safePrefixes: readonly string[] = DEFAULT_SAFE_PREFIXES,
): { proxy: NodeJS.ProcessEnv; touchedUnsafe: () => string | null } {
  let unsafe: string | null = null;
  const proxy = new Proxy({} as NodeJS.ProcessEnv, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      const isSafe = safePrefixes.some((p) => prop.startsWith(p));
      if (!isSafe) {
        if (unsafe === null) unsafe = prop;
        return undefined;
      }
      return raw[prop];
    },
    has(_t, prop) {
      if (typeof prop !== 'string') return false;
      return safePrefixes.some((p) => prop.startsWith(p)) && prop in raw;
    },
    ownKeys() {
      return Object.keys(raw).filter((k) => safePrefixes.some((p) => k.startsWith(p)));
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!safePrefixes.some((p) => prop.startsWith(p))) return undefined;
      return { configurable: true, enumerable: true, value: raw[prop], writable: false };
    },
  });
  return { proxy, touchedUnsafe: () => unsafe };
}
```

- [ ] **Step 6: Implement loadConfig.ts**

`packages/project-analyzer/src/loadConfig.ts`:
```ts
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { createJiti } from 'jiti';
import {
  CODES,
  VisualEditError,
  makeEnvelope,
} from '@visual-edit/diagnostics';
import type { VisualEditConfig } from '@visual-edit/shared';
import { buildSafeProcessEnv } from './safeEnv.js';

const CONFIG_BASENAMES = ['visual-edit.config.ts', 'visual-edit.config.js', 'visual-edit.config.mjs'];

export async function loadConfig(root: string): Promise<VisualEditConfig | null> {
  const configPath = await findConfig(root);
  if (!configPath) return null;

  // Sandbox: replace process.env with a Proxy that throws on unsafe reads.
  const { proxy, touchedUnsafe } = buildSafeProcessEnv(process.env);
  const originalEnv = process.env;
  // Node disallows direct assignment in some contexts; mutate keys instead.
  // We use Object.defineProperty on `process` to swap env temporarily.
  Object.defineProperty(process, 'env', { value: proxy, configurable: true, writable: true });

  try {
    const jiti = createJiti(configPath, { interopDefault: true, fsCache: false });
    const mod = await jiti.import<unknown>(configPath);
    const cfg = (mod as { default?: VisualEditConfig }).default ?? (mod as VisualEditConfig);

    const unsafe = touchedUnsafe();
    if (unsafe) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CONFIG_001_UNSAFE_ENV_ACCESS,
        message: `visual-edit.config.ts touched unsafe env var: ${unsafe}`,
        severity: 'fatal',
        recovery: 'user-action',
        blame: 'user-config',
        hint: `Only ${'$'}{ safePrefixes.join(',') }-prefixed env vars are exposed. Move secret reads outside the config.`,
      }));
    }

    if (typeof cfg !== 'object' || cfg === null || typeof (cfg as { wrapPage: unknown }).wrapPage !== 'function') {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_001_MISSING_CONFIG,
        message: `visual-edit.config.ts must export default { wrapPage: (children) => ... }`,
        severity: 'fatal',
        recovery: 'user-action',
        blame: 'user-config',
      }));
    }

    return cfg as VisualEditConfig;
  } finally {
    Object.defineProperty(process, 'env', { value: originalEnv, configurable: true, writable: true });
  }
}

async function findConfig(root: string): Promise<string | null> {
  for (const basename of CONFIG_BASENAMES) {
    const p = join(root, basename);
    try {
      await access(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}
```

- [ ] **Step 7: Update index.ts**

`packages/project-analyzer/src/index.ts`:
```ts
export { analyze } from './analyze.js';
export { loadConfig } from './loadConfig.js';
export { buildSafeProcessEnv } from './safeEnv.js';
```

- [ ] **Step 8: Build + test**

```bash
cd packages/project-analyzer && npm run build && npx vitest run tests/loadConfig.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 9: Commit + push**

```bash
git add packages/project-analyzer/
git commit -m "feat(project-analyzer): loadConfig with sandboxed process.env"
git push origin main
```

---

### Task 7: project-analyzer — findRoutes.ts

**Files:**
- Create: `packages/project-analyzer/src/findRoutes.ts`
- Create: `packages/project-analyzer/tests/findRoutes.test.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/src/pages/Home.tsx` (and others)

- [ ] **Step 1: Create page fixtures**

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/src/pages/Home.tsx`:
```tsx
export default function Home() {
  return <div className="home">Home</div>;
}
```

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/src/pages/About.tsx`:
```tsx
export default function About() {
  return <div className="about">About</div>;
}
```

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/src/components/Button.tsx`:
```tsx
export function Button() {
  return <button>click</button>;
}
```

(Components/ files should NOT be picked up as pages by default — only pages/.)

- [ ] **Step 2: Write the failing test**

`packages/project-analyzer/tests/findRoutes.test.ts`:
```ts
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
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/project-analyzer && npx vitest run tests/findRoutes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement findRoutes.ts**

`packages/project-analyzer/src/findRoutes.ts`:
```ts
import { join, relative } from 'node:path';
import fg from 'fast-glob';
import type { PageEntry } from '@visual-edit/shared';

const DEFAULT_GLOB = 'src/pages/**/*.tsx';

export async function findRoutes(root: string, configRoutesGlob: string | undefined): Promise<PageEntry[]> {
  const pattern = configRoutesGlob ?? DEFAULT_GLOB;
  const matches = await fg(pattern, { cwd: root, absolute: true });
  return matches.map<PageEntry>((absPath) => ({
    route: relative(root, absPath).replace(/\\/g, '/'),
    filePath: absPath,
    isClientOnly: true, // Phase 1.A: assume all are client-only; SSR detection is post-MVP
    cssImports: [],     // Populated when we instrument; stays empty here
  }));
}
```

- [ ] **Step 5: Update index.ts**

`packages/project-analyzer/src/index.ts`:
```ts
export { analyze } from './analyze.js';
export { loadConfig } from './loadConfig.js';
export { buildSafeProcessEnv } from './safeEnv.js';
export { findRoutes } from './findRoutes.js';
```

- [ ] **Step 6: Build + test**

```bash
cd packages/project-analyzer && npm run build && npx vitest run tests/findRoutes.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit + push**

```bash
git add packages/project-analyzer/
git commit -m "feat(project-analyzer): findRoutes globs .tsx pages"
git push origin main
```

---

### Task 8: project-analyzer — discoverSchemas.ts

**Files:**
- Create: `packages/project-analyzer/src/discoverSchemas.ts`
- Create: `packages/project-analyzer/tests/discoverSchemas.test.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/src/schemas/user.schema.ts`

- [ ] **Step 1: Create schema fixture**

`packages/project-analyzer/tests/__fixtures__/projects/vite-tailwind/src/schemas/user.schema.ts`:
```ts
import { z } from 'zod';

export const User = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(0),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof User>;
```

- [ ] **Step 2: Write the failing test**

`packages/project-analyzer/tests/discoverSchemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSchemas } from '../src/discoverSchemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '__fixtures__/projects/vite-tailwind');

describe('discoverSchemas', () => {
  it('finds Zod schemas exported from *.schema.ts files', async () => {
    const schemas = await discoverSchemas(FIXTURE);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe('User');
    expect(schemas[0]!.source).toBe('zod');
  });

  it('extracts a usable shape from the schema', async () => {
    const schemas = await discoverSchemas(FIXTURE);
    const user = schemas[0]!;
    const props = user.shape.properties as Record<string, { type?: string }>;
    expect(props['id']!.type).toBe('string');
    expect(props['age']!.type).toBe('integer');
    expect(props['email']!.type).toBe('string');
  });
});
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/project-analyzer && npx vitest run tests/discoverSchemas.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Add zod-to-json-schema dep**

Append to `packages/project-analyzer/package.json` dependencies:
```json
"zod-to-json-schema": "3.23.5"
```

Then `npm install` from root.

- [ ] **Step 5: Implement discoverSchemas.ts**

`packages/project-analyzer/src/discoverSchemas.ts`:
```ts
import { createJiti } from 'jiti';
import fg from 'fast-glob';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { MockSchema } from '@visual-edit/shared';

export async function discoverSchemas(root: string): Promise<MockSchema[]> {
  const files = await fg('src/**/*.schema.ts', { cwd: root, absolute: true });
  const out: MockSchema[] = [];

  for (const file of files) {
    const jiti = createJiti(file, { interopDefault: false, fsCache: false });
    let mod: Record<string, unknown>;
    try {
      mod = await jiti.import<Record<string, unknown>>(file);
    } catch {
      continue; // skip files that fail to load
    }

    for (const [name, value] of Object.entries(mod)) {
      if (!isZodSchema(value)) continue;
      const shape = zodToJsonSchema(value, { name }) as Record<string, unknown>;
      // zodToJsonSchema wraps in $ref/definitions when name is set; pull the inner schema.
      const inner = ((shape as { definitions?: Record<string, Record<string, unknown>> }).definitions ?? {})[name];
      out.push({
        name,
        source: 'zod',
        shape: inner ?? shape,
      });
    }
  }
  return out;
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
}
```

- [ ] **Step 6: Update index.ts**

```ts
export { analyze } from './analyze.js';
export { loadConfig } from './loadConfig.js';
export { buildSafeProcessEnv } from './safeEnv.js';
export { findRoutes } from './findRoutes.js';
export { discoverSchemas } from './discoverSchemas.js';
```

- [ ] **Step 7: Build + test**

```bash
cd packages/project-analyzer && npm run build && npx vitest run tests/discoverSchemas.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 8: Commit + push**

```bash
git add packages/project-analyzer/ package-lock.json
git commit -m "feat(project-analyzer): discoverSchemas extracts Zod schemas to JSON Schema"
git push origin main
```

---

### Task 9: mock-runtime — fakerBindings.ts

**Files:**
- Create: `packages/mock-runtime/package.json`
- Create: `packages/mock-runtime/tsconfig.json`
- Create: `packages/mock-runtime/src/index.ts`
- Create: `packages/mock-runtime/src/fakerBindings.ts`
- Create: `packages/mock-runtime/tests/fakerBindings.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/mock-runtime/package.json`:
```json
{
  "name": "@visual-edit/mock-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@visual-edit/shared": "*"
  }
}
```

`packages/mock-runtime/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 2: Write the failing test**

`packages/mock-runtime/tests/fakerBindings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildFakerBindings, fieldToFakerCall } from '../src/fakerBindings.js';
import type { MockSchema } from '@visual-edit/shared';

describe('fieldToFakerCall', () => {
  it('maps known field names to faker calls', () => {
    expect(fieldToFakerCall('email', 'string')).toBe(`faker.internet.email()`);
    expect(fieldToFakerCall('firstName', 'string')).toBe(`faker.person.firstName()`);
    expect(fieldToFakerCall('id', 'string')).toBe(`faker.string.uuid()`);
    expect(fieldToFakerCall('createdAt', 'string')).toBe(`faker.date.recent().toISOString()`);
  });

  it('falls back to faker.lorem.word() for unknown string fields', () => {
    expect(fieldToFakerCall('bizarreField', 'string')).toBe(`faker.lorem.word()`);
  });

  it('handles number, integer, boolean types', () => {
    expect(fieldToFakerCall('age', 'integer')).toBe(`faker.number.int({ min: 18, max: 65 })`);
    expect(fieldToFakerCall('price', 'number')).toBe(`faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })`);
    expect(fieldToFakerCall('isActive', 'boolean')).toBe(`faker.datatype.boolean()`);
  });
});

describe('buildFakerBindings', () => {
  it('emits a function per schema returning an object literal', () => {
    const schemas: MockSchema[] = [
      {
        name: 'User',
        source: 'zod',
        shape: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            age: { type: 'integer' },
          },
        },
      },
    ];
    const code = buildFakerBindings(schemas);
    expect(code).toContain(`import { faker } from '@faker-js/faker';`);
    expect(code).toContain(`export function makeUser()`);
    expect(code).toContain(`id: faker.string.uuid()`);
    expect(code).toContain(`email: faker.internet.email()`);
    expect(code).toContain(`age: faker.number.int({ min: 18, max: 65 })`);
  });

  it('handles empty schema list', () => {
    const code = buildFakerBindings([]);
    expect(code).toContain(`import { faker } from '@faker-js/faker';`);
    expect(code).not.toContain('export function make');
  });
});
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/mock-runtime && npx vitest run
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement fakerBindings.ts**

`packages/mock-runtime/src/fakerBindings.ts`:
```ts
import type { MockSchema } from '@visual-edit/shared';

const STRING_FIELD_TABLE: Record<string, string> = {
  id: 'faker.string.uuid()',
  uuid: 'faker.string.uuid()',
  email: 'faker.internet.email()',
  firstName: 'faker.person.firstName()',
  lastName: 'faker.person.lastName()',
  fullName: 'faker.person.fullName()',
  name: 'faker.person.fullName()',
  username: 'faker.internet.userName()',
  password: `'***redacted***'`,
  url: 'faker.internet.url()',
  phone: 'faker.phone.number()',
  address: 'faker.location.streetAddress()',
  city: 'faker.location.city()',
  country: 'faker.location.country()',
  zipCode: 'faker.location.zipCode()',
  avatar: 'faker.image.avatar()',
  bio: 'faker.lorem.paragraph()',
  description: 'faker.lorem.sentences(2)',
  title: 'faker.lorem.sentence(4)',
  content: 'faker.lorem.paragraph()',
  createdAt: 'faker.date.recent().toISOString()',
  updatedAt: 'faker.date.recent().toISOString()',
  date: 'faker.date.recent().toISOString()',
  imageUrl: 'faker.image.url()',
  image: 'faker.image.url()',
};

export function fieldToFakerCall(name: string, type: string): string {
  if (type === 'integer') return `faker.number.int({ min: 18, max: 65 })`;
  if (type === 'number') return `faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })`;
  if (type === 'boolean') return `faker.datatype.boolean()`;
  if (type === 'string') {
    return STRING_FIELD_TABLE[name] ?? `faker.lorem.word()`;
  }
  return `null /* unsupported type ${type} */`;
}

export function buildFakerBindings(schemas: MockSchema[]): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated by @visual-edit/mock-runtime — do not edit.`);
  lines.push(`import { faker } from '@faker-js/faker';`);
  lines.push('');

  for (const s of schemas) {
    const props = (s.shape.properties as Record<string, { type?: string }> | undefined) ?? {};
    lines.push(`export function make${s.name}() {`);
    lines.push(`  return {`);
    for (const [field, def] of Object.entries(props)) {
      const type = def.type ?? 'string';
      lines.push(`    ${field}: ${fieldToFakerCall(field, type)},`);
    }
    lines.push(`  };`);
    lines.push(`}`);
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: Implement index.ts (partial — will add entryWrapper in Task 10)**

`packages/mock-runtime/src/index.ts`:
```ts
export { fieldToFakerCall, buildFakerBindings } from './fakerBindings.js';
```

- [ ] **Step 6: Build + test**

```bash
cd packages/mock-runtime && npm run build && npx vitest run
```

Expected: 5 tests pass (3 in `fieldToFakerCall`, 2 in `buildFakerBindings`).

- [ ] **Step 7: Commit + push**

```bash
git add packages/mock-runtime/
git commit -m "feat(mock-runtime): faker bindings generator with field-name heuristics"
git push origin main
```

---

### Task 10: mock-runtime — entryWrapper.ts

**Files:**
- Create: `packages/mock-runtime/src/entryWrapper.ts`
- Create: `packages/mock-runtime/tests/entryWrapper.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mock-runtime/tests/entryWrapper.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildEntryWrapper } from '../src/entryWrapper.js';

describe('buildEntryWrapper', () => {
  it('emits a React entry that imports the page + config and mounts it wrapped', () => {
    const code = buildEntryWrapper({
      pageImportPath: '../../src/pages/Home.tsx',
      configImportPath: '../../visual-edit.config.ts',
      fakerBindingsImportPath: './faker-bindings.ts',
      userCssImportPath: '../../src/index.css',
      sessionId: 'sess-123',
    });
    expect(code).toContain(`import { createRoot } from 'react-dom/client';`);
    expect(code).toContain(`import Page from '../../src/pages/Home.tsx';`);
    expect(code).toContain(`import config from '../../visual-edit.config.ts';`);
    expect(code).toContain(`import * as mocks from './faker-bindings.ts';`);
    expect(code).toContain(`import '../../src/index.css';`);
    expect(code).toContain(`(globalThis as any).__VE_MOCKS = mocks;`);
    expect(code).toContain(`const wrapped = config.wrapPage(<Page />);`);
    expect(code).toContain(`createRoot(document.getElementById('root')!).render`);
    expect(code).toContain(`sess-123`); // sessionId carried for handshake/debugging
  });

  it('falls back to identity wrapPage when config is null', () => {
    const code = buildEntryWrapper({
      pageImportPath: '../../src/pages/Home.tsx',
      configImportPath: null,
      fakerBindingsImportPath: './faker-bindings.ts',
      userCssImportPath: null,
      sessionId: 'sess-x',
    });
    expect(code).not.toContain(`import config from`);
    expect(code).not.toContain(`src/index.css`);
    expect(code).toContain(`const wrapped = (<Page />);`);
  });
});
```

- [ ] **Step 2: Run test (fails)**

```bash
cd packages/mock-runtime && npx vitest run tests/entryWrapper.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement entryWrapper.ts**

`packages/mock-runtime/src/entryWrapper.ts`:
```ts
export interface BuildEntryWrapperInput {
  /** Relative path from the ephemeral entry's location to the user's page file. */
  pageImportPath: string;
  /** Relative path to visual-edit.config.ts, or null if the user has none. */
  configImportPath: string | null;
  /** Relative path to the generated faker-bindings.ts (sibling of the entry). */
  fakerBindingsImportPath: string;
  /** Relative path to the user's global CSS (e.g. src/index.css with Tailwind directives), or null. */
  userCssImportPath: string | null;
  sessionId: string;
}

export function buildEntryWrapper(input: BuildEntryWrapperInput): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated synthetic entry by @visual-edit/mock-runtime — do not edit.`);
  lines.push(`import { createRoot } from 'react-dom/client';`);
  lines.push(`import * as mocks from '${input.fakerBindingsImportPath}';`);
  if (input.userCssImportPath) {
    // Side-effect import — must come before Page so Tailwind utilities resolve.
    lines.push(`import '${input.userCssImportPath}';`);
  }
  lines.push(`import Page from '${input.pageImportPath}';`);
  if (input.configImportPath) {
    lines.push(`import config from '${input.configImportPath}';`);
  }
  lines.push('');
  lines.push(`(globalThis as any).__VE_MOCKS = mocks;`);
  lines.push(`(globalThis as any).__VE_SESSION_ID = '${input.sessionId}';`);
  lines.push('');
  if (input.configImportPath) {
    lines.push(`const wrapped = config.wrapPage(<Page />);`);
  } else {
    lines.push(`const wrapped = (<Page />);`);
  }
  lines.push(`createRoot(document.getElementById('root')!).render(wrapped);`);
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Update index.ts**

```ts
export { fieldToFakerCall, buildFakerBindings } from './fakerBindings.js';
export { buildEntryWrapper, type BuildEntryWrapperInput } from './entryWrapper.js';
```

- [ ] **Step 5: Build + test**

```bash
cd packages/mock-runtime && npm run build && npx vitest run
```

Expected: 7 tests pass total.

- [ ] **Step 6: Commit + push**

```bash
git add packages/mock-runtime/
git commit -m "feat(mock-runtime): entryWrapper generates synthetic React entry"
git push origin main
```

---

### Task 11: adapters/vite — generate.ts

**Files:**
- Create: `packages/adapters/vite/package.json`
- Create: `packages/adapters/vite/tsconfig.json`
- Create: `packages/adapters/vite/src/index.ts`
- Create: `packages/adapters/vite/src/generate.ts`
- Create: `packages/adapters/vite/src/types.ts`
- Create: `packages/adapters/vite/tests/generate.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/adapters/vite/package.json`:
```json
{
  "name": "@visual-edit/adapter-vite",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@visual-edit/shared": "*",
    "@visual-edit/mock-runtime": "*"
  }
}
```

`packages/adapters/vite/tsconfig.json`:
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../../shared" },
    { "path": "../../mock-runtime" }
  ]
}
```

(Note the `../../../tsconfig.base.json` — this package is one level deeper than the others.)

- [ ] **Step 2: Implement types.ts (no test, types only)**

`packages/adapters/vite/src/types.ts`:
```ts
import type { ProjectInfo, PageEntry, MockSchema, VisualEditConfig } from '@visual-edit/shared';

export interface AdapterInput {
  info: ProjectInfo;
  page: PageEntry;
  config: VisualEditConfig | null;
  schemas: MockSchema[];
  port: number;
  sessionId: string;
  /** Filtered env vars (already passed through safeEnvPrefixes). */
  env: Record<string, string>;
}

export interface AdapterHandle {
  url: string;
  stop(): Promise<void>;
}

export interface GenerateResult {
  /** Absolute path to the ephemeral directory we created. */
  ephemeralDir: string;
  /** Absolute path to entry.tsx within ephemeralDir. */
  entryPath: string;
  /** Absolute path to vite.config.ts within ephemeralDir. */
  viteConfigPath: string;
  /** Absolute path to index.html within ephemeralDir. */
  indexHtmlPath: string;
}
```

- [ ] **Step 3: Write the failing test**

`packages/adapters/vite/tests/generate.test.ts`:
```ts
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
```

- [ ] **Step 4: Run test (fails)**

```bash
cd packages/adapters/vite && npx vitest run
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement generate.ts**

`packages/adapters/vite/src/generate.ts`:
```ts
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { buildEntryWrapper, buildFakerBindings } from '@visual-edit/mock-runtime';
import type { AdapterInput, GenerateResult } from './types.js';

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
  const userCssAbs = await findFirstExisting(input.info.root, CANDIDATE_CSS);

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
  plugins: [react()],
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
```

- [ ] **Step 6: Update index.ts**

`packages/adapters/vite/src/index.ts`:
```ts
export { generateEphemeralPreview } from './generate.js';
export type { AdapterInput, AdapterHandle, GenerateResult } from './types.js';
```

- [ ] **Step 7: Build + test**

```bash
cd packages/adapters/vite && npm run build && npx vitest run
```

Expected: 2 tests pass.

- [ ] **Step 8: Commit + push**

```bash
git add packages/adapters/
git commit -m "feat(adapter-vite): generate ephemeral .visual-edit/preview-<hash>/ files"
git push origin main
```

---

### Task 12: adapters/vite — spawn.ts

**Files:**
- Create: `packages/adapters/vite/src/spawn.ts`
- Create: `packages/adapters/vite/tests/spawn.test.ts`

- [ ] **Step 1: Add cross-spawn dep**

Append to `packages/adapters/vite/package.json` dependencies:
```json
"cross-spawn": "7.0.6"
```

And devDependencies:
```json
"@types/cross-spawn": "6.0.6"
```

Run `npm install` from root.

- [ ] **Step 2: Write the failing test**

We test the `Local:` URL extraction logic directly (it's the only piece of `spawn.ts` that has tricky behavior). Spawning real Vite is deferred to the e2e (Task 19) — too flaky/slow for unit tests.

To make the regex testable, refactor `startVite` so its line-parsing helper is exported:

`packages/adapters/vite/tests/spawn.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractLocalUrl, startVite } from '../src/spawn.js';

describe('extractLocalUrl', () => {
  it('parses Vite 5 default Local: line', () => {
    expect(extractLocalUrl('  Local:   http://localhost:5180/')).toBe('http://localhost:5180/');
  });

  it('parses Vite 5 line with arrow prefix', () => {
    expect(extractLocalUrl('  ➜  Local:   http://localhost:5180/')).toBe('http://localhost:5180/');
  });

  it('parses 127.0.0.1 host (strictly bound)', () => {
    expect(extractLocalUrl('  Local:   http://127.0.0.1:5181/')).toBe('http://127.0.0.1:5181/');
  });

  it('returns null for non-Local lines', () => {
    expect(extractLocalUrl('  Network: use --host to expose')).toBeNull();
    expect(extractLocalUrl('VITE v5.4.10 ready')).toBeNull();
    expect(extractLocalUrl('')).toBeNull();
  });

  it('strips trailing ANSI reset / whitespace', () => {
    expect(extractLocalUrl('  Local:   http://localhost:5180/   ')).toBe('http://localhost:5180/');
  });
});

describe('startVite (export shape)', () => {
  it('is exported as a function', () => {
    expect(typeof startVite).toBe('function');
  });
});
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/adapters/vite && npx vitest run
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement spawn.ts**

`packages/adapters/vite/src/spawn.ts`:
```ts
import spawn from 'cross-spawn';
import type { ChildProcess } from 'node:child_process';
import type { AdapterHandle, GenerateResult } from './types.js';

/**
 * Extract `http(s)://...` from a Vite "Local:" stdout line. Returns null if no match.
 * Tolerates leading whitespace, the optional `➜` arrow prefix, and trailing whitespace.
 * Exported for unit testing.
 */
export function extractLocalUrl(line: string): string | null {
  const m = line.match(/Local:\s+(https?:\/\/[^\s]+)/);
  if (!m) return null;
  return m[1]!.trim();
}

export interface StartViteInput {
  generated: GenerateResult;
  port: number;
  /** Env to pass through; should already be filtered by safeEnvPrefixes. */
  env: Record<string, string>;
  /** Called whenever vite emits a stdout line. */
  onLog?: (line: string) => void;
  /** Called when "Local: http://" line is detected. */
  onReady?: (url: string) => void;
}

export function startVite(input: StartViteInput): { process: ChildProcess; handle: Promise<AdapterHandle> } {
  const child = spawn('npx', ['vite', '--config', input.generated.viteConfigPath], {
    cwd: input.generated.ephemeralDir,
    env: { ...process.env, ...input.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const handle = new Promise<AdapterHandle>((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        child.kill('SIGTERM');
        reject(new Error('startVite: timed out after 30s waiting for "Local:" line'));
      }
    }, 30_000);

    const onLine = (line: string) => {
      input.onLog?.(line);
      const url = extractLocalUrl(line);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          url,
          async stop() {
            child.kill('SIGTERM');
            await new Promise((r) => setTimeout(r, 500));
            if (!child.killed) child.kill('SIGKILL');
          },
        });
      }
    };

    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) onLine(line);
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) input.onLog?.(line);
    });
    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`vite exited with code ${code} before becoming ready`));
      }
    });
    child.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });

  return { process: child, handle };
}
```

- [ ] **Step 5: Update index.ts**

`packages/adapters/vite/src/index.ts`:
```ts
export { generateEphemeralPreview } from './generate.js';
export { startVite, extractLocalUrl, type StartViteInput } from './spawn.js';
export type { AdapterInput, AdapterHandle, GenerateResult } from './types.js';
```

- [ ] **Step 6: Build + test**

```bash
cd packages/adapters/vite && npm run build && npx vitest run
```

Expected: 8 tests pass total (2 from generate, 5 extractLocalUrl + 1 startVite shape from spawn).

- [ ] **Step 7: Commit + push**

```bash
git add packages/adapters/ package-lock.json
git commit -m "feat(adapter-vite): startVite spawns vite dev and resolves on Local: line"
git push origin main
```

---

### Task 13: preview-worker

**Files:**
- Create: `packages/preview-worker/package.json`
- Create: `packages/preview-worker/tsconfig.json`
- Create: `packages/preview-worker/src/index.ts`
- Create: `packages/preview-worker/src/ipc.ts`
- Create: `packages/preview-worker/tests/ipc.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/preview-worker/package.json`:
```json
{
  "name": "@visual-edit/preview-worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "bin": {
    "visual-edit-preview-worker": "dist/index.js"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@visual-edit/shared": "*",
    "@visual-edit/protocol": "*",
    "@visual-edit/adapter-vite": "*"
  }
}
```

`packages/preview-worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" },
    { "path": "../protocol" },
    { "path": "../adapters/vite" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`packages/preview-worker/tests/ipc.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sendToParent } from '../src/ipc.js';
import { IpcReadyMessage, IpcErrorMessage } from '@visual-edit/protocol';

describe('preview-worker ipc', () => {
  it('sendToParent serializes IpcReadyMessage', () => {
    const captured: unknown[] = [];
    const fakeProcess = { send: (msg: unknown) => { captured.push(msg); return true; } };
    sendToParent(fakeProcess as unknown as NodeJS.Process, {
      kind: 'ready',
      url: 'http://localhost:5180',
    });
    expect(captured).toHaveLength(1);
    const parsed = IpcReadyMessage.parse(captured[0]);
    expect(parsed.url).toBe('http://localhost:5180');
  });

  it('sendToParent serializes IpcErrorMessage', () => {
    const captured: unknown[] = [];
    const fakeProcess = { send: (msg: unknown) => { captured.push(msg); return true; } };
    sendToParent(fakeProcess as unknown as NodeJS.Process, {
      kind: 'error',
      message: 'boom',
      stack: 'Error: boom\n  at ...',
    });
    const parsed = IpcErrorMessage.parse(captured[0]);
    expect(parsed.message).toBe('boom');
  });

  it('throws when process.send is unavailable', () => {
    const fakeProcess = {} as NodeJS.Process;
    expect(() => sendToParent(fakeProcess, { kind: 'ready', url: 'http://x' })).toThrow(/no IPC channel/i);
  });
});
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/preview-worker && npx vitest run
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement ipc.ts**

`packages/preview-worker/src/ipc.ts`:
```ts
import type { IpcMessage } from '@visual-edit/protocol';

export function sendToParent(proc: NodeJS.Process, msg: IpcMessage): void {
  if (typeof proc.send !== 'function') {
    throw new Error('preview-worker: no IPC channel — must be spawned with stdio: [..., "ipc"]');
  }
  proc.send(msg);
}
```

- [ ] **Step 5: Implement index.ts (the actual worker entry)**

`packages/preview-worker/src/index.ts`:
```ts
#!/usr/bin/env node
import { generateEphemeralPreview, startVite } from '@visual-edit/adapter-vite';
import type { AdapterInput } from '@visual-edit/adapter-vite';
import { sendToParent } from './ipc.js';

let stopRequested = false;

async function main(): Promise<void> {
  if (typeof process.send !== 'function') {
    throw new Error('preview-worker must be spawned with IPC channel');
  }

  // Wait for AdapterInput from parent.
  const input = await new Promise<AdapterInput>((resolve, reject) => {
    const onMsg = (msg: unknown) => {
      const m = msg as { kind?: string; adapterInput?: AdapterInput };
      if (m && m.kind === 'start' && m.adapterInput) {
        process.off('message', onMsg);
        resolve(m.adapterInput);
      }
    };
    process.on('message', onMsg);
    setTimeout(() => reject(new Error('preview-worker: no AdapterInput received within 30s')), 30_000);
  });

  try {
    const generated = await generateEphemeralPreview(input);
    const { process: viteProc, handle } = startVite({
      generated,
      port: input.port,
      env: input.env,
      onLog: (line) => process.stderr.write(line + '\n'),
    });

    process.on('SIGTERM', async () => {
      if (stopRequested) return;
      stopRequested = true;
      const h = await handle.catch(() => null);
      if (h) await h.stop();
      viteProc.kill('SIGTERM');
      process.exit(0);
    });

    const h = await handle;
    sendToParent(process, { kind: 'ready', url: h.url });
  } catch (err) {
    const e = err as Error;
    sendToParent(process, { kind: 'error', message: e.message, stack: e.stack });
    process.exit(1);
  }
}

main().catch((err) => {
  // Should be unreachable; main has its own try/catch.
  process.stderr.write(`preview-worker fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 6: Build + test**

```bash
cd packages/preview-worker && npm run build && npx vitest run
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit + push**

```bash
git add packages/preview-worker/
git commit -m "feat(preview-worker): child-process adapter runner with IPC ready/error reporting"
git push origin main
```

---

### Task 14: daemon — lockFile + portFinder

**Files:**
- Create: `packages/daemon/package.json`
- Create: `packages/daemon/tsconfig.json`
- Create: `packages/daemon/src/index.ts`
- Create: `packages/daemon/src/lockFile.ts`
- Create: `packages/daemon/src/portFinder.ts`
- Create: `packages/daemon/tests/lockFile.test.ts`
- Create: `packages/daemon/tests/portFinder.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/daemon/package.json`:
```json
{
  "name": "@visual-edit/daemon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "bin": {
    "visual-edit-daemon": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@visual-edit/shared": "*",
    "@visual-edit/protocol": "*",
    "@visual-edit/diagnostics": "*",
    "@visual-edit/project-analyzer": "*",
    "@visual-edit/adapter-vite": "*",
    "@visual-edit/preview-worker": "*",
    "ws": "8.18.0"
  },
  "devDependencies": {
    "@types/ws": "8.5.13"
  }
}
```

`packages/daemon/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" },
    { "path": "../protocol" },
    { "path": "../diagnostics" },
    { "path": "../project-analyzer" },
    { "path": "../adapters/vite" },
    { "path": "../preview-worker" }
  ]
}
```

Run `npm install` from root.

- [ ] **Step 2: Write failing tests**

`packages/daemon/tests/lockFile.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLock, readLock, removeLock } from '../src/lockFile.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 've-lock-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('lockFile', () => {
  it('writeLock creates .visual-edit/daemon.lock with pid + port + version', async () => {
    await writeLock(workdir, { pid: 1234, port: 5180, daemonVersion: '0.0.0' });
    const path = join(workdir, '.visual-edit', 'daemon.lock');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.pid).toBe(1234);
    expect(parsed.port).toBe(5180);
    expect(parsed.daemonVersion).toBe('0.0.0');
    expect(typeof parsed.startedAt).toBe('string');
  });

  it('readLock returns null when file is absent', async () => {
    const result = await readLock(workdir);
    expect(result).toBeNull();
  });

  it('readLock returns the parsed lock when present', async () => {
    await writeLock(workdir, { pid: 99, port: 5199, daemonVersion: '0.0.0' });
    const result = await readLock(workdir);
    expect(result?.pid).toBe(99);
  });

  it('removeLock deletes the file', async () => {
    await writeLock(workdir, { pid: 1, port: 5180, daemonVersion: '0.0.0' });
    await removeLock(workdir);
    expect(await readLock(workdir)).toBeNull();
  });
});
```

`packages/daemon/tests/portFinder.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { findFreePort } from '../src/portFinder.js';
import { createServer } from 'node:net';

describe('findFreePort', () => {
  it('returns a port in the configured range', async () => {
    const port = await findFreePort(5180, 5200);
    expect(port).toBeGreaterThanOrEqual(5180);
    expect(port).toBeLessThanOrEqual(5200);
  });

  it('skips ports already in use', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(5180, '127.0.0.1', r));
    try {
      const port = await findFreePort(5180, 5200);
      expect(port).not.toBe(5180);
      expect(port).toBeGreaterThanOrEqual(5181);
    } finally {
      blocker.close();
    }
  });

  it('throws VE_PREVIEW_003 when all ports busy', async () => {
    // Block all ports in a tiny range.
    const blockers = await Promise.all([5180, 5181].map((p) => {
      return new Promise<{ close: () => void }>((res) => {
        const s = createServer();
        s.listen(p, '127.0.0.1', () => res(s));
      });
    }));
    try {
      await expect(findFreePort(5180, 5181)).rejects.toThrow(/VE_PREVIEW_003/);
    } finally {
      for (const b of blockers) b.close();
    }
  });
});
```

- [ ] **Step 3: Run tests (fail)**

```bash
cd packages/daemon && npx vitest run
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Implement lockFile.ts**

`packages/daemon/src/lockFile.ts`:
```ts
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface LockData {
  pid: number;
  port: number;
  daemonVersion: string;
  startedAt: string;
  version: '1';
}

const LOCK_DIR = '.visual-edit';
const LOCK_FILE = 'daemon.lock';

export async function writeLock(
  root: string,
  fields: Pick<LockData, 'pid' | 'port' | 'daemonVersion'>,
): Promise<void> {
  await mkdir(join(root, LOCK_DIR), { recursive: true });
  const lock: LockData = {
    ...fields,
    startedAt: new Date().toISOString(),
    version: '1',
  };
  await writeFile(join(root, LOCK_DIR, LOCK_FILE), JSON.stringify(lock, null, 2), 'utf8');
}

export async function readLock(root: string): Promise<LockData | null> {
  try {
    const raw = await readFile(join(root, LOCK_DIR, LOCK_FILE), 'utf8');
    return JSON.parse(raw) as LockData;
  } catch {
    return null;
  }
}

export async function removeLock(root: string): Promise<void> {
  try {
    await unlink(join(root, LOCK_DIR, LOCK_FILE));
  } catch {
    // ignore — already gone
  }
}
```

- [ ] **Step 5: Implement portFinder.ts**

`packages/daemon/src/portFinder.ts`:
```ts
import { createServer } from 'node:net';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export async function findFreePort(rangeStart: number, rangeEnd: number): Promise<number> {
  for (let p = rangeStart; p <= rangeEnd; p++) {
    if (await isFree(p)) return p;
  }
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_PREVIEW_003_PORT_EXHAUSTED,
    message: `no free port in range ${rangeStart}-${rangeEnd}`,
    severity: 'fatal',
    recovery: 'user-action',
    blame: 'environment',
    hint: 'Stop other dev servers or pick a different port range via VE_PORT_RANGE env.',
  }));
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}
```

- [ ] **Step 6: Implement index.ts (partial)**

`packages/daemon/src/index.ts`:
```ts
export { writeLock, readLock, removeLock, type LockData } from './lockFile.js';
export { findFreePort } from './portFinder.js';
```

- [ ] **Step 7: Build + test**

```bash
cd packages/daemon && npm run build && npx vitest run
```

Expected: 7 tests pass (4 lockFile + 3 portFinder).

- [ ] **Step 8: Commit + push**

```bash
git add packages/daemon/ package-lock.json
git commit -m "feat(daemon): lockFile + portFinder primitives"
git push origin main
```

---

### Task 15: daemon — previewSupervisor + http + ws + daemon class

**Files:**
- Create: `packages/daemon/src/previewSupervisor.ts`
- Create: `packages/daemon/src/http.ts`
- Create: `packages/daemon/src/ws.ts`
- Create: `packages/daemon/src/daemon.ts`
- Create: `packages/daemon/src/cli.ts`
- Create: `packages/daemon/tests/daemon.test.ts`

- [ ] **Step 1: Implement previewSupervisor.ts**

`packages/daemon/src/previewSupervisor.ts`:
```ts
import { fork, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdapterInput } from '@visual-edit/adapter-vite';
import type { IpcMessage } from '@visual-edit/protocol';
import type { PreviewSession } from '@visual-edit/shared';

// __dirname is not defined in ESM; derive from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve to the preview-worker dist entry. From packages/daemon/dist/ → packages/preview-worker/dist/index.js */
function workerEntry(): string {
  return resolve(__dirname, '..', '..', 'preview-worker', 'dist', 'index.js');
}

export interface SupervisedSession {
  session: PreviewSession;
  child: ChildProcess;
}

export class PreviewSupervisor {
  private sessions = new Map<string, SupervisedSession>();

  async spawn(sessionId: string, input: AdapterInput): Promise<PreviewSession> {
    const child = fork(workerEntry(), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    });

    child.send({ kind: 'start', adapterInput: input });

    return new Promise<PreviewSession>((resolveSession, rejectSession) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const timeout = setTimeout(() => {
        settle(() => {
          child.kill('SIGTERM');
          rejectSession(new Error(`worker did not become ready within 30s`));
        });
      }, 30_000);

      child.on('message', (raw: unknown) => {
        const msg = raw as IpcMessage;
        if (msg.kind === 'ready') {
          settle(() => {
            clearTimeout(timeout);
            const session: PreviewSession = {
              id: sessionId,
              url: msg.url,
              pageRef: input.page,
              startedAt: new Date().toISOString(),
              status: 'ready',
            };
            this.sessions.set(sessionId, { session, child });
            resolveSession(session);
          });
        } else if (msg.kind === 'error') {
          settle(() => {
            clearTimeout(timeout);
            rejectSession(new Error(`worker error: ${msg.message}`));
          });
        }
      });

      child.on('exit', (code) => {
        // If exit happens BEFORE 'ready', reject — the caller never got a session.
        // If exit happens AFTER 'ready', mark the existing session crashed.
        settle(() => {
          clearTimeout(timeout);
          rejectSession(new Error(`worker exited with code ${code} before becoming ready`));
        });
        const existing = this.sessions.get(sessionId);
        if (existing) existing.session.status = 'crashed';
      });

      child.on('error', (err) => {
        settle(() => {
          clearTimeout(timeout);
          rejectSession(err);
        });
      });
    });
  }

  async stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!s.child.killed) s.child.kill('SIGKILL');
    s.session.status = 'closed';
    this.sessions.delete(sessionId);
  }

  list(): PreviewSession[] {
    return [...this.sessions.values()].map((s) => s.session);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
  }
}
```

- [ ] **Step 2: Implement http.ts**

`packages/daemon/src/http.ts`:
```ts
import { createServer, type Server } from 'node:http';
import {
  OpenPreviewRequest,
  OpenPreviewResponse,
  ClosePreviewRequest,
  StatusResponse,
} from '@visual-edit/protocol';

export interface HttpHandlers {
  openPreview: (req: OpenPreviewRequest) => Promise<OpenPreviewResponse>;
  closePreview: (req: ClosePreviewRequest) => Promise<void>;
  getStatus: () => Promise<StatusResponse>;
}

export function createHttpServer(handlers: HttpHandlers): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    try {
      const body = await readJsonBody(req);
      if (req.method === 'POST' && req.url === '/preview') {
        const parsed = OpenPreviewRequest.parse(body);
        const resp = await handlers.openPreview(parsed);
        send(200, resp);
      } else if (req.method === 'POST' && req.url === '/close') {
        const parsed = ClosePreviewRequest.parse(body);
        await handlers.closePreview(parsed);
        send(204, null);
      } else if (req.method === 'GET' && req.url === '/status') {
        const status = await handlers.getStatus();
        send(200, status);
      } else {
        send(404, { error: 'not found' });
      }
    } catch (err) {
      send(500, { error: (err as Error).message });
    }
  });
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}
```

- [ ] **Step 3: Implement ws.ts (skeleton — no consumer in 1.A, but the contract is pinned for 1.B)**

`packages/daemon/src/ws.ts`:
```ts
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { WsHelloMessage, type WsSnapshotMessage } from '@visual-edit/protocol';
import type { PreviewSession } from '@visual-edit/shared';

export interface WsHandlers {
  getSession: (sessionId: string) => PreviewSession | null;
}

/**
 * Attach a WebSocket server to the daemon HTTP server. Currently has no in-tree consumer
 * (editor-ui is deferred to Phase 1.B), but the snapshot contract is wired so 1.B can
 * consume it without refactoring the daemon.
 */
export function attachWebSocket(http: Server, handlers: WsHandlers): WebSocketServer {
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (raw) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString()); } catch { socket.close(1003, 'invalid json'); return; }
      const hello = WsHelloMessage.safeParse(parsed);
      if (!hello.success) { socket.close(1003, 'expected hello'); return; }

      const session = handlers.getSession(hello.data.sessionId);
      if (!session) { socket.close(1008, 'unknown session'); return; }

      const snapshot: WsSnapshotMessage = {
        kind: 'snapshot',
        sessionId: session.id,
        url: session.url,
        status: session.status,
      };
      socket.send(JSON.stringify(snapshot));
    });
  });
  return wss;
}
```

- [ ] **Step 4: Implement daemon.ts**

`packages/daemon/src/daemon.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Logger } from '@visual-edit/diagnostics';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { analyze, loadConfig, findRoutes, discoverSchemas } from '@visual-edit/project-analyzer';
import type { ProjectInfo } from '@visual-edit/shared';
import type { AdapterInput } from '@visual-edit/adapter-vite';
import { writeLock, removeLock, readLock } from './lockFile.js';
import { findFreePort } from './portFinder.js';
import { PreviewSupervisor } from './previewSupervisor.js';
import { createHttpServer } from './http.js';
import { attachWebSocket } from './ws.js';

const DAEMON_VERSION = '0.0.0';

export interface DaemonOptions {
  root: string;
  port?: number;
  logger?: Logger;
}

export class Daemon {
  private supervisor = new PreviewSupervisor();
  private startedAt = Date.now();
  private httpServer?: ReturnType<typeof createHttpServer>;
  private wsServer?: ReturnType<typeof attachWebSocket>;
  private logger: Logger;
  private projectInfo?: ProjectInfo;
  private actualPort?: number;

  constructor(private opts: DaemonOptions) {
    this.logger = opts.logger ?? new Logger();
  }

  /** Resolved port the daemon is actually listening on. Undefined before start(). */
  getPort(): number | undefined { return this.actualPort; }

  async start(): Promise<void> {
    const existing = await readLock(this.opts.root);
    if (existing && isProcessAlive(existing.pid)) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_FS_001_LOCK_HELD,
        message: `daemon already running with pid ${existing.pid} on port ${existing.port}`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'environment',
        hint: 'Stop the other daemon or pick a different project root.',
      }));
    }

    this.projectInfo = await analyze(this.opts.root);
    const config = await loadConfig(this.opts.root);
    if (config) {
      const routes = await findRoutes(this.opts.root, config.routes);
      this.projectInfo = { ...this.projectInfo, routes, config };
    } else {
      const routes = await findRoutes(this.opts.root, undefined);
      this.projectInfo = { ...this.projectInfo, routes };
    }

    const port = this.opts.port ?? await findFreePort(5170, 5179);
    this.actualPort = port;

    this.httpServer = createHttpServer({
      openPreview: this.openPreview.bind(this),
      closePreview: this.closePreview.bind(this),
      getStatus: this.getStatus.bind(this),
    });
    this.wsServer = attachWebSocket(this.httpServer, {
      getSession: (id) => this.supervisor.list().find((s) => s.id === id) ?? null,
    });

    await new Promise<void>((r) => this.httpServer!.listen(port, '127.0.0.1', r));
    await writeLock(this.opts.root, { pid: process.pid, port, daemonVersion: DAEMON_VERSION });

    this.logger.info('daemon started', { port, root: this.opts.root, pid: process.pid });

    process.on('SIGTERM', () => this.stop().then(() => process.exit(0)));
    process.on('SIGINT', () => this.stop().then(() => process.exit(0)));
  }

  async stop(): Promise<void> {
    await this.supervisor.stopAll();
    if (this.wsServer) {
      // Force-close all open WS connections so close() resolves.
      for (const client of this.wsServer.clients) client.terminate();
      await new Promise<void>((r) => this.wsServer!.close(() => r()));
    }
    if (this.httpServer) {
      // Available since Node 18.2 — required because keep-alive HTTP connections
      // (e.g. from the mcp-server's fetch) prevent close() from resolving otherwise.
      this.httpServer.closeAllConnections();
      await new Promise<void>((r) => this.httpServer!.close(() => r()));
    }
    await removeLock(this.opts.root);
    this.logger.info('daemon stopped');
  }

  async openPreview(req: { root: string; page: string }): Promise<{ url: string; sessionId: string }> {
    if (!this.projectInfo) throw new Error('daemon not started');
    const matchedPage = this.projectInfo.routes.find((r) => r.route === req.page || r.filePath.endsWith(req.page));
    if (!matchedPage) {
      const alternatives = this.projectInfo.routes.slice(0, 5).map((r) => r.route);
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_002_ROUTE_NOT_FOUND,
        message: `route '${req.page}' not found`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'user-config',
        hint: `Available routes: ${alternatives.join(', ') || '(none)'}`,
      }));
    }

    const sessionId = randomBytes(4).toString('hex');
    const previewPort = await findFreePort(5180, 5200);
    const schemas = await discoverSchemas(this.opts.root);

    const adapterInput: AdapterInput = {
      info: this.projectInfo,
      page: matchedPage,
      config: this.projectInfo.config ?? null,
      schemas,
      port: previewPort,
      sessionId,
      env: filterEnv(process.env, this.projectInfo.config?.safeEnvPrefixes ?? ['VITE_', 'PUBLIC_', 'NEXT_PUBLIC_']),
    };

    const session = await this.supervisor.spawn(sessionId, adapterInput);
    return { url: session.url, sessionId };
  }

  async closePreview(req: { sessionId: string }): Promise<void> {
    await this.supervisor.stop(req.sessionId);
  }

  async getStatus(): Promise<{ daemonVersion: string; uptime: number; activePreviews: number; workerHealth: Record<string, 'ok' | 'degraded' | 'down'> }> {
    return {
      daemonVersion: DAEMON_VERSION,
      uptime: Date.now() - this.startedAt,
      activePreviews: this.supervisor.list().length,
      workerHealth: {},
    };
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function filterEnv(raw: NodeJS.ProcessEnv, prefixes: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && prefixes.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 5: Implement cli.ts**

`packages/daemon/src/cli.ts`:
```ts
#!/usr/bin/env node
import { resolve } from 'node:path';
import { Daemon } from './daemon.js';

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'start') {
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(args[rootIdx + 1] ?? '.') : process.cwd();
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;

  const daemon = new Daemon({ root, port });
  daemon.start().catch((err) => {
    process.stderr.write(`daemon failed to start: ${(err as Error).message}\n`);
    process.exit(1);
  });
} else {
  process.stderr.write('usage: visual-edit-daemon start --root <path> [--port <n>]\n');
  process.exit(1);
}
```

- [ ] **Step 6: Update index.ts**

`packages/daemon/src/index.ts`:
```ts
export { writeLock, readLock, removeLock, type LockData } from './lockFile.js';
export { findFreePort } from './portFinder.js';
export { Daemon, type DaemonOptions } from './daemon.js';
export { PreviewSupervisor } from './previewSupervisor.js';
export { createHttpServer } from './http.js';
export { attachWebSocket } from './ws.js';
```

- [ ] **Step 7: Write daemon integration test**

`packages/daemon/tests/daemon.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createHttpServer } from '../src/http.js';

// Real daemon spawn-and-test is in Task 19 (e2e). Here we just test the http handler wiring.
describe('http handlers (unit)', () => {
  it('wires open/close/status endpoints', async () => {
    let opened = false;
    const server = createHttpServer({
      openPreview: async () => { opened = true; return { url: 'http://x', sessionId: 's' }; },
      closePreview: async () => {},
      getStatus: async () => ({ daemonVersion: '0.0.0', uptime: 0, activePreviews: 0, workerHealth: {} }),
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const resp = await fetch(`http://127.0.0.1:${port}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: '/x', page: 'src/X.tsx' }),
    });
    const body = await resp.json();
    expect(opened).toBe(true);
    expect(body).toEqual({ url: 'http://x', sessionId: 's' });

    await new Promise<void>((r) => server.close(() => r()));
  });
});
```

- [ ] **Step 8: Build + test**

```bash
cd packages/daemon && npm run build && npx vitest run
```

Expected: 8 tests pass (4 lockFile + 3 portFinder + 1 http handler).

- [ ] **Step 9: Commit + push**

```bash
git add packages/daemon/
git commit -m "feat(daemon): supervisor, http, ws, daemon orchestration + cli"
git push origin main
```

---

### Task 16: mcp-server

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/index.ts`
- Create: `packages/mcp-server/src/daemonClient.ts`
- Create: `packages/mcp-server/src/tools.ts`
- Create: `packages/mcp-server/src/cli.ts`
- Create: `packages/mcp-server/tests/daemonClient.test.ts`

- [ ] **Step 1: Package skeleton**

`packages/mcp-server/package.json`:
```json
{
  "name": "@visual-edit/mcp-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "bin": {
    "visual-edit-mcp-server": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@visual-edit/protocol": "*",
    "@visual-edit/daemon": "*",
    "@modelcontextprotocol/sdk": "1.0.4"
  }
}
```

`packages/mcp-server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../protocol" },
    { "path": "../daemon" }
  ]
}
```

(`@visual-edit/daemon` is imported only for `readLock` — the lockfile reader. We do NOT spawn the daemon from the MCP server in 1.A.)

Run `npm install` from root.

- [ ] **Step 2: Write the failing test**

`packages/mcp-server/tests/daemonClient.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { DaemonClient } from '../src/daemonClient.js';

describe('DaemonClient', () => {
  it('openPreview POSTs to /preview', async () => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ url: 'http://x:1', sessionId: 'abc' }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const client = new DaemonClient(`http://127.0.0.1:${port}`);
      const result = await client.openPreview({ root: '/r', page: 'src/X.tsx' });
      expect(result.url).toBe('http://x:1');
      expect(result.sessionId).toBe('abc');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('throws on non-2xx', async () => {
    const server = createServer((_, res) => { res.statusCode = 500; res.end('{"error":"boom"}'); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const client = new DaemonClient(`http://127.0.0.1:${port}`);
      await expect(client.openPreview({ root: '/r', page: 'src/X.tsx' })).rejects.toThrow(/500/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
```

- [ ] **Step 3: Run test (fails)**

```bash
cd packages/mcp-server && npx vitest run
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement daemonClient.ts**

`packages/mcp-server/src/daemonClient.ts`:
```ts
import {
  OpenPreviewRequest,
  OpenPreviewResponse,
  ClosePreviewRequest,
  StatusResponse,
} from '@visual-edit/protocol';

export class DaemonClient {
  constructor(private baseUrl: string) {}

  async openPreview(req: OpenPreviewRequest): Promise<OpenPreviewResponse> {
    return this.post('/preview', req, OpenPreviewResponse);
  }

  async closePreview(req: ClosePreviewRequest): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!resp.ok) throw new Error(`daemon ${resp.status}: ${await resp.text()}`);
  }

  async getStatus(): Promise<StatusResponse> {
    const resp = await fetch(`${this.baseUrl}/status`);
    if (!resp.ok) throw new Error(`daemon ${resp.status}: ${await resp.text()}`);
    return StatusResponse.parse(await resp.json());
  }

  private async post<TIn, TOut>(
    path: string,
    body: TIn,
    out: { parse(v: unknown): TOut },
  ): Promise<TOut> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`daemon ${resp.status}: ${await resp.text()}`);
    return out.parse(await resp.json());
  }
}
```

- [ ] **Step 5: Implement tools.ts**

`packages/mcp-server/src/tools.ts`:
```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DaemonClient } from './daemonClient.js';

export function registerTools(server: Server, daemonUrl: string): void {
  const client = new DaemonClient(daemonUrl);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'open_page',
        description: 'Open a TSX page in the visual editor preview. Returns a URL the user can visit.',
        inputSchema: {
          type: 'object',
          required: ['root', 'page'],
          properties: {
            root: { type: 'string', description: 'Absolute path to the project root' },
            page: { type: 'string', description: 'Page file path (e.g. src/pages/Home.tsx) or route' },
          },
        },
      },
      {
        name: 'close_preview',
        description: 'Close an active preview session by sessionId.',
        inputSchema: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string' } },
        },
      },
      {
        name: 'get_status',
        description: 'Return daemon status: version, uptime, active previews.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === 'open_page') {
      const result = await client.openPreview({ root: args.root as string, page: args.page as string });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    if (name === 'close_preview') {
      await client.closePreview({ sessionId: args.sessionId as string });
      return { content: [{ type: 'text', text: 'closed' }] };
    }
    if (name === 'get_status') {
      const status = await client.getStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status) }] };
    }
    throw new Error(`unknown tool: ${name}`);
  });
}
```

- [ ] **Step 6: Implement cli.ts (the stdio entrypoint)**

The CLI accepts `--root <path>` (or defaults to `cwd`). It reads `.visual-edit/daemon.lock` to discover the actual daemon port (which is dynamic, picked from `findFreePort(5170, 5179)`). If no lockfile or the recorded PID is dead, it returns a clear error rather than silently failing on `ECONNREFUSED`.

`packages/mcp-server/src/cli.ts`:
```ts
#!/usr/bin/env node
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readLock } from '@visual-edit/daemon';
import { registerTools } from './tools.js';

function parseRoot(argv: string[]): string {
  const i = argv.indexOf('--root');
  return i >= 0 ? resolve(argv[i + 1] ?? '.') : process.cwd();
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function discoverDaemonUrl(root: string): Promise<string> {
  // Allow override (e.g. for tests or remote daemons).
  const override = process.env.VE_DAEMON_URL;
  if (override) return override;

  const lock = await readLock(root);
  if (!lock) {
    throw new Error(
      `daemon not running for root '${root}'. Start it with:\n` +
      `  node packages/daemon/dist/cli.js start --root ${root}`,
    );
  }
  if (!isProcessAlive(lock.pid)) {
    throw new Error(
      `stale daemon lock found (pid ${lock.pid} not alive). Remove ${root}/.visual-edit/daemon.lock and restart.`,
    );
  }
  return `http://127.0.0.1:${lock.port}`;
}

async function main(): Promise<void> {
  const root = parseRoot(process.argv.slice(2));
  const daemonUrl = await discoverDaemonUrl(root);

  const server = new Server(
    { name: 'visual-edit-mcp-server', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  registerTools(server, daemonUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`mcp-server failed: ${(err as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 7: Update index.ts**

`packages/mcp-server/src/index.ts`:
```ts
export { DaemonClient } from './daemonClient.js';
export { registerTools } from './tools.js';
```

- [ ] **Step 8: Build + test**

```bash
cd packages/mcp-server && npm run build && npx vitest run
```

Expected: 2 tests pass.

- [ ] **Step 9: Commit + push**

```bash
git add packages/mcp-server/ package-lock.json
git commit -m "feat(mcp-server): stdio MCP with open_page/close_preview/get_status tools"
git push origin main
```

---

> **Note: an earlier draft had Task 17 = editor-ui (minimal iframe wrapper).** It was dropped during plan review:
> - 1.A acceptance is "user opens the synthetic Vite URL directly", so an empty iframe wrapper had no visible value yet
> - It would have introduced routing complexity (3 ports: daemon / editor-ui / synthetic-preview, WebSocket proxying)
> - The WebSocket contract is still pinned in `packages/daemon/src/ws.ts` (Task 15) so 1.B can consume it without daemon changes
>
> The remaining tasks 17-20 below were originally numbered 18-21.

---

### Task 17: apps/claude-plugin

**Files:**
- Create: `apps/claude-plugin/plugin.json`
- Create: `apps/claude-plugin/.mcp.json`
- Create: `apps/claude-plugin/commands/visual.md`
- Create: `apps/claude-plugin/skills/using-visual-edit/SKILL.md`
- Create: `apps/claude-plugin/README.md`

- [ ] **Step 1: plugin.json**

`apps/claude-plugin/plugin.json`:
```json
{
  "name": "visual-edit",
  "version": "0.0.0",
  "description": "Render React pages in isolation with mocked data — no boot, no auth, no backend.",
  "author": "Guilherme Ganim"
}
```

- [ ] **Step 2: .mcp.json**

`apps/claude-plugin/.mcp.json`:
```json
{
  "mcpServers": {
    "visual-edit": {
      "command": "node",
      "args": ["${VE_MCP_SERVER_PATH}", "--root", "${VE_PROJECT_ROOT}"],
      "env": {}
    }
  }
}
```

For 1.A local development, the user must set two env vars before launching Claude Code (e.g. in their shell profile or via a wrapper script):

```
export VE_MCP_SERVER_PATH=/abs/path/to/visual-edit-plugin/packages/mcp-server/dist/cli.js
export VE_PROJECT_ROOT=/abs/path/to/the/project/being/edited
```

(`${CLAUDE_PLUGIN_ROOT}/../../...` is unreliable because it depends on the plugin install layout. Using explicit env vars makes the dependency obvious. Phase 1.C will switch to `npx visual-edit-mcp-server` once we publish to npm.)

- [ ] **Step 3: /visual command**

`apps/claude-plugin/commands/visual.md`:
```markdown
---
description: Open a React page in the visual editor preview
argument-hint: "<page>"
---

You are about to open the page `$ARGUMENTS` in the visual editor.

Steps:
1. Resolve the absolute path of the current project root (use `pwd` if needed).
2. Call the MCP tool `open_page` with `{ root: <pwd>, page: "$ARGUMENTS" }`.
3. The tool returns `{ url, sessionId }`. Show the URL to the user — they should open it directly in their browser to see the rendered page. **In Phase 1.A there is no editor-ui yet — the URL points straight at the synthetic Vite preview.**
4. If the user asks to close, call `close_preview` with the same `sessionId`.

If the tool fails with "daemon not running", tell the user to run in a separate terminal:
```
node packages/daemon/dist/cli.js start --root .
```
Then retry. The MCP server discovers the daemon's actual port by reading `.visual-edit/daemon.lock` — no fixed port assumption.
```

- [ ] **Step 4: using-visual-edit skill**

`apps/claude-plugin/skills/using-visual-edit/SKILL.md`:
```markdown
---
name: using-visual-edit
description: When to suggest /visual to the user, and how to interpret its output. Use when the user is iterating on UI / page layout, has a Vite + React project, and wants to see a page render without running their full app.
---

## Triggers
Use this skill when the user mentions:
- "I want to see how this page looks"
- "Render this component without booting the whole app"
- "Test this page with mock data"
- "Visual editor", "preview", "iframe"

## Prerequisites
- The project is Vite + React (CRA support arrives in Phase 1.C).
- The project has `visual-edit.config.ts` at its root with a `wrapPage` function. If absent, suggest creating one — minimal example:

```ts
import type { VisualEditConfig } from '@visual-edit/shared';
const config: VisualEditConfig = {
  wrapPage: (children) => children,  // identity wrap to start
};
export default config;
```

## Workflow
1. Make sure the daemon is running (`node packages/daemon/dist/cli.js start --root .` in a separate terminal).
2. Call `/visual <relative-page-path>` (e.g. `/visual src/pages/Home.tsx`).
3. Open the returned URL in a browser.
4. The page renders in isolation, wrapped by `config.wrapPage`, with faker-derived mock data anywhere a Zod-discovered schema is fetched.

## Limitations (Phase 1.A)
- No editing yet — this is preview-only. Editing arrives in Phase 1.B.
- No editor-ui (iframe wrapper / overlay) — URL is the synthetic Vite preview directly. Editor-ui arrives in Phase 1.B.
- No CSS Modules / styled-components beyond what Vite handles natively.
- No real backend — all `fetch`/SDK calls fall through (no MSW yet); Zod schemas surface as faker-derived globals on `window.__VE_MOCKS`.
- Daemon must be started manually before MCP tool calls work.
```

- [ ] **Step 5: README**

`apps/claude-plugin/README.md`:
```markdown
# Visual Edit — Claude Code Plugin

Renders React pages in isolation with mocked data, no app boot required.

## Phase 1.A status: preview-only. No editing yet.

## Install (local development)

1. Build the workspace: `npm run build` from the repo root.
2. Add this plugin to a local marketplace, or symlink `apps/claude-plugin` into your `~/.claude/plugins/` directory.
3. Restart Claude Code.

## Use

In your Vite + React project:

1. Create `visual-edit.config.ts` at the project root (see `using-visual-edit` skill for template).
2. Start the daemon: `node packages/daemon/dist/cli.js start --root .`
3. In Claude Code, run `/visual src/pages/Home.tsx`.
4. Open the returned URL in your browser.
```

- [ ] **Step 6: Commit + push**

```bash
git add apps/
git commit -m "feat(claude-plugin): /visual command + using-visual-edit skill + .mcp.json"
git push origin main
```

---

### Task 18: examples/basic-vite seed project

**Files:**
- Create: `examples/basic-vite/package.json`
- Create: `examples/basic-vite/vite.config.ts`
- Create: `examples/basic-vite/tsconfig.json`
- Create: `examples/basic-vite/tailwind.config.ts`
- Create: `examples/basic-vite/postcss.config.js`
- Create: `examples/basic-vite/index.html`
- Create: `examples/basic-vite/visual-edit.config.ts`
- Create: `examples/basic-vite/src/main.tsx`
- Create: `examples/basic-vite/src/App.tsx`
- Create: `examples/basic-vite/src/index.css`
- Create: `examples/basic-vite/src/pages/Home.tsx`
- Create: `examples/basic-vite/src/lib/api.ts`
- Create: `examples/basic-vite/src/lib/queryClient.ts`
- Create: `examples/basic-vite/src/schemas/user.schema.ts`

- [ ] **Step 1: Project skeleton**

`examples/basic-vite/package.json`:
```json
{
  "name": "example-basic-vite",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@tanstack/react-query": "5.59.16",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "4.3.3",
    "autoprefixer": "10.4.20",
    "postcss": "8.4.47",
    "tailwindcss": "3.4.14",
    "typescript": "5.6.3",
    "vite": "5.4.10"
  }
}
```

`examples/basic-vite/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
});
```

`examples/basic-vite/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

`examples/basic-vite/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`examples/basic-vite/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`examples/basic-vite/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Example basic-vite</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Source files**

`examples/basic-vite/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`examples/basic-vite/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { queryClient } from './lib/queryClient.js';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
```

`examples/basic-vite/src/App.tsx`:
```tsx
import { Home } from './pages/Home.js';

export function App() {
  return <Home />;
}
```

`examples/basic-vite/src/lib/queryClient.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient();
```

`examples/basic-vite/src/lib/api.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { User } from '../schemas/user.schema.js';

declare global {
  interface Window { __VE_MOCKS?: { makeUser?: () => unknown } }
}

async function fetchUser(): Promise<User> {
  // In Visual Edit, __VE_MOCKS.makeUser() resolves; in a real build, fetch from API.
  const mock = (globalThis as unknown as Window).__VE_MOCKS?.makeUser;
  if (mock) return User.parse(mock());
  const resp = await fetch('/api/user');
  return User.parse(await resp.json());
}

export function useUser() {
  return useQuery({ queryKey: ['user'], queryFn: fetchUser });
}
```

`examples/basic-vite/src/pages/Home.tsx`:
```tsx
import { useUser } from '../lib/api.js';

export default function Home() {
  const { data, isLoading, isError } = useUser();
  if (isLoading) return <div className="p-8">Loading...</div>;
  if (isError || !data) return <div className="p-8 text-red-600">Error loading user</div>;
  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Hello {data.name}</h1>
      <p className="text-gray-600">{data.email}</p>
      <p className="text-sm text-gray-400 mt-4">User ID: {data.id}</p>
    </main>
  );
}
```

`examples/basic-vite/src/schemas/user.schema.ts`:
```ts
import { z } from 'zod';
export const User = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().min(0).optional(),
  createdAt: z.string().datetime().optional(),
});
export type User = z.infer<typeof User>;
```

`examples/basic-vite/visual-edit.config.ts`:
```ts
import type { VisualEditConfig } from '@visual-edit/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const config: VisualEditConfig = {
  wrapPage: (children) =>
    createElement(QueryClientProvider, { client: queryClient }, children as never),
};
export default config;
```

- [ ] **Step 3: Install + smoke**

```bash
cd examples/basic-vite && npm install && npx vite build
```

Expected: vite build succeeds, produces `dist/`.

- [ ] **Step 4: Commit + push**

```bash
git add examples/ package-lock.json
git commit -m "feat(examples): basic-vite seed project for e2e validation"
git push origin main
```

---

### Task 19: End-to-end smoke + acceptance gate

**Files:**
- Create: `tests/e2e/render-isolated-page.test.ts` (root-level e2e)
- Create: `tests/e2e/package.json` (workspace member)
- Create: `tests/e2e/vitest.config.ts`

- [ ] **Step 1: e2e workspace**

Add `tests/e2e/*` to root `package.json`'s workspaces:
```json
"workspaces": ["packages/*", "packages/adapters/*", "apps/*", "examples/*", "tests/e2e"]
```

`tests/e2e/package.json`:
```json
{
  "name": "@visual-edit/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "pretest": "playwright install --with-deps chromium",
    "test": "vitest run --config vitest.config.ts"
  },
  "devDependencies": {
    "vitest": "2.1.4",
    "playwright": "1.48.2"
  },
  "dependencies": {
    "@visual-edit/daemon": "*"
  }
}
```

(`pretest` runs `playwright install` automatically, ensuring Chromium is downloaded before the test executes. CI must have network access for this to succeed on a fresh runner.)

`tests/e2e/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 60_000,
    include: ['*.test.ts'],
  },
});
```

Run `npm install` from root; then `cd tests/e2e && npx playwright install chromium`.

- [ ] **Step 2: Write the e2e test**

`tests/e2e/render-isolated-page.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Daemon } from '@visual-edit/daemon';
import { chromium, type Browser } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../examples/basic-vite');

let daemon: Daemon;
let daemonUrl: string;
let browser: Browser;

beforeAll(async () => {
  // No explicit port — let findFreePort pick one in 5170-5179. The test reads
  // back the actual port via daemon.getPort() to avoid colliding with running services.
  daemon = new Daemon({ root: ROOT });
  await daemon.start();
  const port = daemon.getPort();
  if (!port) throw new Error('daemon did not bind a port');
  daemonUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await daemon?.stop();
}, 30_000);

describe('Phase 1.A acceptance: render isolated page', () => {
  it('opens Home.tsx, renders with config.wrapPage + faker-derived mocks', async () => {
    const resp = await fetch(`${daemonUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: ROOT, page: 'src/pages/Home.tsx' }),
    });
    expect(resp.ok).toBe(true);
    const { url, sessionId } = await resp.json();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:51\d\d/);
    expect(sessionId).toMatch(/^[0-9a-f]{8}$/);

    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

    // Confirm the mock pipeline delivered bindings to the page (proves discoverSchemas →
    // buildFakerBindings → entry → globalThis chain works end-to-end, not just visually).
    const mockType = await page.evaluate(() => typeof (window as { __VE_MOCKS?: { makeUser?: unknown } }).__VE_MOCKS?.makeUser);
    expect(mockType).toBe('function');

    // The page should render the H1 with "Hello <name>"
    await page.waitForSelector('h1', { timeout: 10_000 });
    const h1 = await page.textContent('h1');
    expect(h1).toMatch(/^Hello /);

    // Email element exists
    const emailText = await page.textContent('p');
    expect(emailText).toMatch(/@/);

    // Tailwind class actually applied (non-default padding) — sanity check that index.css imported.
    const mainPadding = await page.evaluate(() => getComputedStyle(document.querySelector('main')!).padding);
    expect(mainPadding).not.toBe('0px');

    // Console must be clean (no errors)
    expect(consoleErrors).toEqual([]);

    // Cleanup: close preview
    const closeResp = await fetch(`${daemonUrl}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(closeResp.status).toBe(204);
    await page.close();
  });

  it('rejects unknown route with VE_PROJECT_002', async () => {
    const resp = await fetch(`${daemonUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: ROOT, page: 'src/pages/Nonexistent.tsx' }),
    });
    expect(resp.ok).toBe(false);
    const body = await resp.json();
    expect(body.error).toMatch(/VE_PROJECT_002|not found/);
  });
});
```

**Prerequisite reminder:** before running this test, ensure `npm install` ran at the repo root (so workspace deps + `examples/basic-vite/node_modules/@tanstack/react-query` are hoisted/installed). The `pretest` script handles Playwright; root install is the developer's responsibility.

- [ ] **Step 3: Run the e2e test**

```bash
npm run build
cd tests/e2e && npm test
```

Expected: 2 tests pass within 2 minutes. If failures, the test output identifies which step (daemon start, openPreview, page load, content selector) failed.

If `Hello <name>` doesn't render, likely causes:
- `__VE_MOCKS.makeUser` not defined → check entry.tsx generation in adapter
- `wrapPage` not invoked → check entry.tsx
- Faker bindings not generating `makeUser` → check `discoverSchemas` picked up `user.schema.ts`
- Vite dev server not starting → check the `Local:` line detection in `startVite`

- [ ] **Step 4: Commit + push**

```bash
git add tests/ package-lock.json
git commit -m "test(e2e): phase 1.a acceptance — render Home.tsx with faker user mock"
git push origin main
```

---

### Task 20: Mark Phase 1.A complete

**Files:**
- Modify: `docs/superpowers/specs/2026-05-09-visual-edit-plugin-design.md` (last section)
- Create: `docs/superpowers/specs/2026-05-09-phase-1a-results.md`

- [ ] **Step 1: Write Phase 1.A results**

`docs/superpowers/specs/2026-05-09-phase-1a-results.md`:
```markdown
# Phase 1.A Results

**Date:** 2026-05-09 (or actual completion date)
**Outcome:** SUCCESS / NEEDS-WORK

## Acceptance gate

E2E test `tests/e2e/render-isolated-page.test.ts` passes:
1. Daemon starts on port 5170 against `examples/basic-vite/`
2. POST /preview with `{root, page: 'src/pages/Home.tsx'}` returns `{url, sessionId}`
3. Browser loads URL → `<h1>Hello <name></h1>` renders with faker-derived data
4. Console: zero errors
5. POST /close with sessionId returns 204
6. Unknown route returns VE_PROJECT_002 error

## Packages delivered

| Package | Tests | Lines |
|---|---|---|
| @visual-edit/shared | N | N |
| @visual-edit/protocol | N | N |
| ... | ... | ... |

(Fill in after implementation.)

## Bugs found and fixed during 1.A

(Fill in.)

## Out of scope (deferred to 1.B / 1.C)

- code-mods (Phase 0 spike code stays in `spike/` — port to `packages/code-mods/` in 1.B)
- editor-ui overlay, color picker, padding handles
- Commit pipeline (instrument → planEdits → apply with Windows-safe write)
- Ask-AI queue + WAL
- Asset-proxy beyond placeholder fallback
- Multi-session daemon discovery + lock takeover
- CRA adapter
- findApiContracts + buildMSWHandlers
- Logger redaction policy

## Next: Phase 1.B
Plan: `docs/superpowers/plans/<date>-phase-1b-edit-and-commit.md` (to be written)
```

- [ ] **Step 2: Update design spec approval section**

Append to `docs/superpowers/specs/2026-05-09-visual-edit-plugin-design.md` (after the existing checked items):
```markdown
- [x] Phase 1.A plan written: docs/superpowers/plans/2026-05-09-phase-1a-render-isolated-page.md
- [x] Phase 1.A delivered: docs/superpowers/specs/2026-05-09-phase-1a-results.md
```

- [ ] **Step 3: Commit + push**

```bash
git add docs/
git commit -m "docs: mark phase 1.a complete + results writeup"
git push origin main
```

---

## Self-Review Checklist (controller runs before handing off)

- [ ] Every step has complete code (no "implement the X" without showing how)
- [ ] All file paths are exact and consistent across tasks (e.g. `packages/adapters/vite/` not `packages/vite-adapter/`)
- [ ] Type names match across tasks: `ProjectInfo`, `PageEntry`, `VisualEditConfig`, `MockSchema`, `AdapterInput`, `AdapterHandle`, `OpenPreviewRequest`, `PROTOCOL_VERSION`, `Daemon`, `PreviewSupervisor`, `DaemonClient`, `extractLocalUrl`, `BuildEntryWrapperInput.userCssImportPath`, `Daemon.getPort()`
- [ ] Each task ends with a commit + push
- [ ] No "TBD", "TODO", "fill in" placeholders (Task 20 has FILL IN markers but those are runtime data — not plan placeholders)
- [ ] Spec coverage:
  - §2.1 shared types → Task 2
  - §2.2 protocol Zod schemas → Task 3
  - §2.3 diagnostics → Task 4
  - §2.4 project-analyzer → Tasks 5-8 (analyze, loadConfig, findRoutes, discoverSchemas — sandbox in loadConfig is best-effort, see header constraints)
  - §2.5 mock-runtime → Tasks 9-10 (entryWrapper, fakerBindings — buildMSWHandlers deferred to 1.C)
  - §2.6 code-mods → DEFERRED to Phase 1.B
  - §2.7 asset-proxy → DEFERRED; basic publicDir wiring done in Task 11
  - §2.8 adapters/vite → Tasks 11-12 (generate with relative imports + ephemeralDir literal + CSS detection + publicDir + fs.allow; spawn with extractLocalUrl helper)
  - §2.9 preview-worker → Task 13
  - §2.10 daemon → Tasks 14-15 (lockFile, portFinder, supervisor with reject-on-exit, http, ws skeleton, daemon class with getPort + closeAllConnections, cli)
  - §2.11 editor-ui → DROPPED from 1.A (see "Sequencing" note); deferred to Phase 1.B
  - §2.12 mcp-server → Task 16 (open_page, close_preview, get_status; reads daemon port from lockfile)
  - §2.13 apps/claude-plugin → Task 17 (.mcp.json uses VE_MCP_SERVER_PATH + VE_PROJECT_ROOT env vars)
  - §3.1 open page flow → exercised by Tasks 15 (daemon orchestration) + 19 (e2e)
  - §6.2 Phase 1 acceptance ("100 random edits pass invariants") → DEFERRED to Phase 1.B (1.A doesn't edit)
- [ ] Phase 1.A acceptance gate (Task 19) is explicit and measurable
- [ ] Documented constraints in header acknowledge: jiti-sandbox limitation, manual daemon startup, npm install prerequisite, playwright install prerequisite, no HMR validation

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-phase-1a-render-isolated-page.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, two-stage review between tasks. Best for this plan because the 21 tasks are mostly independent (each builds one package or wires one integration), and the bug-discovery pattern from Phase 0 (subagent identifies issue → fix dispatched separately) worked well.

**2. Inline Execution** — Execute in this session via `superpowers:executing-plans`, batched with checkpoints. Faster overall but you lose the per-task two-stage review safety.

Which approach?
