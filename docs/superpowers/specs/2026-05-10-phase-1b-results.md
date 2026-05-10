# Phase 1.B Results — Edit + Commit Pipeline

**Date:** 2026-05-10
**Outcome:** SUCCESS (acceptance gate passed)
**Plan:** docs/superpowers/plans/2026-05-09-phase-1b-edit-commit-pipeline.md

## Summary

Phase 1.B delivered the full edit-and-commit pipeline end-to-end: user opens the editor UI in Playwright, selects an element's overlay, changes `className`, presses Ctrl+S, and the new value is atomically written to disk with backup + commit log + all AST/comment/whitespace invariants verified. The editor UI (React + Zustand + WebSocket) connects to the daemon, receives an instrumented snapshot, renders interactive overlays on top of the preview iframe, and round-trips edits through the WS protocol.

## Acceptance gate

E2E test `tests/e2e/edit-and-commit.test.ts` passes:

1. Daemon starts on dynamic port (5170-5179) with `editorAssetsRoot` pointing to editor-ui dist
2. POST /preview → `{ url, sessionId, editorUrl }`
3. Playwright opens `editorUrl` (the daemon-served editor-ui SPA)
4. `window.__VE_DEBUG_SOURCEMAP` is populated (proves WS snapshot round-trip)
5. h1's vid found in sourceMap; overlay `[data-vid-overlay]` renders
6. Overlay clicked → h1 selected → className panel pre-filled with `text-2xl`
7. Fill `text-red-500` → Apply → dry-run badge appears
8. Ctrl+S → commit-ok received → badge disappears
9. Disk file contains `text-red-500`
10. Invariants: `assertEditEquivalence`, `assertCommentsPreserved`, `assertWhitespacePreservedOutsidePatches` all pass
11. Commit log has entry with correct `sha256After`; backup file contains original `text-2xl`
12. Zero console errors in editor page

Time: ~3 seconds end-to-end (daemon up + Vite cold start + Playwright load + edit + commit + verify).

## Packages delivered

| Package | Tests | Purpose |
|---|---|---|
| @visual-edit/code-mods | 30 (10 files) | instrument + vid + planEdits + apply + invariants + backups + commitLog + commit (atomic/retry) + rollback |
| @visual-edit/protocol | 11 (2 files) | WS edit/dry-run/commit/commit-ok/commit-uncertain/file-changed schemas; extended snapshot schema |
| @visual-edit/daemon | 14 pass / 1 pre-existing fail (8 files) | EditPipeline + FileWatcher + static editor serving + rollback route + editorUrl in response |
| @visual-edit/editor-ui | 8 (3 files) | Vite+React+Tailwind+Zustand: App, Iframe, Overlay, PropertiesPanel, WS client, state |
| @visual-edit/mcp-server | 4 (2 files) | rollback tool + editorUrl in open_page response |
| @visual-edit/shared | 2 (1 file) | (unchanged) |
| @visual-edit/adapter-vite | 9 (2 files) | (unchanged) |
| @visual-edit/mock-runtime | 8 (3 files) | (unchanged) |
| @visual-edit/project-analyzer | 13 (4 files) | (unchanged) |
| **e2e** | **3 (2 files)** | render-isolated-page (1.A) + edit-and-commit (1.B) |
| **Total** | **102 tests** | |

## Bugs found + fixed during 1.B

(In execution order. All fixes landed in their own commits or alongside the task that surfaced them.)

1. **`control+S` key case mismatch** — PropertiesPanel checks `e.key === 's'` (lowercase) but Playwright `page.keyboard.press('Control+S')` generates `e.key = 'S'` (uppercase, shift-equivalent). Fixed in the e2e test to use `'Control+s'`. (`647edd5`)

2. **`computeVid` Windows path-separator mismatch** — `fast-glob` returns forward-slash absolute paths on Windows (`C:/Users/.../Home.tsx`) while `node:path`'s `resolve()` returns backslash paths (`C:\Users\...\Home.tsx`). Both are passed as `filePath` to `computeVid`, producing different SHA-256 hashes and therefore different vid values. Fixed `computeVid` to normalize backslashes to forward slashes before hashing. (`647edd5`, in `packages/code-mods/src/vid.ts`)

3. **e2e test files ran in parallel** — vitest's default `fileParallelism: true` caused both e2e test files to start their daemons simultaneously. Both tried to bind preview sessions to port 5180, causing EADDRINUSE. Fixed by setting `fileParallelism: false` in `tests/e2e/vitest.config.ts`. (`647edd5`)

4. **Body-already-read error** — Test used `await openResp.text()` inside an `expect()` message expression, which consumed the response body before `await openResp.json()`. Fixed with an explicit `if (!openResp.ok)` throw that reads `.text()` only on failure. (`647edd5`)

5. **Preview URL regex too strict** — Test asserted `url.toMatch(/^http:\/\/127\.0\.0\.1:51\d\d/)` but the daemon binds previews on ports 5180-5200 (4 digits). Fixed to `/^http:\/\/127\.0\.0\.1:5\d\d\d/`. (`647edd5`)

6. **portFinder.test.ts "throws VE_PREVIEW_003" — pre-existing failure** — This test times out when port 5180 is held by a stale Vite preview worker from a previous test run. Confirmed pre-existing (fails before any 1.B changes). Not fixed — noted as a known flake; isolated daemon runs (not in the workspace suite cascade) pass this test cleanly.

## Limitations & out-of-scope (deferred to 1.C)

| Item | Phase |
|---|---|
| Ask-AI queue + WAL + lease state machine | 1.C |
| Multi-session daemon discovery + lock takeover | 1.C |
| CRA adapter | 1.C |
| findApiContracts + buildMSWHandlers (real backend mocking) | 1.C |
| HMR validation in e2e | post-MVP |
| Auto-spawn daemon from MCP server | 1.C |
| Color + padding edits via editor-ui (UI exists; not covered by e2e) | 1.C |
| MCP tool e2e (skipped per plan — rollback has its own unit test) | 1.C |

## Decision

**GO** — proceed to Phase 1.C. The edit+commit pipeline is solid: 102 tests green (excluding 1 pre-existing portFinder flake), full Playwright e2e proves the UI → WS → daemon → disk → commit-log → backup chain works end-to-end on Windows. The Windows path-separator bug in `computeVid` was caught and fixed here, making vids stable across all execution contexts.
