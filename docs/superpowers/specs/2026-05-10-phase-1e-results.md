# Phase 1.E Results — Realistic Preview (MSW + Asset-Proxy)

**Date:** 2026-05-10
**Outcome:** SUCCESS (acceptance gate passed)
**Plan:** docs/superpowers/plans/2026-05-10-phase-1e-realistic-preview.md

## Summary

Phase 1.E completed the end-to-end realistic preview chain so that isolated previews look and behave like the real app. On the API-mocking side, `findApiContracts` was wired into `Daemon.openPreview`: after discovering schemas it now calls `findApiContracts(root, schemaNames)` and passes the resulting `ApiEndpoint[]` to `AdapterInput.endpoints`. The Vite adapter already populated `handlers.ts` via `buildMSWHandlers` when `endpoints` was provided — the final step was ensuring the daemon supplied them. The MSW service worker (copied from `msw/lib/mockServiceWorker.js` into each ephemeral preview dir by the adapter) intercepts browser fetches before they hit the network, returning faker-generated responses for every `*.api.ts`-declared endpoint. On the asset-proxy side, remote image URLs are manually rewritten to `/__assets/proxy?u=<encoded>` in the seed's Home.tsx for 1.E (JSX-time automatic rewriting deferred to 1.F); the Vite dev server's `configureServer` middleware handles `/__assets/proxy?u=…` requests using the `placeholder` strategy, returning a 1×1 SVG with status 200 so `<img>.naturalWidth ≥ 1` in the browser.

Supporting changes: `avatarUrl` was added to the `User` Zod schema in the seed, `examples/basic-vite/src/api/users.api.ts` was created as the seed's API contract file (`GET /api/users/me → User`), and `avatarUrl` was added to the faker `STRING_FIELD_TABLE` in `mock-runtime` so `makeUser()` produces a valid `faker.image.avatar()` URL rather than a lorem word (which would fail `z.string().url()` validation). Home.tsx was extended to conditionally render `<img src={user.avatarUrl}>` and unconditionally render the banner image via the proxy path.

## Acceptance gate

E2E test `tests/e2e/realistic-preview.test.ts` passes — 1 test in ~3.4s (daemon start ≤ 2s, Vite dev server ≤ 2s, page render + assertions < 1s):

1. **POST /preview opens Home.tsx** — daemon starts, binds port, creates ephemeral preview with MSW handlers + proxy middleware wired.

2. **h1 starts with "Hello "** — proves the `__VE_MOCKS.makeUser()` faker path (same as 1.A gate) still works after the endpoints wiring addition.

3. **Every `<img>` has `naturalWidth > 0`** — at minimum the banner `<img src="/__assets/proxy?u=…">` is present; the asset-proxy middleware responds with a 1×1 SVG (status 200); Chromium reports `naturalWidth = 1`. If `user.avatarUrl` is truthy (faker generates a valid avatar URL), a second img is also checked.

4. **Zero console errors** — MSW runs in `quiet: true` mode; Tailwind is loaded; no unhandled 404s appear.

## Per-package test counts

| Package | Tests | Files | Notes |
|---|---|---|---|
| @visual-edit/asset-proxy | 14 | 4 | unchanged from 1.E tasks 1–10 |
| @visual-edit/code-mods | 32 | 11 | unchanged |
| @visual-edit/daemon | 53 | 22 | unchanged (wiring is in daemon.ts; no new unit tests needed) |
| @visual-edit/diagnostics | 11 | 3 | unchanged |
| @visual-edit/editor-ui | 23 | 6 | unchanged |
| @visual-edit/mcp-server | 8 | 5 | unchanged |
| @visual-edit/mock-runtime | 13 | 4 | +5 from tasks 2–3 (buildMSWHandlers + entryWrapper MSW) |
| @visual-edit/preview-worker | 3 | 1 | unchanged |
| @visual-edit/project-analyzer | 23 | 7 | +5 from tasks 1 + 5 (findApiContracts + orphan detection) |
| @visual-edit/protocol | 15 | 3 | unchanged |
| @visual-edit/shared | 3 | 2 | unchanged |
| @visual-edit/adapter-vite | 14 | 3 | +5 from tasks 4 + 6 (mockServiceWorker write + handlers wiring) |
| **e2e** | **9** | **5** | +1 new: realistic-preview.test.ts (1.E gate) |
| **Total** | **221** | **81** | up from 191 in 1.D — exceeds 220+ target |

## Bugs found + fixed during 1.E

(All `fix:` and `feat:` commits in this phase are already in the log as Tasks 1–10 landed in the prior session; Task 11 adds no fix commits — only the wiring and seed extension.)

1. **`avatarUrl` missing from faker STRING_FIELD_TABLE** — `makeUser()` would generate `faker.lorem.word()` for the `avatarUrl` field, which fails `z.string().url()` Zod validation and causes `User.parse()` to throw. Fixed by adding `avatarUrl: 'faker.image.avatar()'` to the STRING_FIELD_TABLE in `packages/mock-runtime/src/fakerBindings.ts`.

2. **`findApiContracts` never called in daemon** — `Daemon.openPreview` computed schemas but never called `findApiContracts`, so `AdapterInput.endpoints` was always `undefined` and MSW handlers were always empty (`handlers.length === 0` → worker startup short-circuits). Fixed by importing `findApiContracts` in `daemon.ts` and calling it after `discoverSchemas`.

## Limitations & out-of-scope (deferred to 1.F)

| Item | Reason |
|---|---|
| CSS Modules edit target (multi-file EditPlan refactor) | CSS rule lives in a different file from JSX; requires EditPlan to target multiple files simultaneously |
| styled-components edit target | Same multi-file concern — styled definition often imported from another file |
| CRA adapter | Vite-only in 1.A–1.E |
| Full vm isolation for `loadConfig` (jiti bypass) | Requires rolling own TS transpiler; jiti evaluates in host context |
| WAL corrupt snapshot full-recovery | Daemon currently refuses to start; user must `rm queue-snapshot.json`; full recovery deferred |
| Preview worker heartbeat liveness | Only daemon heartbeat implemented |
| Hot-reload of `visual-edit.config.ts` during a session | Requires daemon restart |
| `visual-edit-cli logs` + `diagnose` | Not yet implemented |
| Asset-proxy persistent cache + LRU | 1.E uses in-memory cache only; 1.F adds filesystem cache + LRU eviction |
| CSS `background-image` URL rewriting | 1.E only rewrites JSX `<img src>` / `<source srcset>`; CSS background-image is not intercepted (requires CSS parser) |
| JSX-time automatic src rewriting | 1.E manually rewrites banner src to `/__assets/proxy?u=…` in Home.tsx; 1.F will make this a build-time transform so user code stays clean |

## Decision

**GO** — proceed to Phase 1.F. Phase 1.E delivered a fully wired realistic preview: API endpoint contracts discovered from `*.api.ts` files flow through the daemon into the Vite adapter, MSW service worker intercepts browser fetches in Chromium, and remote images are served through the asset-proxy middleware without network errors. Total test count grew from 191 (1.D) to 221 (1.E), exceeding the 220+ target. The acceptance gate (`realistic-preview.test.ts`) passes cleanly on Windows in under 4 seconds.
