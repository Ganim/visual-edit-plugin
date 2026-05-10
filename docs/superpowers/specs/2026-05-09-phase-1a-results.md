# Phase 1.A Results — Render Isolated Page

**Date:** 2026-05-09
**Outcome:** SUCCESS (acceptance gate passed)
**Plan:** docs/superpowers/plans/2026-05-09-phase-1a-render-isolated-page.md

## Summary

Phase 1.A delivered the rendering pipeline end-to-end: user runs `/visual <page>`, daemon spawns a synthetic Vite preview that renders the page in isolation with `wrapPage` applied + faker-derived mock data on `globalThis.__VE_MOCKS`. No editing yet — that's Phase 1.B.

## Acceptance gate

E2E test `tests/e2e/render-isolated-page.test.ts` passes:
1. Daemon starts on dynamic port (5170-5179)
2. POST /preview with `src/pages/Home.tsx` → `{ url, sessionId }`
3. Playwright opens URL → `<h1>Hello {faker name}</h1>` rendered, email + padding applied
4. `window.__VE_MOCKS.makeUser` is a function (proves full chain)
5. Console: zero errors
6. POST /close → 204
7. Unknown route → VE_PROJECT_002

Time: ~3 seconds end-to-end (Vite cold start + Chromium launch + render + close).

## Packages delivered

| Package | Tests | Purpose |
|---|---|---|
| @visual-edit/shared | 2 | Pure types (ProjectInfo, PageEntry, VisualEditConfig, MockSchema, PreviewSession, etc.) |
| @visual-edit/protocol | 6 | Zod schemas for HTTP / WS / IPC + PROTOCOL_VERSION 1.0 |
| @visual-edit/diagnostics | 4 | ErrorEnvelope + VisualEditError + Logger + 13 CODES |
| @visual-edit/project-analyzer | 13 | analyze + loadConfig (jiti+sandbox) + findRoutes + discoverSchemas |
| @visual-edit/mock-runtime | 7 | fakerBindings + entryWrapper code generators |
| @visual-edit/adapter-vite | 9 | generateEphemeralPreview + startVite + extractLocalUrl |
| @visual-edit/preview-worker | 3 | Child-process IPC entry |
| @visual-edit/daemon | 8 | lockFile + portFinder + PreviewSupervisor + HTTP + WS + Daemon class + cli |
| @visual-edit/mcp-server | 2 | DaemonClient + MCP tools (open_page, close_preview, get_status) |
| **Total** | **54 unit + 2 e2e = 56** | |

Plus `apps/claude-plugin/` (slash command, skill, .mcp.json template, install script) and `examples/basic-vite/` (seed Vite+React+Tailwind project).

## Bugs found + fixed during 1.A

(In execution order. All fixes landed in their own commits or alongside the task that surfaced them.)

1. **`.npmrc` was pnpm-only** (`prefer-workspace-packages`/`save-workspace-protocol`) — npm warned on every command. Removed. (`578c5f4`)
2. **`.gitignore` glob `packages/*/.tsbuildinfo` didn't match `tsconfig.tsbuildinfo`** (no leading dot) — fixed to `packages/*/*.tsbuildinfo`. (`35a7ed7`)
3. **`package.json` `exports` had `import` before `types`** — Node TypeScript resolution scans in order; types must come first. Global edit across plan + landed packages. (`8a6098e`)
4. **`loadConfig` env sandbox flagged jiti/babel/etc tooling vars as "unsafe"** — added `TOOL_INFRA_PREFIXES`/`TOOL_INFRA_NAMES` allowlist. (`6a08f56`)
5. **Error messages didn't include code string** for `toThrow(/CODE/)` regex tests — added `[CODE]:` prefix to error messages. Affected loadConfig and portFinder. (`6a08f56`, `963ee3c`)
6. **VE_CONFIG_001 hint had un-interpolated template literal** — hardcoded the default safe-env prefix list. (`6cdb1cd`)
7. **examples/basic-vite App.tsx had named-import / default-export mismatch** — runtime breakage. Fixed import; also removed unused `QueryClient` reference. (`62b1a17`)
8. **safeEnv didn't allow vitest worker env vars** (`WATCH_REPORT_DEPENDENCIES`, `POSITIONAL_ARGUMENTS`, `TINYPOOL_WORKER_ID`) — caused VE_CONFIG_001 false-positive when Daemon ran inside vitest. Added to allowlist. (`32c89fc`)
9. **mock-runtime missing `@faker-js/faker` dep** — generated code imports it but the dep wasn't declared, so Vite couldn't resolve it from the ephemeral preview dir. Added to dependencies. (`32c89fc`)

## Limitations & out-of-scope (deferred)

| Item | Phase |
|---|---|
| code-mods (instrument/planEdits/apply — port from spike) | 1.B |
| editor-ui (overlay, color picker, padding handles, iframe wrapper) | 1.B |
| Commit pipeline (text-patch + Windows-safe atomic write) | 1.B |
| Ask-AI queue + WAL + lease state machine | 1.C |
| Asset-proxy beyond placeholder fallback | 1.C |
| Multi-session daemon discovery + lock takeover | 1.C |
| CRA adapter | 1.C |
| findApiContracts + buildMSWHandlers (real backend mocking) | 1.C |
| Diagnostics logger allowlist redaction policy | 1.C |
| HMR validation in e2e | post-MVP |
| Auto-spawn daemon from MCP server | 1.B |

## Decision

**GO** — proceed to Phase 1.B (edit + commit pipeline). The rendering foundation is solid: 56 tests green, real React Query app renders with faker data, no errors. Phase 1.B will:
1. Port the Phase 0 spike (`spike/src/`) into `packages/code-mods/`
2. Build editor-ui with overlay + commit triggers
3. Wire WS messages for live edits + invariant validation
