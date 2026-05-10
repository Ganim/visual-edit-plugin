# Phase 1.C Results — Ask-AI Loop + Auto-Spawn + Polish

**Date:** 2026-05-10
**Outcome:** SUCCESS (acceptance gate passed)
**Plan:** docs/superpowers/plans/2026-05-10-phase-1c-ask-ai-and-polish.md

## Summary

Phase 1.C closed the human-in-the-loop edit cycle. Users can now select an element in the editor UI, type a prompt in the new `AiPromptPanel`, and the connected agent drains the queue via MCP (`drain_ask_ai`), applies its changes, and reports the outcome back via `resolve_ask_ai`. The editor shows live per-item status transitions: `pending → leased → committed/rejected/failed/no-op`. State is persisted in an append-only WAL (`queue.wal`) with SHA-256 integrity checks, monotonic sequence numbers, and idempotent replay on restart.

In addition to the Ask-AI queue, Phase 1.C delivered: auto-spawning of the daemon from the MCP server (`MCP_AUTO_SPAWN=1`), polish fixes for portFinder flake, commitLog corruption tolerance, rollback error envelope consistency, symlink guard for the static editor route, WS unknown-kind error forwarding, preview directory cleanup on session stop, and the `readLock` abstraction extracted to `@visual-edit/shared`. The new `AiPromptPanel` is wired into the editor layout and the full cycle — from "Ask AI" click to "committed" badge — is exercised by the acceptance e2e.

## Acceptance gate

E2E test `tests/e2e/ask-ai-and-color.test.ts` passes:

1. Daemon starts on dynamic port; `editorAssetsRoot` points to `packages/editor-ui/dist`.
2. POST `/preview` → `{ url, sessionId, editorUrl }`.
3. Playwright opens `editorUrl`; waits for `window.__VE_DEBUG_SOURCEMAP` to populate.
4. h1's vid found in sourceMap; `[data-vid-overlay]` renders.
5. Overlay clicked → h1 selected → `AiPromptPanel` textarea becomes interactive.
6. `[data-testid="ask-ai-input"]` filled with `"make it red"` → Ask AI button clicked.
7. `window.__VE_DEBUG_ASK_AI` (Zustand subscriber in `App.tsx`) shows a real askId (not `pending:` prefix) once `ask-ai-queued` ack arrives from daemon.
8. POST `/drain-ask-ai` → item found in response with leaseId.
9. POST `/resolve-ask-ai` with `outcome: 'committed', summary, commitId: 'fake-c1'` → 204.
10. `[data-testid="askai-item-<askId>"]` contains text `"committed"`.
11. `[data-testid="apply-style"]` clicked → `dry-run ready` badge appears → Ctrl+s → badge disappears.
12. `Home.tsx` on disk contains `style={` and matches `/color:\s*'#[0-9a-fA-F]{6}'/`.
13. Zero console errors in editor page.
14. POST `/close` → 204; page closed; `afterAll` restores `Home.tsx`.

Time: ~3 seconds end-to-end per test (daemon up + WS snapshot + ask-ai round-trip + color edit + Ctrl+S commit).

## Per-package test counts

| Package | Tests | Files | Notes |
|---|---|---|---|
| @visual-edit/code-mods | 32 | 11 | +2 new: commitLog.corruption (1), rollback envelope (covered in existing) |
| @visual-edit/daemon | 38 | 17 | +24 new: WAL, replay, QueueManager, integration, portFinder.fallback, previewSupervisor.cleanup, staticEditor.symlink |
| @visual-edit/diagnostics | 4 | 1 | unchanged |
| @visual-edit/editor-ui | 23 | 6 | +15 new: state.askai (3), aiPromptPanel (3), wsClient (8), panel.style (1) |
| @visual-edit/mcp-server | 7 | 5 | +3 new: drain, resolve, autospawn |
| @visual-edit/protocol | 15 | 3 | +4 new: ask-ai/ask-ai-queued/ask-ai-resolved schemas |
| @visual-edit/shared | 2 | 1 | unchanged |
| @visual-edit/mock-runtime | 8 | 3 | unchanged |
| @visual-edit/project-analyzer | 13 | 4 | unchanged |
| @visual-edit/preview-worker | 3 | 1 | unchanged |
| @visual-edit/adapter-vite | 9 | 2 | unchanged |
| **e2e** | **4** | **3** | +1 new: ask-ai-and-color (1.C gate) |
| **Total** | **158** | **57** | up from 102 in 1.B |

## Bugs found + fixed during 1.C

(In execution order. All `fix:` commits landed in their own commits.)

1. **portFinder throws when port range exhausted instead of falling back** — `findFreePort` would throw `VE_PREVIEW_003` when all ports in the configured range (5170–5179) were busy. Fixed by adding an OS-assigned port 0 fallback before the error throw. (`9e60bb9`)

2. **portFinder.test.ts hard-codes port 5180 causing flake** — Two tests occupied port 5180 deterministically, colliding when external processes (prior Vite previews) held that port. Fixed by switching to OS-assigned ephemeral ports via `createServer().listen(0)`. (`2b3a164`)

3. **readCommitLog crashes on corrupted JSONL line** — A single bad line (truncated write, disk error, manual edit) caused `JSON.parse` to throw and silenced all subsequent entries. Fixed by wrapping each line's parse in `try/catch` with a stderr warning. (`4753ab9`)

4. **rollback.ts throws bare `Error` instead of `VisualEditError`** — The guard for `kind !== 'commit'` used `new Error(...)` directly, bypassing the structured error envelope. Fixed to use `VisualEditError` with `VE_CODEMOD_003_STALE_DRY_RUN`. (`076a1c8`)

5. **`/__editor/` route doesn't guard against symlinks** — Static file serving resolved paths without `realpathSync`, allowing a crafted symlink inside `editorAssetsRoot` to escape the root. Fixed by adding `realpathSync` check before serving. (`ddb5534`)

6. **WS unknown message kind silently dropped** — Unknown `kind` values in the WS handler were swallowed with no feedback. Fixed to forward them as a structured `error` message to the client. (`ddb5534`)

7. **daemon.ts and apply.ts error envelopes missing `[VE_...]` prefix in message** — Error messages emitted from daemon and apply didn't include the code prefix, making log correlation harder. Fixed to include the code in the message string. (`ddb5534`)

8. **preview directory not cleaned up on session stop** — `.visual-edit/preview-<hash>/` directories accumulated after each preview session close. Fixed in `previewSupervisor.ts` to `rmSync` the directory tracked per session on stop. (`03f7b5c`)

9. **mcp-server depended on `@visual-edit/daemon` just to read the lock file** — A circular / heavyweight dependency for a single function. Extracted `readDaemonLock` to `@visual-edit/shared`; mcp-server now depends only on shared. (`03f7b5c`)

## Limitations & out-of-scope (deferred to 1.D)

| Item | Phase |
|---|---|
| Multi-session lock takeover (single-session lock enforced; no handoff) | 1.D |
| CRA adapter (Vite-only) | 1.D |
| Asset-proxy beyond placeholder | 1.D |
| Real backend mocking (`findApiContracts` + `buildMSWHandlers`) | 1.D |
| CSS modules + styled-components edit targets | 1.D |
| Diagnostics logger allowlist redaction policy | 1.D |
| ProjectAnalyzer cache invalidation on file change | 1.D |
| WAL compaction at runtime (only on clean shutdown per spec §3.3) | 1.D |
| Lease auto-revert background timer (1.C checks at drain time only) | 1.D |
| `vm` sandbox hardening for `loadConfig` | 1.D |
| Windows daemon detachment (best-effort; not full POSIX detach) | documented operating constraint |

## Decision

**GO** — proceed to Phase 1.D. Phase 1.C delivers a fully end-to-end Ask-AI queue: WAL-backed, lease-guarded, broadcast-resolved, and Playwright-verified in a real browser. The total test count grew from 102 (1.B) to 158 (1.C). All nine bug fixes from the 1.B review were addressed. The color edit e2e gap (flagged in 1.B results) is now covered. The acceptance gate (`ask-ai-and-color.test.ts`) passes cleanly on Windows in under 5 seconds.
