# Visual Edit Plugin — Design Document

**Date**: 2026-05-09
**Status**: Draft (pending user review)
**Author**: Guilherme + Claude (brainstorming session)
**Reviewers**: Codex (3 review rounds, all incorporated)

---

## Overview

A visual-first editing layer for React web apps. The user points at a page; the tool renders that page **in isolation** (no real backend, no auth, no app boot), populates it with **mocked data per field type**, and presents a Figma-like overlay for tweaking style and layout. Edits flow back to the source code via surgical text patches. An optional **AI-in-the-loop** lets the user select an element, type a natural-language request, and have the connected AI session (Claude Code, Cursor, etc.) apply the edit through its normal diff-approval flow.

**Goal**: skip the boot/login/data-loading dance to focus purely on UI iteration.

**Distribution**: monorepo with a pure core, multiple framework adapters, an HTTP+WS daemon, an MCP server (universal API), and a thin Claude Code plugin (user-facing). Other AIs (Codex, Gemini) plug in via the same MCP later.

**MVP scope (by v1.0 / Phase 4)**: Vite + CRA, React 18+, client-side pages only, style + layout edits (no add/remove/duplicate). Next.js, Vue, Svelte, Server Components are post-MVP.

Note on phasing: Phase 1 ships **Vite only**; CRA adapter arrives in Phase 3c. See Section 6 for the full schedule.

---

## Section 1 — Architecture

### Topology

```
┌──────────────────────────────────────────────────────────────────┐
│ Repo: visual-edit (monorepo, Node 22+ default, Bun optional)     │
├──────────────────────────────────────────────────────────────────┤
│  packages/shared           — pure types, errors, schemas         │
│  packages/protocol         — Zod schemas for wire formats        │
│  packages/diagnostics      — error envelopes, logger, redaction  │
│  packages/project-analyzer — framework/config/route/schema discovery │
│  packages/mock-runtime     — MSW handlers, Faker bindings, entry wrapper │
│  packages/code-mods        — text-patch via TS Compiler positions │
│  packages/asset-proxy      — fonts, public/, remote images       │
│  packages/adapters/                                              │
│    ├── vite                — synthetic entry for Vite/CRA        │
│    └── (next-pages)        — Phase 2                             │
│  packages/preview-worker   — disposable child process per preview │
│  packages/daemon           — orchestrator with internal fault isolation │
│  packages/editor-ui        — Figma-mode browser frontend          │
│  packages/mcp-server       — stdio MCP server (tools-only)       │
│  apps/claude-plugin        — slash command + skill + .mcp.json   │
└──────────────────────────────────────────────────────────────────┘
```

**13 packages, no cycles.** Daemon is the orchestrator (only piece that knows other packages). Internal fault isolation via supervised workers.

### Principles

- **Tight package scopes**: each package has a single purpose and minimal surface area.
- **Daemon is one process** but with explicit fault-isolation boundaries: FileWatcher, EditPipeline, PreviewSupervisor, QueueManager are isolated workers with try/catch boundaries.
- **No AST round-trip for edits**: text patches via TS Compiler-derived byte ranges. User formatting preserved by construction.
- **No provider auto-detection**: user supplies `visual-edit.config.ts` with `wrapPage`. We never guess.
- **No real dev server boot**: synthetic entry + MSW + Faker + user's wrapPage. App-level isolation, page-level rendering.
- **MCP tools-only** (no sampling): AI-in-loop via queue + drain pattern with the host agent applying edits in its normal flow.

### External reuse

| Dep | Status | Notes |
|---|---|---|
| `@onlook/parser` | Optional, behind feature flag | Designed for container runtime, not isolated render. Our default uses TS Compiler API directly. |
| `msw` | Yes (fetch/XHR only) | Documented as not covering SDK direct calls. |
| `@faker-js/faker` | Yes, Node 22+ | ESM-only, runtime fixed. |
| `ts-morph` | Yes, lazy | Loads project on-demand, cache in-memory. |
| `zod` | Yes | Primary path for schema discovery. |
| `chokidar` | Yes | With hash-based reconciliation, not just events. |
| Bun as monorepo runtime | Optional | Default Node 22+. |

### Distribution

- **npm**: `@guilherme/visual-edit-{shared, protocol, diagnostics, project-analyzer, mock-runtime, code-mods, asset-proxy, daemon, preview-worker, editor-ui, mcp-server}` and `adapters/vite`
- **Claude Code plugin**: separate repo or submodule, installed via local marketplace
- **Future plugins** (Codex, Gemini): thin shells over the same MCP server

---

## Section 2 — Components & Interfaces

### 2.1 `packages/shared`

Pure types, no fs/path/process imports, all JSON-serializable.

```ts
type ProjectRoot = string;
type ElementId = string;             // data-vid="x7k..."
type RouteSpec = string;             // "/dashboard" | "src/pages/X.tsx"

interface ProjectInfo {
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

interface VisualEditConfig {
  wrapPage: (children: ReactNode) => ReactNode;
  api?: ApiEndpoint[];
  routes?: string;                   // glob override
  mocks?: Record<string, unknown>;   // per-route overrides
  safeEnvPrefixes?: string[];        // default ['VITE_', 'PUBLIC_', 'NEXT_PUBLIC_']
}

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string | RegExp;
  schemaName: string;
  status?: number;
}

interface PageEntry {
  route: RouteSpec;
  filePath: string;
  isClientOnly: boolean;
  cssImports: string[];
}

interface MockSchema {
  name: string;
  source: 'zod' | 'ts-type' | 'heuristic';
  shape: JSONSchema7;
  endpoint?: ApiEndpoint;
}

type Edit = StyleEdit | LayoutEdit;

interface StyleEdit {
  kind: 'style';
  element: ElementId;
  target: StyleTarget;
  props: Partial<StyleProps>;
}

type StyleTarget =
  | { type: 'tailwind-class' }
  | { type: 'inline-style' }
  | { type: 'css-module'; binding: string }
  | { type: 'styled-prop'; propName: string };

interface LayoutEdit {
  kind: 'layout';
  element: ElementId;
  target: StyleTarget;
  transform: LayoutTransform;
}

interface StyleProps {
  color?: string; backgroundColor?: string; borderColor?: string;
  borderRadius?: string; borderWidth?: string;
  paddingTop?: string; paddingRight?: string;
  paddingBottom?: string; paddingLeft?: string;
  marginTop?: string; marginRight?: string;
  marginBottom?: string; marginLeft?: string;
  fontFamily?: string; fontSize?: string; fontWeight?: number;
  boxShadow?: string;
}

interface LayoutTransform {
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  flexGap?: string;
  alignItems?: string;
  justifyContent?: string;
}

interface AskAIRequest {
  id: string;
  createdAt: string;
  element: ElementId;
  filePath: string;
  prompt: string;
  context: { surroundingCode: string; computedStyles: Record<string, string> };
}

type AskAIState = 'pending' | 'leased' | 'resolved';
type AskAIOutcome = 'committed' | 'rejected' | 'failed' | 'no-op';

interface PreviewSession {
  id: string;
  url: string;
  pageRef: PageEntry;
  startedAt: string;
  status: 'starting' | 'ready' | 'crashed' | 'closed';
}

interface DaemonStatus {
  daemonVersion: string;
  uptime: number;
  activePreviews: number;
  queueDepth: { pending: number; leased: number };
  walSize: number;
  workerHealth: Record<string, 'ok' | 'degraded' | 'down'>;
}
```

### 2.2 `packages/protocol`

Zod schemas for all wire formats: WebSocket (editor↔daemon), MCP tool I/O, daemon↔preview-worker IPC, WAL entries. Single source of truth for serialization. Versioned via `PROTOCOL_VERSION = '1.0'`.

WAL entry envelope:
```ts
interface WalEntry {
  seq: number;             // monotonic, gap-free
  version: '1';
  sha256: string;          // entry hash, detect corruption
  timestamp: string;
  op: WalOp;               // enqueue | lease | resolve | lease-expired
}
```

### 2.3 `packages/diagnostics`

Structured errors and logger.

```ts
interface ErrorEnvelope {
  code: string;                                   // VE_PROJECT_001 etc
  message: string;
  severity: 'info' | 'warn' | 'error' | 'fatal';
  recovery: 'none' | 'automatic-retry' | 'user-action' | 'unrecoverable';
  blame: 'user-config' | 'user-code' | 'tool' | 'environment' | 'unknown';
  hint?: string;
  context?: Record<string, unknown>;              // safeToLog fields only
  cause?: ErrorEnvelope;
  traceId: string;
}

class VisualEditError extends Error {
  envelope: ErrorEnvelope;
}
```

**Logger policy (allowlist, not denylist)**: only fields explicitly marked `safeToLog: true` get persisted. Free-form strings (error messages, surroundingCode) replaced by `<HASH:length:summary>` placeholders. Raw content goes to `.visual-edit/raw-logs/` (gitignored, never in `diagnose` zip, opt-in flag only).

### 2.4 `packages/project-analyzer`

```ts
interface ProjectAnalyzer {
  analyze(root: ProjectRoot): Promise<ProjectInfo>;
  loadConfig(root: ProjectRoot): Promise<VisualEditConfig | null>;
  findRoutes(info: ProjectInfo): Promise<PageEntry[]>;
  discoverSchemas(filePath: string): Promise<MockSchema[]>;
  findApiContracts(root: ProjectRoot): Promise<ApiEndpoint[]>;
  resolveAlias(alias: string, info: ProjectInfo): string | null;
}
```

- `loadConfig` uses `jiti` to load TS without build. Validates with Zod. **Sandboxes execution**: `process.env` access outside `safeEnvPrefixes` triggers refusal with `VE_CONFIG_001`.
- `findApiContracts` reads convention `*.api.ts` exporting `{ method, url, schemaName }` OR `config.api[]`. Schemas without an endpoint don't generate MSW handlers (fail visibly over guess).
- Cache by root, invalidated by daemon's FileWatcher.

### 2.5 `packages/mock-runtime`

```ts
interface MockRuntime {
  buildMSWHandlers(opts: BuildMSWOpts): MSWHandlerCode;
  buildFakerBindings(schemas: MockSchema[]): FakerBindingCode;
  buildEntryWrapper(config: VisualEditConfig): WrapperCode;
}

interface BuildMSWOpts {
  schemas: MockSchema[];
  endpoints: ApiEndpoint[];
  overrides: Record<string, unknown>;
}
```

- `buildEntryWrapper` emits code that calls `config.wrapPage(<Page />)`. **Zero auto-detection of providers.**
- `buildMSWHandlers` requires explicit endpoint mapping; no endpoint = no handler.
- `buildFakerBindings` maps field-name → faker call (heuristic + lookup table for common names).

### 2.6 `packages/code-mods`

**Pivot**: text-patch via TS Compiler positions. No AST round-trip.

```ts
interface CodeMod {
  instrument(filePath: string): Promise<{ instrumented: string; sourceMap: ElementSourceMap }>;
  planEdits(filePath: string, edits: Edit[]): Promise<EditPlan>;
  apply(plan: EditPlan): Promise<DryRunResult>;
  commit(dryRun: DryRunResult): Promise<CommitResult>;
  rollback(commitId: string): Promise<void>;
}

interface ElementSourceMap {
  [elementId: ElementId]: {
    nodeRange: { start: number; end: number };
    classNameAttr?: { start: number; end: number };
    styleAttr?: { start: number; end: number };
    parentTag: string;
  };
}

interface EditPlan {
  filePath: string;
  patches: TextPatch[];
}

interface TextPatch {
  start: number;
  end: number;
  replacement: string;
  reason: string;
}

interface DryRunResult {
  filePath: string;
  beforeHash: string;       // sha256
  afterHash: string;
  patches: TextPatch[];
  // before/after content NOT in payload — editor reconstructs from local state
}

interface CommitResult {
  commitId: string;
  filePath: string;
  sha256Before: string;
  sha256After: string;
  txnId: string;
  status: 'committed' | 'commit-uncertain';
  retries: number;
}
```

Implementations:
- `OurCodeMod` (default): TS Compiler API for position discovery + buffer-level patches. Never re-prints a file. Strategy per `Edit.target.type`:
  - `tailwind-class`: edit literal in `className="..."` preserving quotes/whitespace
  - `inline-style`: inject/edit `style={{...}}` properties
  - `css-module`: patch the corresponding `.module.css` binding
  - `styled-prop`: edit JSX literal
- `OnlookCodeMod` (feature flag, experimental): wrapper over `@onlook/parser`.

`commit` flow: see Section 3.2. Sole writer to user files. Always backup, validate, retry+verify on Windows.

### 2.7 `packages/asset-proxy`

```ts
interface AssetProxy {
  attach(devServer: ViteDevServer, opts: AssetProxyOpts): void;
}

interface AssetProxyOpts {
  publicDir: string | null;
  remoteImageStrategy: 'pass-through' | 'placeholder' | 'cached';
  fontFallback: 'system' | 'user-config';
}
```

Mounts middleware at `/__assets/*`. Local images resolved from `publicDir`. Remote images per strategy. Fonts proxied or fallback to system. Without this, the isolated preview looks broken.

### 2.8 `packages/adapters/vite`

```ts
interface Adapter {
  name: 'vite' | 'cra' | 'next-pages';
  detect(info: ProjectInfo): boolean;
  start(input: AdapterInput): Promise<AdapterHandle>;
}

interface AdapterInput {
  info: ProjectInfo;
  page: PageEntry;
  mockArtifacts: { msw: MSWHandlerCode; entryWrapper: WrapperCode; faker: FakerBindingCode };
  port: number;
  env: Record<string, string>;          // filtered by safeEnvPrefixes
  externalize: string[];
}

interface AdapterHandle {
  url: string;
  stop(): Promise<void>;
  hmr: EventEmitter;
}
```

Vite adapter creates ephemeral `.visual-edit/preview-<hash>/` directory, generates `entry.tsx` (page import + `wrapPage` + MSW init + Faker bindings + asset-proxy mount), generates `vite.config.ts` extending user's config (aliases, plugins, PostCSS, Tailwind preserved), spawns `vite dev`. Cleans dir on `stop()`.

### 2.9 `packages/preview-worker`

Disposable child process. Reads `AdapterInput` from IPC channel (NOT stdout — stdout reserved for Vite/user logs). Imports adapter, calls `start()`, reports ready/error/log via Node IPC (`process.send`). SIGTERM triggers `stop`. Never writes to user files.

### 2.10 `packages/daemon`

```ts
interface Daemon {
  start(root: ProjectRoot, opts?: DaemonOptions): Promise<void>;
  stop(): Promise<void>;

  openPreview(page: RouteSpec): Promise<PreviewSession>;
  closePreview(id: string): Promise<void>;

  planEdits(previewId: string, edits: Edit[]): Promise<DryRunResult>;
  commitEdits(previewId: string, planId: string): Promise<CommitResult>;
  rollback(commitId: string): Promise<void>;

  enqueueAskAI(req: Omit<AskAIRequest, 'id' | 'createdAt'>): Promise<AskAIRequest>;
  drainAskAI(): Promise<{ items: AskAIRequest[]; leases: Record<string, string> }>;
  resolveAskAI(opts: { askId: string; leaseId: string; outcome: AskAIOutcome; summary: string; commitId?: string }): Promise<void>;

  getStatus(): Promise<DaemonStatus>;
  on(event: 'file-changed' | 'preview-crashed' | 'queue-changed', listener: ...): void;
}
```

**Internal fault isolation**: each subsystem (FileWatcher, EditPipeline, PreviewSupervisor, QueueManager, SessionLayer) is a worker with try/catch boundary. Crash in one doesn't degrade others. Health-check exposed via `getStatus()`.

**Queue**: in-memory + WAL (`.visual-edit/queue.wal`) for recovery. State machine `pending → leased → resolved` with explicit outcome. WAL entries versioned + sha256-checksummed + monotonic seq.

**Discovery**: lock file `.visual-edit/daemon.lock` with `{ pid, port, startedAt, heartbeat, stateHash, version }`. Second session detects existing daemon and connects via HTTP. Stale lock (heartbeat >30s or PID dead) → takeover, replay WAL.

**Ownership**: daemon owns `.visual-edit/`. TTL on `preview-<hash>/` (24h). Backup retention: last 50 OR 7 days, whichever lower. Snapshot WAL on clean shutdown if >10k entries OR >5MB.

**Recent-writes set**: hash-based, populated on every commit. FileWatcher uses to dedup self-writes.

### 2.11 `packages/editor-ui`

React + Tailwind + Zustand + react-rnd + react-color.

```
editor-ui/
  src/
    canvas/        — iframe + overlay with data-vid hooks
    panels/
      properties/  — right panel: style + layout for selected element
      tokens/      — design tokens (project colors/spacing)
      ai-prompt/   — bottom panel: textarea + "Ask AI" button
    handles/       — RND wrappers
    ws-client.ts   — daemon connection (with version handshake)
    state.ts       — Zustand store
```

WS protocol via `packages/protocol` Zod schemas. Validates every incoming message. Version mismatch → refuses to connect, shows upgrade hint.

### 2.12 `packages/mcp-server`

Stdio MCP server, tools-only (no sampling).

| Tool | Input | Output |
|---|---|---|
| `open_page` | `{ root, page }` | `{ url, sessionId }` |
| `list_routes` | `{ root }` | `{ routes: PageEntry[] }` |
| `close_preview` | `{ sessionId }` | `void` |
| `drain_ask_ai` | `{ root }` | `{ items, leases }` |
| `resolve_ask_ai` | `{ askId, leaseId, outcome, summary, commitId? }` | `void` |
| `rollback` | `{ commitId }` | `void` |
| `get_status` | `{ root }` | `DaemonStatus` |

Each tool is a thin wrapper over HTTP to the daemon. Auto-spawns daemon if not running.

### 2.13 `apps/claude-plugin`

```
commands/
  visual.md           — /visual <page>
  visual-drain.md     — /visual drain
skills/
  using-visual-edit/  — when to suggest /visual; how to consume queue
.mcp.json             — registers visual-edit-mcp-server (stdio, npx)
plugin.json           — manifest
```

Pure declarative shell. All logic lives in npm packages.

### Dependency graph

```
shared ←─── all
protocol ──→ shared
diagnostics ──→ shared
project-analyzer ──→ shared, diagnostics
mock-runtime ──→ shared, diagnostics
code-mods ──→ shared, diagnostics
asset-proxy ──→ shared, diagnostics
adapters/vite ──→ shared, project-analyzer (peerDep), asset-proxy
preview-worker ──→ shared, protocol, adapters/*
daemon ──→ shared, protocol, diagnostics, project-analyzer, code-mods,
           adapters/*, preview-worker, asset-proxy
editor-ui ──→ shared, protocol (types only via tsc)
mcp-server ──→ shared, protocol
apps/claude-plugin ──→ mcp-server (via npx)
```

No cycles. Daemon is the orchestrator with internal fault isolation.

---

## Section 3 — Data Flows

### 3.1 Open page

Trigger: `/visual <page>` in Claude Code (or any MCP client).

1. `mcp-server.open_page({ root, page })` → HTTP POST to daemon `/preview`
2. Daemon ensures `project-analyzer` cache:
   - `analyze(root)` reads package.json, tsconfig, vite.config, tailwind, .env files (filtered by `safeEnvPrefixes`)
   - `loadConfig(root)` — **fails with `VE_CONFIG_001`** if `visual-edit.config.ts` missing or contains unsafe `process.env` access
   - `findRoutes()` matches the page argument; not found → suggests available routes
3. `discoverSchemas(filePath)` + `findApiContracts(root)`
4. `mock-runtime.buildMSWHandlers/buildFakerBindings/buildEntryWrapper`
5. `adapters/vite.detect()` → fork preview-worker via Node IPC, send `AdapterInput`, await `ready { url }`
6. `code-mods.instrument(filePath)`: backup, inject `data-vid`, retain sourceMap in memory (one time per file)
7. Register `PreviewSession { id, url, ws }`. Return `{ url, sessionId }` via mcp-server.
8. User opens URL. Editor-ui WebSocket handshake: `{ kind: 'hello', version: '1.0', sessionId }`. Daemon replies with snapshot (info, mockArtifacts, sourceMap). iframe loads.

**Failures**: missing config (`VE_CONFIG_001`), route not found (`VE_PROJECT_002`, lists alternatives), worker startup crash (30s timeout, returns stderr tail), port range 5180–5200 search exhausted, daemon cold start ~1s.

### 3.2 Edit (style/layout)

1. User drags handle / picks color in editor-ui canvas. Optimistic local preview, debounce 150ms.
2. WS send `{ kind: 'edit', requestId, edits }`.
3. Daemon SessionLayer → EditPipeline worker:
   - Validate via protocol Zod
   - `code-mods.planEdits(filePath, edits)` → `EditPlan` (strategy per `target.type`)
   - `code-mods.apply(plan)` → buffer-level patches, computes `beforeHash`/`afterHash`
4. WS send `{ kind: 'dry-run', requestId, result: { patches, beforeHash, afterHash, planId } }`. **Content not sent** — editor reconstructs.
5. User Ctrl+S → WS send `{ kind: 'commit', planId }`.
6. Commit pipeline:
   - Read disk file, compute current sha256
   - Validate `current == beforeHash` (else `StaleDryRunError`)
   - Apply patches in buffer → `after`
   - Validate TS parse on `after`
   - Backup current file with fsync to `.visual-edit/backups/<file>-<commitId>`
   - Atomic write loop (Windows-safe):
     ```
     for try in [1, 2, 3]:
       try:
         write temp file + fsync
         rename(temp, target)
         re-read target + sha256
         if sha == afterHash → success
         else throw 'verify-mismatch'
       except EPERM/EBUSY:
         backoff(100ms * try^2)
     if all 3 failed:
       send { kind: 'commit-uncertain', requestId, lastError }
       editor forces reload + re-fetch
     ```
   - Register in commit log: `{ commitId, filePath, sha256Before, sha256After, txnId }`
   - Add `afterHash` to recent-writes set
7. WS send `{ kind: 'commit-ok', commitId, requestId }`.

**Failures**:
- `data-vid` mismatch → editor enters **stale state**, blocks visual edits, banner: "Arquivo foi modificado por fora. Clique pra re-mapear elementos." **Re-instrument only on explicit click.** Never silent.
- `StaleDryRunError` → editor regenerates plan
- TS parse fails on `after` → don't write, return error with traceId (this is our bug)
- `verify-mismatch` → escalates to `commit-uncertain`
- `commit-uncertain` → editor reloads, compares with `afterHash`. If match: commit succeeded silently. If not: shows "estado incerto" + opens file in user's IDE.

**Rollback**: `rollback(commitId)` — validates current `sha256` matches `sha256After` of that commit (else refuses as ambiguous), restores backup, adds inverse commit to log.

### 3.3 Ask-AI

1. User selects element, types prompt in ai-prompt panel.
2. WS send `{ kind: 'ask-ai', requestId, req }`.
3. Daemon QueueManager:
   - Create `AskAIItem { askId, state: 'pending', seq }`
   - WAL append `{ op: 'enqueue', item, seq, sha256 }`, fsync
   - Add to in-memory queue
4. WS send `{ kind: 'ask-ai-queued', requestId, askId }`. Editor shows "esperando IA".
5. User runs `/visual drain` in Claude Code session (or `using-visual-edit` skill auto-suggests).
6. `mcp-server.drain_ask_ai({ root })`:
   - Daemon transitions all `pending` items to `leased` with `leaseId` + `leaseExpiresAt` (15min)
   - WAL append `{ op: 'lease', askId, leaseId, expiresAt, seq }`
   - Returns items with leases
7. Claude processes each via normal Edit flow (user sees diff, approves/rejects).
8. Per item, calls `mcp-server.resolve_ask_ai({ askId, leaseId, outcome, summary, commitId? })` where `outcome ∈ {committed, rejected, failed, no-op}`.
9. Daemon validates `leaseId`, transitions `leased → resolved`, WAL append `{ op: 'resolve', askId, outcome, summary, commitId, seq }`, fsync.
10. WS send `{ kind: 'ask-ai-resolved', askId, outcome, summary, commitId }`. Editor shows status:
    - committed → animation "atualizado por IA"
    - rejected → "você rejeitou o diff" (gray)
    - failed → "IA falhou: <summary>" (red)
    - no-op → "IA respondeu sem mudança"

**Lease expiry**: items in `leased` whose `leaseExpiresAt` passed → auto-revert to `pending`. WAL `{ op: 'lease-expired' }`.

**WAL replay** (idempotent by construction):
1. Read WAL ordered by seq
2. Verify `version == '1'` (else refuse, instruct reset)
3. Verify each entry's sha256 (corruption → stop at last valid seq, log warning)
4. Apply ops in order: enqueue adds if absent, lease updates state, resolve marks resolved (no-op if already), lease-expired reverts if still leased

**Compaction**: only on clean shutdown. If WAL >10k entries OR >5MB, write `queue-snapshot.json` and truncate WAL.

**Failures**: `lease-expired` on resolve → returns error, Claude can drain again. Multi-session race → mutex in QueueManager. WAL corruption → daemon refuses replay, instructs manual reset (no silent recovery).

### 3.4 External file change

1. fs notification → FileWatcher. Debounce 200ms + reconciliation scan every 5s on open files (covers chokidar's lossy events on Windows).
2. For each changed file:
   - Read, compute current sha256
   - In recent-writes set? → ignore (self-write)
   - Else: external change
3. External change:
   - Invalidate `project-analyzer` cache for filepath
   - Check if any `data-vid` removed/moved → mark dirty
4. WS send `{ kind: 'file-changed', filePath, sha256, dirtySourceMap }`.
5. Editor:
   - dirty → stale state (banner; explicit re-instrument)
   - not dirty → iframe HMR

**Resolves**: Husky/Prettier/format-on-save → sha changes → treated as external (correct). Atomic-save IDEs → caught by sha comparison post-event. Lost chokidar events → reconciliation scan picks up.

### 3.5 Preview-worker crash

1. Worker exit code != 0
2. PreviewSupervisor: collect last N kb stderr (ring buffer), classify (timeout/immediate/memory/import-error/config-changed-during-startup)
3. Retry policy: <3 crashes in 60s → respawn with backoff (1s/4s/9s); ≥3 → stop, mark session failed. Per-filePath limit (3 crashes for same page → cooldown 60s even on new sessions).
4. WS send `{ kind: 'preview-crashed', reason, stderrTail, willRespawn }`.
5. Editor: spinner if respawning; error screen + retry button if not.

**Guarantee**: worker crash never kills daemon. Edits + queue continue.

### 3.6 Multi-Claude-Code session

1. Session A already ran `/visual` → Daemon A active, lock file with `{ pid, port, heartbeat, stateHash, version }`.
2. Session B calls `mcp-server.open_page` → reads lock; if PID alive + heartbeat <30s + version matches, HTTP POST to existing daemon's port.
3. Both sessions share same daemon, unified queue. `drain_ask_ai` returns entire queue regardless of session origin (filePath identifies file). Responsibility on draining agent to interpret.
4. Stale lock (heartbeat >30s or PID dead): B takes ownership, overwrites lock, replays WAL (loading snapshot first if exists). Race protected by POSIX flock / Windows file lock.
5. Version mismatch in WAL → refuse takeover with hint to reset.

### 3.7 Tab close / disconnect

1. Editor-ui `beforeunload` → WS send `{ kind: 'bye', sessionId }`.
2. SessionLayer: mark closed, release pending leases (back to pending), discard uncommitted dry-runs, keep preview-worker alive 30s for reconnect.
3. WS drop without bye → 60s TTL via ping/pong (10s interval, 30s timeout) → same cleanup.

### 3.8 Daemon shutdown (Ctrl+C / SIGTERM)

Total timeout: 5s.
1. SessionLayer refuses new connections
2. Notify WS clients `{ kind: 'shutting-down' }`
3. EditPipeline drains in-flight commits (max 3s); rejects new
4. QueueManager flushes WAL + fsync; if WAL big, writes snapshot + truncates
5. PreviewSupervisor SIGTERM workers (max 2s) then SIGKILL
6. FileWatcher closes
7. Closes HTTP port
8. Removes lock file
9. exit 0

SIGKILL (no clean shutdown): WAL persists to last flush; lock left orphaned; next startup detects stale and takes over via 3.6.

### 3.9 Secret leakage redaction (transversal)

Principles:
1. `mock-runtime` receives only schemas + field names. Never values from `.env`, cookies, tokens, real SDK config.
2. `project-analyzer` filters `.env` by `safeEnvPrefixes` (default `['VITE_', 'PUBLIC_', 'NEXT_PUBLIC_']`). Other vars never leave the analyzer.
3. `visual-edit.config.ts` loaded in sandbox (Node `vm` module). Runtime hook detects `process.env.<UNSAFE>` access → daemon refuses to load config.
4. `AskAIRequest.context.surroundingCode` truncated to ±20 lines around element + Logger redaction policy applied (allowlist; non-safe content replaced with `<HASH:length:summary>`).
5. Logs never persist surroundingCode raw. Raw goes to `.visual-edit/raw-logs/` (gitignored, never in `diagnose` zip, opt-in flag only).

Trade-off: occasional false-positive over-redaction reduces AI context quality. Acceptable.

### Out-of-MVP flows (documented)

| Scenario | MVP behavior | Why deferred |
|---|---|---|
| `vite.config.*` / `tsconfig.json` / `tailwind.config.*` change mid-session | Daemon kills all preview sessions; user re-opens manually | Hot-reload of config = invalidate cache + restart workers + re-instrument; complex. Nuke is simple and correct. |
| Preview-worker version mismatch with daemon (after `npm update` mid-session) | Daemon detects in IPC handshake, refuses, instructs restart | Hot-upgrade requires bidirectional protocol versioning; out of scope. |
| Runtime WAL compaction (not on shutdown) | Not implemented | Compaction only on clean shutdown. Big WAL in runtime is warning, not error. |
| Multiple previews of same page simultaneously | Allowed, distinct sessionId, share data-vid mapping | OK; conflicts surface via `StaleDryRunError`. |

---

## Section 4 — Error Handling & Observability

### 4.1 Categories

```
VE_PROJECT_*  — project analysis/config
VE_CONFIG_*   — visual-edit.config.ts invalid
VE_PREVIEW_*  — preview-worker / adapter / browser runtime
VE_CODEMOD_*  — instrumentation / planEdits / apply / commit
VE_QUEUE_*    — Ask-AI queue / WAL / leases
VE_PROTOCOL_* — version mismatch / invalid messages
VE_FS_*       — filesystem IO (rename, lock, backup)
VE_INTERNAL_* — our bug (assertion failure, contract violation)
```

Catalog in `docs/errors.md` (under `packages/diagnostics`). Each code: pt-br/en messages, hint, severity, recovery, blame.

### 4.2 Envelope (3 dimensions, not 1)

```ts
interface ErrorEnvelope {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'error' | 'fatal';
  recovery: 'none' | 'automatic-retry' | 'user-action' | 'unrecoverable';
  blame: 'user-config' | 'user-code' | 'tool' | 'environment' | 'unknown';
  hint?: string;
  context?: Record<string, unknown>;        // safeToLog fields only
  cause?: ErrorEnvelope;
  traceId: string;
}
```

`severity` = how bad. `recovery` = what to do. `blame` = whose fault. Decoupled, none implies the others.

### 4.3 Propagation

| Origin | Severity | Recovery | Destination |
|---|---|---|---|
| `VE_CONFIG_001` (missing config) | fatal | user-action | MCP tool response, daemon not stuck |
| `VE_PREVIEW_*` runtime | error | automatic-retry | WS → editor; PreviewSupervisor decides |
| `VE_CODEMOD_002` (TS parse fails after patch) | fatal | unrecoverable (don't write) | Editor "report this" + traceId. Our bug. |
| `VE_FS_001` EPERM rename | warn | automatic-retry | Becomes `commit-uncertain` after 3 tries |
| `VE_QUEUE_001` lease expired | info | automatic-retry | Item back to pending, no UI alert |
| `VE_PROTOCOL_001` version mismatch | fatal | user-action | Editor refuses connect; upgrade hint |
| `VE_INTERNAL_*` | fatal | unrecoverable | Full stack to logs; UI shows traceId |

**Principle**: user-code errors don't crash daemon. Our errors don't either (error boundary per worker).

### 4.4 Logs

- **Local only**: `.visual-edit/logs/<date>/daemon.log`, `worker-<sessionId>.log`. NDJSON. Daily rotation. **Default 30-day retention** (configurable).
- **Startup snapshot**: `.visual-edit/logs/<date>/startup.json` once per daemon boot — Node/Bun version, OS, filesystem type, package manager, Vite/React/TS versions, project git SHA + dirty state, adapter config snapshot. Logs reference this by traceId.
- **Allowlist policy** (not regex denylist): Logger persists only fields explicitly marked `safeToLog: true`. Free-form strings replaced with `<HASH:length:summary>`. Raw content goes to `.visual-edit/raw-logs/` (gitignored; never in `diagnose` zip; opt-in flag `--include-raw` only).
- **Tail by traceId**: `npx visual-edit-cli logs --trace=<id>` aggregates daemon + worker entries.
- **No external telemetry in MVP.**

### 4.5 Daemon crash recovery

1. Lock orphaned (invalid PID)
2. WAL persists to last flush
3. Workers orphaned. Windows: child detach can persist; killed by next daemon startup (PID lookup)
4. Next `/visual` → mcp-server detects stale lock → spawns new daemon → takes over via 3.6

If recurring (>3 crashes in 10min): mcp-server returns `VE_INTERNAL_999` with hint to run `npx visual-edit-cli diagnose` (zips logs + startup snapshots, excluding raw-logs).

---

## Section 5 — Testing Strategy

### 5.1 Pyramid

```
e2e (real Vite project + Playwright)         ~10%   slow, high value
─────────────────────────────────────────
integration (daemon + worker + real FS)      ~30%
─────────────────────────────────────────
unit (each package)                          ~60%
```

### 5.2 Unit (per package)

| Package | Focus | Tools |
|---|---|---|
| `shared` | Zod parse edge cases | vitest |
| `protocol` | Round-trip property-based | vitest + fast-check |
| `project-analyzer` | 20+ synthetic project fixtures (Vite/CRA/TS/JS, monorepo, aliases) | vitest, `__fixtures__/projects/` |
| `mock-runtime` | Snapshot of generated code | vitest snapshot |
| `code-mods` | **CRITICAL** — TSX edge case corpus + property-based + mutation testing (see 5.3) | vitest + fast-check + Stryker |
| `diagnostics` | Redaction allowlist policy against adversarial strings | vitest + fuzz |
| `daemon` | Each worker (FileWatcher, EditPipeline, PreviewSupervisor, QueueManager, SessionLayer) with mocked neighbors | vitest |
| `asset-proxy` | Path resolution, fallback, placeholder | vitest + supertest |

### 5.3 code-mods rigor (load-bearing)

Branch coverage is vanity here. Real gates:

1. **TSX edge case corpus** in `__fixtures__/tsx/`: decorators, satisfies, fragments, conditional JSX, generics with JSX, type-only imports, comments-as-directives, MDX-like JSX, styled-components template literals, mixed JS/TS, generated code patterns. Each: instrument + planEdits + apply + assert TS still parses + assert AST equivalence (only target nodes differ) + assert no comment loss + assert whitespace preserved outside target range.
2. **Property-based testing**: fast-check generates random TSX (constrained grammar), instruments, applies random Edits, validates same invariants. CI gate.
3. **Mutation testing** (Stryker): in MVP, not post-MVP. Mutates `code-mods` source; tests must catch. Score gate ≥75%.
4. **Real OSS projects in spike**: see 6.1.

### 5.4 Integration

- Daemon + worker + real FS: spawn real daemon, fixture project, exercise all transitions, validate WAL/commit log/backups.
- WAL replay: synthetic 10k-entry WAL, kill daemon, restart, validate state matches expected.
- Multi-session race: two procs competing for lock; one wins, other connects.
- **Windows-specific subset mandatory on CI Windows runner.** EPERM simulated via fs.rename hook. OneDrive in VM optional but documented.

### 5.5 E2E (Playwright)

3 seed projects in `__fixtures__/e2e/`: `vite-tailwind`, `cra-css-modules`, `vite-styled-components`.

Flow per seed:
1. Daemon up
2. `open_page` via MCP
3. Browser WS connect
4. Click element → drag handle → assert dry-run
5. Ctrl+S → assert disk file content
6. External edit script → assert file-changed propagated
7. Tab close → assert cleanup

Total ~2min. CI gate.

### 5.6 Not automated

- Visual quality of isolated render (PR manual check; screenshot diff vs real-render post-MVP)
- Onlook parser if enabled (marked experimental, untested by default)
- Real OneDrive sync (manual VM in RC)
- Real AI quality (out of scope)

### 5.7 Coverage targets

Targets matter, but **gates** matter more. Targets:
- `code-mods`: 90% branch + property-based + mutation ≥75%
- `protocol`/`diagnostics`/`shared`: 85%+
- `daemon`/`mock-runtime`/`project-analyzer`: 75%+
- `editor-ui`: smoke + critical paths

**Gates** (block CI):
- All edge case corpus tests pass
- Property-based 1000 iterations clean
- Stryker mutation score `code-mods` ≥75%
- Windows integration suite passes

---

## Section 6 — Rollout Phases

### 6.0 Total budget: ~15.5 weeks to v1.0 utilizable

(Honest re-estimate after Codex flagged 10w as fantasy.)

### 6.1 Phase 0 — Spike (1.5 weeks)

**Goal**: prove text-patch via TS Compiler positions is durable.

Deliverables:
- 10 synthetic TSX fixtures cover hard syntax (decorators, satisfies, fragments, conditional, generics, comments, type-only imports, mixed JS/TS, multiline className expressions, multiple repeated elements).
- Run text-patch over these + **3 real OSS React projects** cloned from GitHub (a Vite+Tailwind starter, a CRA app, a component library). For 30 random `Edit`s per project, validate AST equivalence + comment preservation + whitespace preservation outside targets.
- Property-based test runs 1000 iterations on a constrained TSX generator, all pass.

**Go/no-go gate** for Phase 1: every fixture and every OSS project edit succeeds.

### 6.2 Phase 1 — MVP-α (5 weeks)

Goal: edit a Vite + Tailwind page, commit works, no AI-in-loop UI.

Packages delivered:
- `shared`, `protocol`, `diagnostics`
- `project-analyzer` (without `findApiContracts`)
- `code-mods` with `tailwind-class` and `inline-style` targets only
- `mock-runtime`: `buildEntryWrapper` (config.wrapPage) + `buildFakerBindings`
- `adapters/vite`
- `daemon` + `preview-worker` (**including QueueManager schema + WAL** even though no UI uses it yet — avoids Phase 2 redesign)
- `editor-ui` minimal: select element, color picker, padding handle, Ctrl+S
- `mcp-server`: `open_page`, `close_preview`, `get_status`, `rollback`
- `apps/claude-plugin`: `/visual <page>`

Out: Ask-AI UI, CSS Modules, styled-components, asset-proxy complete (placeholder fallback only), CRA, multi-session.

**Acceptance** (measurable):
- 100 random edits across 3 real Notter-AI pages (or chosen seed projects)
- Per edit: AST equivalence holds (only target nodes differ), zero comment loss, whitespace outside target range identical, TS parse clean
- All 100 must pass; any failure blocks Phase 1

### 6.3 Phase 2 — MVP-β (3 weeks)

Goal: AI-in-loop end-to-end + additional targets.

Adds:
- `code-mods`: `css-module` + `styled-prop` targets
- `daemon`: QueueManager active, lease state machine wired
- `mcp-server`: `drain_ask_ai`, `resolve_ask_ai`
- `editor-ui`: ai-prompt panel
- `project-analyzer.findApiContracts` (`*.api.ts` convention)
- `mock-runtime.buildMSWHandlers` real

Acceptance: workflow "select → prompt → AI edits → keep editing" end-to-end on 1 seed project, 20 prompts, all reach a terminal `outcome` state, no queue corruption.

### 6.4 Phase 3 — Robustness (4 weeks, split)

**3a — Windows safety (1.5 weeks)**: retry+verify+commit-uncertain in commits, hash-based dedup in FileWatcher, reconciliation scan, sandbox in `loadConfig`.

**3b — Multi-session + asset-proxy (1.5 weeks)**: lock takeover + WAL replay, asset-proxy complete (fonts + remote images).

**3c — CRA + diagnostics CLI (1 week)**: CRA adapter, `visual-edit-cli logs/diagnose`.

Acceptance: 2 weeks real Notter-AI workflow on Windows without corruption or queue loss; diagnose CLI produces a usable bug report.

### 6.5 Phase 3.5 — Security review (1 week, NEW)

- Threat model: malicious `visual-edit.config.ts`, malicious project source (instrumentation injection), malicious WS messages, malicious AI responses.
- Pen-test redaction policy with adversarial inputs.
- Review `vm` sandbox escape vectors in config loader.
- Review symlink/`..` handling in path resolution.

Acceptance: written threat model document + every identified mitigation implemented or documented as accepted risk.

### 6.6 Phase 4 — Distribution (1 week)

- Publish npm packages
- Claude Code marketplace
- README + docs/errors.md public
- 3-min showcase video

### 6.7 Post-MVP (undated)

- Next.js Pages Router adapter
- Runtime WAL compaction
- Structural editing (add/remove/duplicate)
- Codex/Gemini plugins (thin shells over MCP)
- Vue/Svelte adapters
- Screenshot diff vs real-render

### 6.8 Schedule summary

```
Week  0    — Phase 0 spike (1.5w)
Weeks 2–6  — Phase 1 MVP-α (5w)
Weeks 7–9  — Phase 2 MVP-β (3w)
Weeks 10–13 — Phase 3 robustness (4w split 1.5+1.5+1w)
Week  14   — Phase 3.5 security (1w)
Week  15   — Phase 4 distribution (1w)
─────────────────────────────────────────
Total: 15.5 weeks to v1.0 utilizable
```

Order rationale: Phase 0 is cheap kill-switch if text-patch unviable. Phase 1 ships value early (you can edit Notter-AI). AI is tempting first but more complex. Robustness last because real usage exposes where it breaks. Security review before distribution.

---

## Section 7 — Compatibility, Privacy & Procedures

### 7.1 Compatibility matrix

| Dimension | Supported in MVP | Outside support |
|---|---|---|
| OS | Windows 11+, macOS 13+, Linux Ubuntu 22+/Fedora 39+ | Older OS → `VE_PROJECT_990 unsupported-os` warning, may work |
| Node runtime | Node 22+ (default) or Bun 1.1+ | Node 20 → `VE_PROJECT_991 node-too-old`, refuses |
| Package manager | npm 10+, pnpm 9+, yarn 4+, bun 1.1+ | Older → warning |
| Bundler | Vite 5+, CRA 5+ | Next.js any version → `VE_PROJECT_992 next-not-supported`, suggests Phase 2 |
| React | 18.2+, 19+ | <18.2 → warning, may work |
| TypeScript | 5.0+ | <5.0 → warning |
| Tailwind | 3+, 4+ | <3 → warning, may not detect classes correctly |
| Filesystem | Local NTFS/APFS/ext4 | Network drives → warning, OneDrive/Dropbox → warning + extra retries |

`VE_PROJECT_99x` codes are blocking (refuse to start) for runtime/bundler; warnings (proceed) for OS/FS.

### 7.2 Privacy policy

**Stays local always** (never leaves user's machine):
- Project source code (other than what user explicitly sends to AI)
- `.env` values
- Cookies, tokens, real SDK config
- Mock data values generated by Faker
- Logs (`.visual-edit/logs/`), backups (`.visual-edit/backups/`), WAL (`.visual-edit/queue.wal`)

**May be sent to connected AI** (Claude Code session, etc.) **with redaction**:
- Prompt typed by user in ai-prompt panel
- `surroundingCode` (±20 lines around selected element, redacted via allowlist policy)
- Element computed styles (numeric/string values, no DOM-derived secrets)
- File path of the selected element

**Never sent to AI**:
- `.env` content or values
- Mock data values
- Other files in the project
- Daemon logs
- Raw logs from `.visual-edit/raw-logs/`

**No external telemetry** in MVP. No analytics. No crash reporting to remote.

User-controlled flags:
- `--include-raw` in `diagnose`: includes raw logs in zip (default off)
- Redaction allowlist customizable in `visual-edit.config.ts`

### 7.3 Corruption incident runbook

If user reports source corruption or unexpected diff:
1. **Don't overwrite the backup**. The `.visual-edit/backups/` directory has the file content prior to each commit, named by `commitId`.
2. Run `npx visual-edit-cli diagnose --since=24h` → produces `visual-edit-diagnose-<timestamp>.zip` with logs (redacted) + startup snapshots + commit log + WAL state. Excludes raw-logs.
3. Restore from backup: identify the suspect `commitId` in `.visual-edit/commit-log.json`; copy `.visual-edit/backups/<file>-<commitId>` over the corrupted file.
4. Run `git diff` to compare suspect commit's `sha256After` (in commit log) with current file. If mismatch: external mutation happened post-commit.
5. Open issue with diagnose zip + traceId. **Never include raw-logs** unless explicitly requested by maintainer.
6. Until issue resolved: disable visual editor for that file (add to `visual-edit.config.ts → disabledFiles`).

### 7.4 Migration policy

Persisted formats are versioned:
- WAL: `version: '1'`
- commit-log: `version: '1'`
- daemon.lock: `version: '1'`
- visual-edit.config.ts: validated by Zod schema, breaking changes bump major

**Policy**: never silent migration. Version bump on breaking change requires user to:
- For WAL/commit-log: delete the file (loses pending state) — daemon refuses to start if version mismatches and no migration script.
- For lock: auto-overwritten on next start (loses no state).
- For config.ts: error message points to migration guide in changelog.

Migration scripts are NOT included in the package (avoid silent state mutation). Manual instructions in `docs/migrations/<version>.md`.

### 7.5 Threat model summary (filled in Phase 3.5)

- **Malicious `visual-edit.config.ts`**: sandbox via `vm` + access policy; refuses unsafe `process.env`, `fs`, `child_process`, network calls. `wrapPage` runs with controlled globals.
- **Malicious project source**: instrumentation reads but doesn't execute user JS during instrument phase. Preview-worker runs user code in child process (process boundary = sandbox).
- **Malicious WS messages**: Zod validation; strict schema; rejects unknown fields.
- **Malicious AI responses**: AI's edits go through Claude Code's normal Edit tool with diff approval. Daemon doesn't auto-apply AI output.
- **Path traversal**: project-analyzer rejects `..` in resolved paths; asset-proxy enforces `publicDir` boundary.

---

## Appendix A — Glossary

| Term | Definition |
|---|---|
| **data-vid** | Attribute injected by `code-mods.instrument` to map DOM elements to source positions. Stable per file instrumentation. |
| **commit-uncertain** | State after 3 retries failed on rename; we don't know if write succeeded. Editor reloads + re-fetches to verify. |
| **dry-run** | Computed `EditPlan` applied in-memory only, hashes returned for verification. Never writes. |
| **lease** | 15-min hold on a queue item taken via `drain_ask_ai`; expires back to pending if not resolved. |
| **wrapPage** | User-supplied function in `visual-edit.config.ts` that wraps the rendered page with the providers it needs (theme, query client, auth context, router). Avoids auto-detection. |
| **safeEnvPrefixes** | Allowlist of environment variable prefixes that may be exposed to the preview (default `VITE_`, `PUBLIC_`, `NEXT_PUBLIC_`). All other env vars stay in daemon. |
| **stale state** | Editor state when external file change invalidates `data-vid` mapping. Blocks edits until explicit re-instrument click. |

---

## Appendix B — Open questions for next session

1. CSS-in-JS coverage beyond styled-components: emotion, vanilla-extract, panda-css? (Probably Phase 2+)
2. Where do tokens come from in the design tokens panel? Tailwind config? CSS vars? User declaration?
3. Should `editor-ui` be a published web app or always served by the local daemon? (Currently: served by daemon's HTTP.)
4. Should we provide a "freeze" mode where edits are saved as a JSON patch file instead of applied to source, for review-then-apply workflow?
5. Should `apps/claude-plugin` ship via Anthropic's official marketplace once it exists, or stay on local marketplace forever?

---

## Approval status

- [x] User reviewed this spec
- [x] User approved to proceed to implementation plan (writing-plans skill)
- [x] Phase 0 spike plan written: docs/superpowers/plans/2026-05-09-phase-0-spike.md
- [x] Phase 0 spike executed (GO/NO-GO recorded in docs/superpowers/specs/2026-05-09-spike-results.md)
