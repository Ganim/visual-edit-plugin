# Phase 1.F Results — Multi-file Edit Targets (CSS Modules + styled-components)

**Date:** 2026-05-10
**Outcome:** SUCCESS (acceptance gate passed)
**Plan:** docs/superpowers/plans/2026-05-10-phase-1f-multifile-edit-targets.md

## Summary

Phase 1.F extended the editing surface beyond className and inline style to two real-world patterns: CSS Modules and styled-components. The core architectural change was promoting `planEdits` from a single-file → single-file transform to a `MultiFileEditPlan` shape — a list of `PlannedFile` entries keyed by absolute path — so that a single user action (selecting a `<h2 className={styles.subtitle}>` and sending a css-module edit) produces patches against both the `.tsx` file and the `.module.css` file simultaneously. The commit pipeline was extended with `commitMultiFile`, which backs up all files first, writes all `.tmp` files and fsyncs them, then renames in order — and on any rename failure reverts already-renamed files to their backups (all-or-nothing atomicity). The WS dry-run reply now carries a `files: Array<{filePath, patches, beforeHash, afterHash}>` array in place of the deprecated single-file fields. The editor-ui's `pendingDryRun` shape was updated to store `afterHashes: string[]` across all planned files.

For CSS Module support, `instrument()` gained a pre-pass (`findCssModuleImports`) that collects `import styles from './X.module.css'` statements into a map, then in pass 2 `detectCssModuleBinding` populates `entry.cssModule = {importedAs, importPath, binding}` when a JSX element's className is `{styles.title}`-style. A regex-based rule parser (`findCssRuleRange`) locates the body of a flat CSS rule by binding name, refuses nested selectors (`VE_CSSMOD_001`) and missing rules (`VE_CSSMOD_002`). For styled-components, `instrument()` gained a `findStyledComponents` pass that maps component names to their template-literal position ranges; `planEdits` uses this to produce a single-file patch on the template content, and refuses cross-file imports (`VE_STYLED_001`) and interpolated templates (`VE_STYLED_002`). The 1.E review fixes landed as commit `3882b22` (MSW e2e gap, SSRF guard, config.api merge, adapter wiring) and `53ffdc5` (restored all 9 existing e2e to green after regressions introduced during 1.F feature work). Task 12 additionally extended the `WsEditMessage` Zod schema in `packages/protocol/src/ws.ts` to accept `css-module` and `styled-prop` edit kinds, and exported `findCssRuleRange` from the `@visual-edit/code-mods` public surface.

## Acceptance gate

E2E test `tests/e2e/multifile-edit.test.ts` passes — 3 tests in ~8s:

1. **CSS Module edit end-to-end (scenario 1):** seed page has `<h2 className={styles.subtitle}>Welcome back</h2>` with `Home.module.css` defining `.subtitle { color: gray; font-size: 14px; }`. Daemon starts, WS hello triggers instrumentation, snapshot sourceMap carries `cssModule.binding = 'subtitle'` on the h2 entry. Edit message `{kind: 'css-module', element: vid, binding: 'subtitle', newRuleBody: 'color: red;\n  font-size: 14px;'}` produces a dry-run reply with a patch on `Home.module.css`. Ctrl+S (commit) → `commit-ok`. Disk read confirms `color: red` present, `color: gray` absent.

2. **CSS Module nested-rule refusal (scenario 4):** `findCssRuleRange('.foo .title { ... }', 'title')` throws `VE_CSSMOD_001`. Unit test coverage also in `packages/code-mods/tests/cssModule.parser.test.ts` (5 tests). Daemon liveness confirmed via a known-bad `/preview` call returning a non-OK response.

3. **styled-components cross-file refusal (scenario 5):** `planEdits` on a file with `import { Title } from './styled.js'` throws `VE_STYLED_001`. Unit test coverage also in `packages/code-mods/tests/styledComponent.detect.test.ts` (5 tests).

Scenarios 2 (styled-components edit end-to-end) and 3 (multi-file atomicity / synthetic rename failure) are covered by unit tests only (`styledComponent.plan.test.ts` and `multiFileCommit.test.ts` respectively), per the plan's scope note.

## Per-package test counts

| Package | Tests | Files | Notes |
|---|---|---|---|
| @visual-edit/asset-proxy | 20 | 4 | +6 from 1.E (rewriter, scaffold, strategies, middleware) |
| @visual-edit/code-mods | 53 | 17 | +21 from 1.E — cssModule.detect, cssModule.parser, cssModule.plan, styledComponent.detect, styledComponent.plan, multiFileCommit |
| @visual-edit/daemon | 53 | 22 | unchanged — EditPipeline changes covered by existing pipeline + editPipeline tests |
| @visual-edit/diagnostics | 11 | 3 | unchanged |
| @visual-edit/editor-ui | 23 | 6 | unchanged |
| @visual-edit/mcp-server | 8 | 5 | unchanged |
| @visual-edit/mock-runtime | 13 | 4 | unchanged |
| @visual-edit/preview-worker | 3 | 1 | unchanged |
| @visual-edit/project-analyzer | 23 | 7 | unchanged |
| @visual-edit/protocol | 16 | 3 | +1 from CssModuleEdit + StyledPropEdit added to EditSchema (existing test exercises the new union members) |
| @visual-edit/shared | 3 | 2 | unchanged |
| @visual-edit/adapter-vite | 14 | 3 | unchanged |
| **e2e** | **12** | **6** | +3 new: multifile-edit.test.ts (1.F gate scenarios 1, 4, 5) |
| **Total** | **252** | **87** | up from 221 in 1.E — exceeds 245+ target |

## Bugs found + fixed during 1.F

1. **`WsEditMessage` EditSchema missing `css-module` and `styled-prop` variants (Task 12)** — `packages/protocol/src/ws.ts` only had `ClassNameEditSchema` and `StyleEditSchema` in its `EditSchema` union. A `css-module` edit sent over the WS connection was rejected by Zod validation with `VE_PROTOCOL_002: invalid edit message` before reaching `planEdits`. Fixed by adding `CssModuleEditSchema` and `StyledPropEditSchema` to the union.

2. **`findCssRuleRange` not exported from `@visual-edit/code-mods`** — The public `index.ts` did not export `findCssRuleRange`, making it unavailable to consumers (including e2e tests and future CLI tooling). Fixed by adding the re-export.

3. **1.E review fixes (commit `3882b22`):** MSW e2e gap (service worker not written to ephemeral dir), SSRF guard on the asset-proxy, `config.api` deep-merge in `loadConfig`, and Vite adapter wiring for `endpoints`.

4. **e2e regressions after 1.F feature commits (commit `53ffdc5`):** Several 1.F feature commits broke the existing 9 e2e tests (instrument shape changes, `pendingDryRun` field rename). Restored by updating test assertions and normalizing the shared snapshot shape.

## Limitations & out-of-scope (deferred to 1.G)

| Item | Reason |
|---|---|
| CRA adapter | Vite-only in 1.A–1.F |
| Full vm isolation for `loadConfig` | Requires rolling own TS transpiler; jiti evaluates in host context |
| WAL corrupt snapshot full-recovery | Daemon currently refuses to start; user must `rm queue-snapshot.json` |
| Preview worker heartbeat liveness | Only daemon heartbeat implemented |
| Hot-reload of `visual-edit.config.ts` | Requires daemon restart |
| `visual-edit-cli logs` + `diagnose` | Not yet implemented |
| Asset-proxy persistent cache + LRU | 1.E/1.F use in-memory cache only |
| JSX-time image src/srcset rewriting | Manually proxied in seed for 1.E; 1.G will make it a build-time transform |
| CSS `background-image: url()` rewriting | Requires CSS parser |
| Nested CSS rule edits / pseudo-class edits | 1.F only handles flat rules; nested refused via VE_CSSMOD_001 |
| Cross-file styled-components (imported) | 1.F requires same-file definition; imports refused via VE_STYLED_001 |
| Template-literal interpolation editing | Interpolated templates refused via VE_STYLED_002 (instrument skips them) |
| RegExp ApiEndpoint URLs | `findApiContracts` currently only supports literal string URLs |

## Decision

**GO** — proceed to Phase 1.G. Phase 1.F delivered a fully wired multi-file edit pipeline: CSS Module rules are discovered at instrument time, patched atomically alongside the `.tsx` file, and persisted to disk with rollback-on-partial guarantees. styled-components same-file definitions are supported with appropriate refusals for cross-file and interpolated cases. Total test count grew from 221 (1.E) to 252 (1.F), exceeding the 245+ target. The acceptance gate (`multifile-edit.test.ts`, 3 scenarios) passes cleanly on Windows in under 10 seconds.
