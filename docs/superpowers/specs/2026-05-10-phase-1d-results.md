# Phase 1.D Results — Robustness + Security Hardening

**Date:** 2026-05-10
**Outcome:** SUCCESS (acceptance gate passed)
**Plan:** docs/superpowers/plans/2026-05-10-phase-1d-robustness-and-security.md

## Summary

Phase 1.D hardened the daemon for multi-session use and added isolation for user-supplied config evaluation. On the multi-session front, the `daemon.lock` format was extended with a `heartbeat` timestamp, `stateHash`, and an explicit `version: '1'` field. A `LockHeartbeat` worker updates the heartbeat every 5 seconds; a new `decideLockAction` helper classifies any existing lock as "connect", "takeover", "bind", or "refuse" — takeover fires when the heartbeat is more than 30 seconds stale or the owning PID is dead. `Daemon.start()` now handles all four cases cleanly, and the full three-way mode surface (`bound`, `connected`, `took-over`) is exercised by the acceptance e2e. A `LeaseTimer` worker auto-reverts expired leases on a 60-second tick (in addition to the existing on-drain expiry check). WAL runtime compaction was implemented: once the queue exceeds 10 000 entries or 5 MB, the in-memory state is snapshotted to `queue-snapshot.json` and the WAL is truncated to a single `snapshot-ref` entry; replay validates the snapshot's SHA-256 before applying subsequent ops.

On the project tooling side, `ProjectAnalyzer.analyze()` now caches results by root and exposes `invalidateAnalyzer(root, filePath)` which the daemon's FileWatcher calls on every external-change event. `Logger` gained an allowlist redaction mode: by default only fields in `SAFE_LOG_FIELDS` (sessionId, code, port, pid, root, level, msg, ts, etc.) pass through unmodified; free-form strings such as `prompt` are replaced with `<HASH:hex8:len:prefix>` placeholders. The `loadConfig` pipeline received a regex pre-flight stage that rejects configs importing `fs`, `child_process`, `net`, `http`, or calling `fetch` — the error is `VE_CONFIG_002`. This phase also landed the five 1.C review fixes bundled as Task 11: wsServer null-guard in `resolveAskAI`, WAL version-mismatch structured envelope (`VE_QUEUE_005`), `_resetSeqCache` removed from the public queue barrel, `ResolveAskAIRequest.summary` capped at 4 096 characters, and unknown-kind rate limiting (max 5 per connection then close 1003).

## Acceptance gate

E2E test `tests/e2e/multi-session-and-sandbox.test.ts` passes — 4 tests in ~42ms:

1. **Multi-session takeover after stale lock** — a `daemon.lock` with `pid: 99999` and a heartbeat 60 s in the past is written manually; a new `Daemon` is started on the same root; `getMode()` returns `'took-over'`.

2. **Multi-session connect when fresh daemon exists** — D1 starts (mode `'bound'`); D2 is instantiated with `mode: 'connect-only'`; D2's `start()` returns without binding a port; `d2.getMode() === 'connected'` and `d2.getPort() === d1.getPort()`.

3. **WAL compaction round-trip** — 5 items are enqueued; `compactWal` is called; the in-process seq cache is reset; `replayWal` returns all 5 items.

4. **vm sandbox rejects fs import** — a `visual-edit.config.ts` containing `import fs from 'node:fs'` is written; `loadConfig` rejects with an error matching `/VE_CONFIG_002/`.

## Per-package test counts

| Package | Tests | Files | Notes |
|---|---|---|---|
| @visual-edit/code-mods | 32 | 11 | unchanged |
| @visual-edit/daemon | 53 | 22 | +15 new: lockHeartbeat, lockTakeover, multiSession, compaction, leaseTimer |
| @visual-edit/diagnostics | 11 | 3 | +7 new: redaction (4), logger.allowlist (3) |
| @visual-edit/editor-ui | 23 | 6 | unchanged |
| @visual-edit/mcp-server | 8 | 5 | +1 new: autospawn lock-probing (replaced placeholder) |
| @visual-edit/mock-runtime | 8 | 3 | unchanged |
| @visual-edit/preview-worker | 3 | 1 | unchanged |
| @visual-edit/project-analyzer | 18 | 6 | +5 new: analyze.cache (2), loadConfig.sandbox (3) |
| @visual-edit/protocol | 15 | 3 | unchanged |
| @visual-edit/shared | 3 | 2 | +1 new: lockFile.shape |
| @visual-edit/adapter-vite | 9 | 2 | unchanged |
| **e2e** | **8** | **4** | +4 new: multi-session-and-sandbox (1.D gate) |
| **Total** | **191** | **68** | up from 158 in 1.C |

## Bugs found + fixed during 1.D

(All `fix:` commits since `63c53e0`.)

1. **1.C review bundle** (`4364d85`) — five fixes landed together:
   - **wsServer race in resolveAskAI** — `broadcastAskAIResolved` was called unconditionally; added `if (this.wsServer)` guard so the handler doesn't throw if the WS server hasn't started yet.
   - **WAL version mismatch bare Error** — the version-mismatch throw in `readWalEntries` used a plain `Error`; replaced with `VisualEditError(VE_QUEUE_005)` so callers can pattern-match.
   - **`_resetSeqCache` on public queue barrel** — test helper was re-exported from `queue/index.ts`, leaking an internal into the public API; removed from the barrel (tests import directly from `./wal.js`).
   - **`ResolveAskAIRequest.summary` unbounded** — Zod schema had no length limit; capped at 4 096 characters to prevent WAL disk exhaustion via a single crafted resolve call.
   - **Unknown WS kind not rate-limited** — repeated unknown-kind messages were forwarded as structured errors indefinitely; added a per-connection counter that closes the socket with code 1003 after 5 violations.

## Limitations & out-of-scope (deferred to 1.E)

| Item | Reason |
|---|---|
| Full vm isolation for `loadConfig` (bypassing jiti) | Requires rolling own TS transpiler; jiti evaluates in host context; deferred to 1.E |
| CRA adapter | Vite-only in 1.A–1.D |
| Asset-proxy beyond placeholder | Placeholder only |
| CSS modules + styled-components edit targets | AST targeting not yet implemented |
| Real backend mocking (`findApiContracts` + `buildMSWHandlers`) | Deferred |
| WAL recovery from corrupt snapshot files | Daemon refuses to start; user must `rm queue-snapshot.json`; full recovery deferred |
| Heartbeat-based liveness for preview workers | Only daemon heartbeat implemented in 1.D |
| Hot-reload of `visual-edit.config.ts` during a session | Still requires daemon restart |

## Decision

**GO** — proceed to Phase 1.E. Phase 1.D hardens the 1.A–1.C feature surface against multi-session races, stale locks, WAL bloat, hostile config files, and unredacted log leakage. Total test count grew from 158 (1.C) to 191 (1.D), well above the 180+ target. The acceptance gate (`multi-session-and-sandbox.test.ts`) passes cleanly on Windows in under 50ms. All five 1.C review fixes are landed and covered.
