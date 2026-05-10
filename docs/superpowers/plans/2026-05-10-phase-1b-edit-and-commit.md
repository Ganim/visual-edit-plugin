# Visual Edit — Phase 1.B: Edit & Commit Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a Phase 1.A rendered isolated page, let the user select a JSX element in a Figma-mode overlay, change its Tailwind className or inline style, see optimistic preview, press Ctrl+S, and have the change persisted to the source file via a Windows-safe text-patch commit. Invariants from the Phase 0 spike (AST equivalence, comment preservation, whitespace preservation outside patches) hold on every commit.

**Architecture:** A new `packages/code-mods` ports the Phase 0 spike (`spike/src/`) into the production tree, adapting `SpikeEdit` to the shared `Edit` discriminated union. A new commit pipeline in `code-mods` handles backups, atomic writes with retry/verify, a commit log, and rollback. The `daemon` gains an `EditPipeline` worker (planEdits → apply → commit) and a `FileWatcher` worker (chokidar + recent-writes set) wired through extended WS protocol messages. A new `packages/editor-ui` (Vite + React + Tailwind + Zustand) is built once into static assets and served by the daemon HTTP at `/__editor/`. The preview entry (mock-runtime) gains a small bridge script that postMessages `data-vid` rects to the parent editor frame. `mcp-server` adds a `rollback` tool. Acceptance: an e2e test edits an element, commits, and asserts both the disk file content and all three invariants.

**Tech Stack:** Node 22+, TypeScript 5.6+, npm workspaces, vitest, Zod, `typescript` (TS Compiler API), `chokidar`, Vite 5, React 18, Tailwind 3, Zustand, `react-color`, `ws`, Playwright (e2e).

**Phase 1.B scope explicitly OUT:**
- Ask-AI queue + WAL + lease state machine (1.C)
- Asset-proxy beyond placeholder (1.C)
- Multi-session daemon discovery + lock takeover (1.C)
- CRA adapter (1.C)
- `findApiContracts` + `buildMSWHandlers` (1.C)
- Diagnostics logger redaction allowlist policy (1.C)
- CSS Modules + styled-components targets (Phase 2)
- Property-based tests on real OSS projects (re-run in 1.B-final acceptance, full corpus stays in spike)
- Stryker mutation gate (Phase 3)
- `editor-ui` design tokens panel (post-MVP)

**Documented 1.B operating constraints:**
- Editor-ui is served by daemon HTTP under `/__editor/` (decision Q3 from spec Appendix B). It is built statically as part of the package's `npm run build` and shipped in `dist/`. The daemon serves these files; opening `http://127.0.0.1:<daemonPort>/__editor/?session=<id>` boots the editor.
- The preview iframe is on a different origin (preview port vs daemon port). Cross-origin element measurement uses a bridge script injected by `mock-runtime.buildEntryWrapper` that posts `data-vid` rects to `parent` via `postMessage` with target origin `'*'`. This is intentional for the localhost dev context (preview port is daemon-controlled and not exposed publicly). Editor-ui's overlay is purely position-driven from these messages — it never reads `iframe.contentDocument`.
- **Initial instrumentation persists `data-vid` attributes to the user's source file.** The first `getSnapshot()` call per session writes the instrumented source back to disk so vids are stable across reloads, and registers a backup + commit-log entry of kind `'instrument'` so the mutation is auditable. The user WILL see a `git diff` containing only the new `data-vid` attributes; a future task (post-1.B) can add a `.prettierrc` ignore or a "strip vids on commit" git hook. The self-write is registered with FileWatcher so it does not fire `external-change`.
- `EditPipeline` runs in the same process as the daemon, but inside an explicit try/catch boundary so a code-mods bug doesn't take the daemon down (per spec §2.10 fault isolation).
- Commit pipeline retries 3x with exponential backoff (100ms, 400ms, 900ms) on EPERM/EBUSY (Windows AV/OneDrive race). On all-three failure → `commit-uncertain` WS message; editor-ui forces iframe reload + sha re-fetch.
- File watcher uses `chokidar` with hash-based recent-writes dedup AND a 5s reconciliation rescan (spec §3.4) — chokidar fires lossy events on Windows.
- `editor-ui`'s `react-color` and `react-rnd` deps must be checked through Sonatype Guide before install (per CLAUDE.md user feedback). Plan uses `react-color@2.19.3` and `react-rnd@10.4.13`; subagent must validate before adding.
- The e2e test (Task 22) requires Playwright Chromium — already installed by the 1.A pretest hook in `tests/e2e/package.json`.

**Plan review history:**
- 2026-05-10 — initial draft (22 tasks, 4 sub-phases)
- 2026-05-10 — self-review pass (Codex sandbox unavailable on Windows). Fixes applied inline:
  - Task 11: `EditPipeline.getSnapshot()` now performs backup + commit-log entry (`kind: 'instrument'`) + atomic write + `onSelfWrite` callback for the initial instrument write (was: bare `writeFileSync`, would have fired spurious `external-change` and left no audit trail).
  - Task 11: `EditPipeline.getFilePath()` added so WS handler doesn't need a cast hack.
  - Task 13: collapsed redundant edit (the `onSelfWrite` plumbing was duplicated between Tasks 11 and 13 — now lives only in Task 11).
  - Task 14: path-traversal guard now decodes percent-escapes BEFORE normalizing; test sends raw HTTP request with `..%2F` so the guard is actually exercised.
  - Task 17: `buildEntryWrapper` test now uses the correct signature (`fakerBindingsImportPath`, `userCssImportPath`, `sessionId`); plan now explicitly shows `lines.push(BRIDGE_SOURCE)` rather than just declaring the constant.
  - Task 21: MCP `rollback` tool registration now has explicit code (was "match the existing pattern" placeholder).
  - Task 22: pre-conditions step added (verify daemon-started signal + mcp-server CLI shape); commit-log read uses `readCommitLog` from `@visual-edit/code-mods` rather than fragile manual JSON parsing; backup file is verified.
  - File-Structure: `commitLog.CommitLogEntry.kind` extended to `'commit' | 'rollback' | 'instrument'`.

**Acceptance** (the gate that ends Phase 1.B): `examples/basic-vite/` is the seed. Running:
```
node packages/daemon/dist/cli.js start --root examples/basic-vite &
node packages/mcp-server/dist/cli.js call open_page '{"root":"examples/basic-vite","page":"src/pages/Home.tsx"}'
# returns { url: <previewUrl>, sessionId, editorUrl: "http://127.0.0.1:<daemonPort>/__editor/?session=..." }
```
Opening `editorUrl` in a browser shows: the preview in an iframe, an overlay highlighting JSX elements on hover, a properties panel on the right. Clicking the `<h1>` selects it; typing `text-red-500` in the className box and pressing Enter shows the heading turn red live (optimistic) and a dry-run badge. Pressing Ctrl+S commits the change to `src/pages/Home.tsx` on disk. The on-disk file:
- Contains `text-red-500` in the `<h1>` className
- Has identical content outside the patched range (exact bytes)
- Parses cleanly as TSX
- Passes the three Phase 0 invariants (AST equivalence on targeted vs untargeted nodes, comment preservation, whitespace preservation outside patches)
- Has a backup at `.visual-edit/backups/Home.tsx-<commitId>` matching the pre-commit content
- Has an entry in `.visual-edit/commit-log.json` with `{ commitId, filePath, sha256Before, sha256After }`

Calling `mcp-server.rollback({ commitId })` restores the file to its pre-commit state and appends an inverse entry to the commit log.

The e2e test `tests/e2e/edit-and-commit.test.ts` automates the full flow including the disk + invariants assertions.

---

## File Structure

```
visual-edit-plugin/
├── packages/
│   ├── code-mods/                       — NEW
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                 — public exports
│   │   │   ├── types.ts                 — re-export shared.Edit + internal types (TextPatch, ElementSourceMap)
│   │   │   ├── vid.ts                   — port from spike: computeVid()
│   │   │   ├── instrument.ts            — port from spike: instrument(source, filePath)
│   │   │   ├── planEdits.ts             — adapt spike: planEdits(sourceMap, edits: shared.Edit[])
│   │   │   ├── apply.ts                 — port from spike: apply(source, patches)
│   │   │   ├── invariants/
│   │   │   │   ├── astEquivalence.ts    — port from spike
│   │   │   │   ├── commentPreservation.ts
│   │   │   │   └── whitespacePreservation.ts
│   │   │   ├── backups.ts               — NEW: writeBackup(file, commitId, content)
│   │   │   ├── commitLog.ts             — NEW: appendEntry / readLog / readEntry
│   │   │   ├── commit.ts                — NEW: atomic write w/ retry+verify, throws CommitUncertainError
│   │   │   └── rollback.ts              — NEW: validate sha + restore from backup
│   │   └── tests/
│   │       ├── instrument.test.ts
│   │       ├── planEdits.test.ts
│   │       ├── apply.test.ts
│   │       ├── invariants.test.ts
│   │       ├── backups.test.ts
│   │       ├── commitLog.test.ts
│   │       ├── commit.test.ts
│   │       ├── rollback.test.ts
│   │       └── pipeline.test.ts          — instrument → plan → apply → commit, real fs
│   │
│   ├── shared/                          — MODIFY
│   │   └── src/
│   │       └── edit.ts                  — NEW file: Edit discriminated union (StyleEdit, ClassNameEdit), TextPatch type re-exported from code-mods boundary
│   │
│   ├── protocol/                        — MODIFY
│   │   └── src/
│   │       └── ws.ts                    — extend with edit/dry-run/commit/commit-ok/commit-uncertain/file-changed/error messages; snapshot now includes sourceMap + sourceText + editorUrl
│   │
│   ├── diagnostics/                     — MODIFY
│   │   └── src/
│   │       └── codes.ts                 — add VE_CODEMOD_001/002/003, VE_FS_002/003
│   │
│   ├── mock-runtime/                    — MODIFY
│   │   └── src/
│   │       └── entryWrapper.ts          — inject bridge.js (postMessage rects of data-vid elements)
│   │
│   ├── daemon/                          — MODIFY
│   │   ├── src/
│   │   │   ├── editPipeline.ts          — NEW: per-session editor pipeline (instrument cache + plan + apply + commit)
│   │   │   ├── fileWatcher.ts           — NEW: chokidar watcher + recent-writes set + 5s reconciliation
│   │   │   ├── ws.ts                    — extend: route edit/commit/rollback messages
│   │   │   ├── http.ts                  — NEW route: GET /__editor/* (static serve from editor-ui/dist)
│   │   │   └── daemon.ts                — wire EditPipeline + FileWatcher per session; openPreview returns editorUrl
│   │
│   ├── editor-ui/                       — NEW
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx                 — React root
│   │   │   ├── App.tsx                  — layout: iframe + overlay + properties panel
│   │   │   ├── state.ts                 — Zustand store: { session, sourceMap, selectedVid, rects, dryRun, status }
│   │   │   ├── wsClient.ts              — WS connect, hello/snapshot, send edit/commit, receive dry-run/commit-ok/file-changed
│   │   │   ├── canvas/
│   │   │   │   ├── Iframe.tsx           — iframe pointing at preview URL; listens for postMessage 'rects' updates
│   │   │   │   └── Overlay.tsx          — renders rectangle per data-vid; click → selectedVid
│   │   │   ├── panels/
│   │   │   │   └── PropertiesPanel.tsx  — right panel: className textbox + ColorPicker + padding inputs
│   │   │   └── styles.css
│   │   ├── tests/                       — vitest, jsdom (smoke only)
│   │   │   └── state.test.ts
│   │   └── dist/                        — committed-built artifacts (served by daemon)
│   │
│   └── mcp-server/                      — MODIFY
│       └── src/
│           └── index.ts                 — add 'rollback' tool
│
├── tests/
│   └── e2e/
│       └── edit-and-commit.test.ts      — NEW: full flow + disk assertions + invariant re-checks
│
└── docs/
    └── superpowers/
        └── plans/
            └── 2026-05-10-phase-1b-edit-and-commit.md  — this plan
```

---

## Sub-phases

The 22 tasks are grouped into 4 sub-phases. Each sub-phase produces something testable on its own and ends with a green commit.

| Sub-phase | Tasks | Outcome |
|---|---|---|
| **1.B-1: Port spike → code-mods** | 1–5 | `packages/code-mods` parity with spike (instrument, plan, apply, invariants); shared `Edit` type adapter |
| **1.B-2: Commit pipeline** | 6–11 | Backups + commit log + Windows-safe atomic write + rollback + extended WS protocol + daemon EditPipeline |
| **1.B-3: File watcher & snapshot** | 12–14 | Chokidar watcher with self-write dedup; snapshot extended with sourceMap + sourceText + editorUrl |
| **1.B-4: Editor-UI + e2e** | 15–22 | Editor-ui served by daemon, bridge script in preview, properties panel, MCP rollback, e2e acceptance gate |

---

## Sub-phase 1.B-1 — Port spike to packages/code-mods

### Task 1: Scaffold `packages/code-mods` package

**Files:**
- Create: `packages/code-mods/package.json`
- Create: `packages/code-mods/tsconfig.json`
- Create: `packages/code-mods/src/index.ts`
- Modify: `tsconfig.base.json` (no change expected — confirm `paths` already empty)
- Modify: root `package.json` (no change — `workspaces: ["packages/*"]` already covers this)

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/scaffold.test.ts
import { describe, it, expect } from 'vitest';
import * as codemods from '../src/index.js';

describe('code-mods scaffold', () => {
  it('exports a stable public surface (placeholder until Task 2+)', () => {
    expect(codemods).toBeDefined();
    expect(typeof codemods).toBe('object');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/code-mods`
Expected: FAIL — workspace `@visual-edit/code-mods` not found.

- [ ] **Step 3: Write `packages/code-mods/package.json`**

```json
{
  "name": "@visual-edit/code-mods",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@visual-edit/shared": "*",
    "@visual-edit/diagnostics": "*",
    "typescript": "^5.6.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Write `packages/code-mods/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "references": [
    { "path": "../shared" },
    { "path": "../diagnostics" }
  ],
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 5: Write `packages/code-mods/src/index.ts`**

```ts
// Public surface — populated by Tasks 2+. Re-exports kept here so consumers always import from
// '@visual-edit/code-mods' and never reach into subpaths.
export {};
```

- [ ] **Step 6: Run install + build to wire workspace**

Run: `npm install` (root)
Run: `npm run build -w @visual-edit/code-mods`
Expected: clean tsc build, produces `packages/code-mods/dist/index.js`.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -w @visual-edit/code-mods`
Expected: PASS — 1 test green.

- [ ] **Step 8: Commit**

```bash
git add packages/code-mods/ package.json package-lock.json
git commit -m "feat(code-mods): scaffold package skeleton"
```

---

### Task 2: Port `vid.ts` and `instrument.ts` from spike

**Files:**
- Create: `packages/code-mods/src/vid.ts` (port from `spike/src/vid.ts`)
- Create: `packages/code-mods/src/instrument.ts` (port from `spike/src/instrument.ts`)
- Create: `packages/code-mods/src/types.ts` (internal types — TextPatch, ElementSourceMap, AttrRange, ElementSourceMapEntry)
- Create: `packages/code-mods/tests/instrument.test.ts`
- Modify: `packages/code-mods/src/index.ts` (export `instrument`, `computeVid`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/instrument.test.ts
import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';

describe('instrument', () => {
  it('injects data-vid into a single JSX element', () => {
    const src = `export const X = () => <div className="x">hi</div>;\n`;
    const result = instrument(src, 'X.tsx');
    expect(result.instrumented).toMatch(/<div className="x" data-vid="[a-f0-9]{8}">hi<\/div>/);
    expect(Object.keys(result.sourceMap)).toHaveLength(1);
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.tagName).toBe('div');
    expect(entry.classNameAttr).not.toBeNull();
    expect(entry.styleAttr).toBeNull();
  });

  it('preserves an existing data-vid', () => {
    const src = `export const X = () => <p data-vid="abc12345">hi</p>;\n`;
    const result = instrument(src, 'X.tsx');
    expect(result.instrumented).toBe(src);
    expect(result.sourceMap['abc12345']).toBeDefined();
  });

  it('handles self-closing elements', () => {
    const src = `export const X = () => <img src="a.png" />;\n`;
    const result = instrument(src, 'X.tsx');
    expect(result.instrumented).toMatch(/<img src="a.png" data-vid="[a-f0-9]{8}" \/>/);
  });

  it('records expression-style className range', () => {
    const src = `export const X = () => <div className={cn('a', 'b')}>hi</div>;\n`;
    const result = instrument(src, 'X.tsx');
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.classNameAttr?.valueKind).toBe('expression');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/code-mods -- instrument`
Expected: FAIL — `instrument` not exported.

- [ ] **Step 3: Write `src/types.ts`** (internal — promoted to shared in Task 5)

```ts
export type ElementId = string;

export interface AttrRange {
  attrStart: number;
  attrEnd: number;
  valueStart: number;
  valueEnd: number;
  valueKind: 'string-literal' | 'expression';
}

export interface ElementSourceMapEntry {
  vid: ElementId;
  tagName: string;
  nodeStart: number;
  nodeEnd: number;
  openingTagEnd: number;
  classNameAttr: AttrRange | null;
  styleAttr: AttrRange | null;
  attrsInsertPos: number;
}

export type ElementSourceMap = Record<ElementId, ElementSourceMapEntry>;

export interface TextPatch {
  start: number;
  end: number;
  replacement: string;
  reason: string;
}

export interface InstrumentResult {
  instrumented: string;
  sourceMap: ElementSourceMap;
}
```

- [ ] **Step 4: Write `src/vid.ts`** (verbatim from `spike/src/vid.ts`)

```ts
import { createHash } from 'node:crypto';

export interface VidInput {
  filePath: string;
  start: number;
  end: number;
  tagName: string;
}

export function computeVid(input: VidInput): string {
  const key = `${input.filePath}\x00${input.start}\x00${input.end}\x00${input.tagName}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}
```

- [ ] **Step 5: Write `src/instrument.ts`** (verbatim from `spike/src/instrument.ts`, but `.ts` imports → `.js`)

```ts
import ts from 'typescript';
import { computeVid } from './vid.js';
import type {
  AttrRange,
  ElementSourceMap,
  ElementSourceMapEntry,
  InstrumentResult,
  TextPatch,
} from './types.js';

const VID_ATTR = 'data-vid';

export function instrument(source: string, filePath: string): InstrumentResult {
  const sf1 = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const patches: TextPatch[] = [];
  const visit1 = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const existingVid = readExistingVid(node, sf1);
      if (!existingVid) {
        const tagName = node.tagName.getText(sf1);
        const newVid = computeVid({
          filePath,
          start: node.getStart(sf1),
          end: node.getEnd(),
          tagName,
        });
        const insertPos = node.attributes.getEnd();
        const prevChar = source[insertPos - 1];
        const needsLeadingSpace = prevChar !== ' ' && prevChar !== '\n' && prevChar !== '\t';
        const insertion = `${needsLeadingSpace ? ' ' : ''}${VID_ATTR}="${newVid}"`;
        patches.push({
          start: insertPos,
          end: insertPos,
          replacement: insertion,
          reason: `inject ${VID_ATTR} for ${tagName}`,
        });
      }
    }
    ts.forEachChild(node, visit1);
  };
  visit1(sf1);

  const instrumented = applyPatchesToString(source, patches);

  const sf2 = ts.createSourceFile(filePath, instrumented, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sourceMap: ElementSourceMap = {};
  const visit2 = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const vid = readExistingVid(node, sf2);
      if (vid) {
        const tagName = node.tagName.getText(sf2);
        const nodeStart = node.getStart(sf2);
        const nodeEnd = node.getEnd();
        const attrsInsertPos = node.attributes.getEnd();
        sourceMap[vid] = {
          vid,
          tagName,
          nodeStart,
          nodeEnd,
          openingTagEnd: attrsInsertPos,
          classNameAttr: findAttrRange(node, sf2, 'className'),
          styleAttr: findAttrRange(node, sf2, 'style'),
          attrsInsertPos,
        };
      }
    }
    ts.forEachChild(node, visit2);
  };
  visit2(sf2);

  return { instrumented, sourceMap };
}

function readExistingVid(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
): string | null {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.getText(sf) !== VID_ATTR) continue;
    if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
      return attr.initializer.text;
    }
  }
  return null;
}

function findAttrRange(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
  attrName: string,
): AttrRange | null {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.getText(sf) !== attrName) continue;
    const initializer = attr.initializer;
    if (!initializer) return null;
    if (ts.isStringLiteral(initializer)) {
      return {
        attrStart: attr.getStart(sf),
        attrEnd: initializer.getEnd(),
        valueStart: initializer.getStart(sf) + 1,
        valueEnd: initializer.getEnd() - 1,
        valueKind: 'string-literal',
      };
    }
    if (ts.isJsxExpression(initializer)) {
      return {
        attrStart: attr.getStart(sf),
        attrEnd: initializer.getEnd(),
        valueStart: initializer.getStart(sf) + 1,
        valueEnd: initializer.getEnd() - 1,
        valueKind: 'expression',
      };
    }
    return null;
  }
  return null;
}

function applyPatchesToString(source: string, patches: TextPatch[]): string {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let out = source;
  for (const p of sorted) {
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }
  return out;
}
```

- [ ] **Step 6: Update `src/index.ts`**

```ts
export { instrument } from './instrument.js';
export { computeVid } from './vid.js';
export type {
  ElementId,
  AttrRange,
  ElementSourceMapEntry,
  ElementSourceMap,
  TextPatch,
  InstrumentResult,
} from './types.js';
```

- [ ] **Step 7: Run tests + build**

Run: `npm run build -w @visual-edit/code-mods && npm test -w @visual-edit/code-mods`
Expected: build clean, 4 tests green.

- [ ] **Step 8: Commit**

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): port instrument + vid from spike"
```

---

### Task 3: Port `planEdits` and `apply`, adapter for shared `Edit` type

**Files:**
- Create: `packages/shared/src/edit.ts` (the production `Edit` discriminated union)
- Modify: `packages/shared/src/index.ts` (export `Edit`, `StyleEdit`, `ClassNameEdit`)
- Create: `packages/code-mods/src/planEdits.ts`
- Create: `packages/code-mods/src/apply.ts`
- Create: `packages/code-mods/tests/planEdits.test.ts`
- Create: `packages/code-mods/tests/apply.test.ts`
- Modify: `packages/code-mods/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/planEdits.test.ts
import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';
import type { Edit } from '@visual-edit/shared';

describe('planEdits', () => {
  it('plans a className replacement on existing string-literal className', () => {
    const src = `export const X = () => <div className="a b">hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const edits: Edit[] = [{ kind: 'className', element: vid, newValue: 'text-red-500' }];
    const patches = planEdits(instrumented, sourceMap, edits);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.replacement).toBe('text-red-500');
    const before = sourceMap[vid]!.classNameAttr!;
    expect(patches[0]!.start).toBe(before.valueStart);
    expect(patches[0]!.end).toBe(before.valueEnd);
  });

  it('inserts new className when missing', () => {
    const src = `export const X = () => <div>hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: vid, newValue: 'p-4' },
    ]);
    expect(patches[0]!.replacement).toBe(' className="p-4"');
  });

  it('plans a style edit (object text replacement)', () => {
    const src = `export const X = () => <div style={{ color: 'blue' }}>hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'style', element: vid, newObjectText: "{ color: 'red' }" },
    ]);
    expect(patches[0]!.replacement).toBe("style={{ color: 'red' }}");
  });

  it('throws on unknown vid', () => {
    const src = `export const X = () => <div>hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    expect(() =>
      planEdits(instrumented, sourceMap, [
        { kind: 'className', element: 'deadbeef', newValue: 'x' },
      ]),
    ).toThrow(/VE_CODEMOD_001/);
  });
});
```

```ts
// packages/code-mods/tests/apply.test.ts
import { describe, it, expect } from 'vitest';
import { apply } from '../src/apply.js';

describe('apply', () => {
  it('applies a single replacement', () => {
    const src = 'hello world';
    const result = apply(src, [{ start: 6, end: 11, replacement: 'there', reason: 't' }]);
    expect(result.after).toBe('hello there');
    expect(result.before).toBe(src);
    expect(result.beforeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.afterHash).not.toBe(result.beforeHash);
  });

  it('applies multiple non-overlapping patches in any order', () => {
    const src = 'aaa bbb ccc';
    const result = apply(src, [
      { start: 8, end: 11, replacement: 'CCC', reason: 'c' },
      { start: 0, end: 3, replacement: 'AAA', reason: 'a' },
    ]);
    expect(result.after).toBe('AAA bbb CCC');
  });

  it('rejects overlapping patches', () => {
    const src = 'abcdef';
    expect(() =>
      apply(src, [
        { start: 0, end: 3, replacement: 'X', reason: '1' },
        { start: 2, end: 5, replacement: 'Y', reason: '2' },
      ]),
    ).toThrow(/overlapping patches/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @visual-edit/code-mods -- planEdits apply`
Expected: FAIL — modules + `Edit` type missing.

- [ ] **Step 3: Write `packages/shared/src/edit.ts`**

```ts
import type { ElementId } from './ids.js';

export type Edit = ClassNameEdit | StyleEdit;

export interface ClassNameEdit {
  kind: 'className';
  element: ElementId;
  newValue: string;
}

export interface StyleEdit {
  kind: 'style';
  element: ElementId;
  newObjectText: string;
}
```

- [ ] **Step 4: Update `packages/shared/src/index.ts`**

Add exports:
```ts
export type { Edit, ClassNameEdit, StyleEdit } from './edit.js';
```

(Keep all existing exports.)

- [ ] **Step 5: Add VE_CODEMOD codes to diagnostics**

Modify `packages/diagnostics/src/codes.ts` — append before `VE_INTERNAL_999_ASSERT`:

```ts
  // Code mods / commit
  VE_CODEMOD_001_UNKNOWN_VID: 'VE_CODEMOD_001',
  VE_CODEMOD_002_PARSE_AFTER_PATCH: 'VE_CODEMOD_002',
  VE_CODEMOD_003_STALE_DRY_RUN: 'VE_CODEMOD_003',
```

- [ ] **Step 6: Write `packages/code-mods/src/planEdits.ts`**

```ts
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import type { Edit } from '@visual-edit/shared';
import type { ElementSourceMap, ElementSourceMapEntry, TextPatch } from './types.js';

export function planEdits(
  source: string,
  sourceMap: ElementSourceMap,
  edits: Edit[],
): TextPatch[] {
  const patches: TextPatch[] = [];
  for (const edit of edits) {
    const entry = sourceMap[edit.element];
    if (!entry) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CODEMOD_001_UNKNOWN_VID,
        message: `[VE_CODEMOD_001]: planEdits: unknown element vid '${edit.element}'`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'tool',
        hint: 'Re-instrument the file (editor is in a stale state).',
      }));
    }
    if (edit.kind === 'className') {
      patches.push(planClassNameEdit(entry, edit.newValue));
    } else if (edit.kind === 'style') {
      patches.push(planStyleEdit(entry, edit.newObjectText));
    } else {
      const _exhaustive: never = edit;
      throw new Error(`planEdits: unsupported edit kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
  return patches;
}

function planClassNameEdit(entry: ElementSourceMapEntry, newValue: string): TextPatch {
  if (entry.classNameAttr) {
    return {
      start: entry.classNameAttr.valueStart,
      end: entry.classNameAttr.valueEnd,
      replacement: newValue,
      reason: `set className for ${entry.tagName}#${entry.vid}`,
    };
  }
  return {
    start: entry.attrsInsertPos,
    end: entry.attrsInsertPos,
    replacement: ` className="${newValue}"`,
    reason: `add className for ${entry.tagName}#${entry.vid}`,
  };
}

function planStyleEdit(entry: ElementSourceMapEntry, newObjectText: string): TextPatch {
  if (entry.styleAttr) {
    return {
      start: entry.styleAttr.attrStart,
      end: entry.styleAttr.attrEnd,
      replacement: `style={${newObjectText}}`,
      reason: `set style for ${entry.tagName}#${entry.vid}`,
    };
  }
  return {
    start: entry.attrsInsertPos,
    end: entry.attrsInsertPos,
    replacement: ` style={${newObjectText}}`,
    reason: `add style for ${entry.tagName}#${entry.vid}`,
  };
}
```

- [ ] **Step 7: Write `packages/code-mods/src/apply.ts`** (port from spike, identical semantics)

```ts
import { createHash } from 'node:crypto';
import type { TextPatch } from './types.js';

export interface ApplyResult {
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  patches: TextPatch[];
}

export function apply(source: string, patches: TextPatch[]): ApplyResult {
  const sorted = [...patches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return patches.indexOf(a) - patches.indexOf(b);
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start < prev.end) {
      throw new Error(
        `apply: overlapping patches detected: [${prev.start},${prev.end}) and [${cur.start},${cur.end})`,
      );
    }
  }

  const reversed = [...sorted].reverse();
  let out = source;
  for (const p of reversed) {
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }

  return {
    before: source,
    after: out,
    beforeHash: createHash('sha256').update(source).digest('hex'),
    afterHash: createHash('sha256').update(out).digest('hex'),
    patches,
  };
}
```

- [ ] **Step 8: Update `packages/code-mods/src/index.ts`**

```ts
export { instrument } from './instrument.js';
export { computeVid } from './vid.js';
export { planEdits } from './planEdits.js';
export { apply, type ApplyResult } from './apply.js';
export type {
  ElementId,
  AttrRange,
  ElementSourceMapEntry,
  ElementSourceMap,
  TextPatch,
  InstrumentResult,
} from './types.js';
```

- [ ] **Step 9: Build + test**

Run: `npm run build -w @visual-edit/shared @visual-edit/diagnostics @visual-edit/code-mods && npm test -w @visual-edit/code-mods`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add packages/code-mods/ packages/shared/src/edit.ts packages/shared/src/index.ts packages/diagnostics/src/codes.ts
git commit -m "feat(code-mods,shared): planEdits + apply + Edit discriminated union"
```

---

### Task 4: Port the three invariant checkers

**Files:**
- Create: `packages/code-mods/src/invariants/astEquivalence.ts` (verbatim port)
- Create: `packages/code-mods/src/invariants/commentPreservation.ts` (verbatim port)
- Create: `packages/code-mods/src/invariants/whitespacePreservation.ts` (port; `../types.ts` → `../types.js`)
- Create: `packages/code-mods/tests/invariants.test.ts`
- Modify: `packages/code-mods/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/invariants.test.ts
import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';
import { apply } from '../src/apply.js';
import {
  assertEditEquivalence,
  assertCommentsPreserved,
  assertWhitespacePreservedOutsidePatches,
} from '../src/index.js';

describe('invariants', () => {
  it('passes on a benign className edit', () => {
    const src =
      '// header comment\n' +
      'export const X = () => (\n' +
      '  <div className="old">\n' +
      '    {/* keep me */}\n' +
      '    <span>child</span>\n' +
      '  </div>\n' +
      ');\n';
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const divVid = Object.entries(sourceMap).find(([, e]) => e.tagName === 'div')![0];
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: divVid, newValue: 'new' },
    ]);
    const { after } = apply(instrumented, patches);
    expect(() => assertEditEquivalence(instrumented, after, [divVid])).not.toThrow();
    expect(() => assertCommentsPreserved(instrumented, after)).not.toThrow();
    expect(() => assertWhitespacePreservedOutsidePatches(instrumented, after, patches)).not.toThrow();
  });

  it('rejects mutation of an unrelated className', () => {
    const src = `export const X = () => <><div className="a"></div><div className="b"></div></>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vids = Object.keys(sourceMap);
    const targetVid = vids[0]!;
    // Manually corrupt the OTHER div's className.
    const corrupted = instrumented.replace('"b"', '"BAD"');
    expect(() => assertEditEquivalence(instrumented, corrupted, [targetVid])).toThrow(
      /non-targeted className/,
    );
  });

  it('rejects loss of a comment', () => {
    const src = '// keep\nexport const X = () => <div />;\n';
    const corrupted = 'export const X = () => <div />;\n';
    expect(() => assertCommentsPreserved(src, corrupted)).toThrow(/comment count mismatch/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @visual-edit/code-mods -- invariants`
Expected: FAIL — invariant modules don't exist.

- [ ] **Step 3: Copy invariants from spike**

Copy `spike/src/invariants/astEquivalence.ts` → `packages/code-mods/src/invariants/astEquivalence.ts` (no edits).

Copy `spike/src/invariants/commentPreservation.ts` → `packages/code-mods/src/invariants/commentPreservation.ts` (no edits).

Copy `spike/src/invariants/whitespacePreservation.ts` → `packages/code-mods/src/invariants/whitespacePreservation.ts` and change the single import from `../types.ts` to `../types.js`.

- [ ] **Step 4: Update `packages/code-mods/src/index.ts`**

Append:
```ts
export { assertEditEquivalence } from './invariants/astEquivalence.js';
export { assertCommentsPreserved } from './invariants/commentPreservation.js';
export { assertWhitespacePreservedOutsidePatches } from './invariants/whitespacePreservation.js';
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/code-mods && npm test -w @visual-edit/code-mods`
Expected: all green (3 invariants test + earlier tests).

- [ ] **Step 6: Commit**

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): port AST/comment/whitespace invariants from spike"
```

---

### Task 5: End-to-end pipeline test (instrument → plan → apply → invariants), confirms parity with spike

**Files:**
- Create: `packages/code-mods/src/pipeline.ts` (production wrapper that runs the full chain + invariants; mirrors `spike/src/pipeline.ts` but uses shared `Edit`)
- Create: `packages/code-mods/tests/pipeline.test.ts`
- Modify: `packages/code-mods/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { runEditPipeline } from '../src/pipeline.js';

describe('runEditPipeline', () => {
  it('end-to-end: instrument, plan, apply, validate', () => {
    const src = `// page
export default function Home() {
  return (
    <main className="p-4">
      <h1 className="text-3xl">Hello</h1>
    </main>
  );
}
`;
    const result = runEditPipeline({
      filePath: 'Home.tsx',
      source: src,
      pickEdit: (vids, sourceMap) => {
        const h1 = Object.entries(sourceMap).find(([, e]) => e.tagName === 'h1')![0];
        return { kind: 'className', element: h1, newValue: 'text-3xl text-red-500' };
      },
    });
    expect(result.after).toContain('text-3xl text-red-500');
    expect(result.after).toContain('// page'); // comment preserved
    expect(result.beforeHash).not.toBe(result.afterHash);
    expect(result.patches).toHaveLength(1);
  });

  it('throws when result fails to parse (mutateAfter corrupts)', () => {
    const src = `export const X = () => <div>hi</div>;\n`;
    expect(() =>
      runEditPipeline({
        filePath: 'X.tsx',
        source: src,
        pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'p-2' }),
        mutateAfter: (s) => s.replace('</div>', ''), // strip closing tag
      }),
    ).toThrow(/VE_CODEMOD_002/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/code-mods -- pipeline`
Expected: FAIL — `runEditPipeline` not exported.

- [ ] **Step 3: Write `packages/code-mods/src/pipeline.ts`**

```ts
import ts from 'typescript';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import type { Edit } from '@visual-edit/shared';
import { instrument } from './instrument.js';
import { planEdits } from './planEdits.js';
import { apply } from './apply.js';
import { assertEditEquivalence } from './invariants/astEquivalence.js';
import { assertCommentsPreserved } from './invariants/commentPreservation.js';
import { assertWhitespacePreservedOutsidePatches } from './invariants/whitespacePreservation.js';
import type { ElementId, ElementSourceMap, TextPatch } from './types.js';

export interface PipelineInput {
  filePath: string;
  source: string;
  pickEdit: (vids: ElementId[], sourceMap: ElementSourceMap) => Edit | Edit[];
  mutateAfter?: (after: string) => string;
}

export interface PipelineResult {
  instrumented: string;
  sourceMap: ElementSourceMap;
  edits: Edit[];
  patches: TextPatch[];
  after: string;
  beforeHash: string;
  afterHash: string;
}

export function runEditPipeline(input: PipelineInput): PipelineResult {
  const { instrumented, sourceMap } = instrument(input.source, input.filePath);
  const vids = Object.keys(sourceMap);
  if (vids.length === 0) {
    throw new Error(`pipeline: no JSX elements found in ${input.filePath}`);
  }
  const editOrEdits = input.pickEdit(vids, sourceMap);
  const edits = Array.isArray(editOrEdits) ? editOrEdits : [editOrEdits];
  const patches = planEdits(instrumented, sourceMap, edits);
  const applied = apply(instrumented, patches);
  const after = input.mutateAfter ? input.mutateAfter(applied.after) : applied.after;

  const sf = ts.createSourceFile(input.filePath, after, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diags.length > 0) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_002_PARSE_AFTER_PATCH,
      message: `[VE_CODEMOD_002]: result fails to parse: ${diags.map((d) => d.messageText).join('; ')}`,
      severity: 'fatal',
      recovery: 'unrecoverable',
      blame: 'tool',
      hint: 'Report this with the input file and applied edits.',
    }));
  }

  const targetedVids = edits.map((e) => e.element);
  assertEditEquivalence(instrumented, after, targetedVids);
  assertCommentsPreserved(instrumented, after);
  assertWhitespacePreservedOutsidePatches(instrumented, after, patches);

  return {
    instrumented,
    sourceMap,
    edits,
    patches,
    after,
    beforeHash: applied.beforeHash,
    afterHash: applied.afterHash,
  };
}
```

- [ ] **Step 4: Update `packages/code-mods/src/index.ts`**

Append:
```ts
export { runEditPipeline, type PipelineInput, type PipelineResult } from './pipeline.js';
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/code-mods && npm test -w @visual-edit/code-mods`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): runEditPipeline with full invariant chain"
```

---

## Sub-phase 1.B-2 — Commit pipeline

### Task 6: Backups module (Windows-safe write to `.visual-edit/backups/`)

**Files:**
- Create: `packages/code-mods/src/backups.ts`
- Create: `packages/code-mods/tests/backups.test.ts`
- Modify: `packages/code-mods/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/backups.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBackup, readBackup, listBackups } from '../src/backups.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-backups-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('backups', () => {
  it('writes backup file at .visual-edit/backups/<basename>-<commitId>', () => {
    const file = join(tmp, 'src', 'pages', 'Home.tsx');
    mkdirSync(join(tmp, 'src', 'pages'), { recursive: true });
    writeFileSync(file, 'original content', 'utf8');
    writeBackup({ root: tmp, filePath: file, commitId: 'c0ffee01', content: 'original content' });
    const backupPath = join(tmp, '.visual-edit', 'backups', 'Home.tsx-c0ffee01');
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf8')).toBe('original content');
  });

  it('readBackup returns the persisted content', () => {
    const file = join(tmp, 'a.tsx');
    writeFileSync(file, 'hi', 'utf8');
    writeBackup({ root: tmp, filePath: file, commitId: 'aa', content: 'hi' });
    expect(readBackup({ root: tmp, filePath: file, commitId: 'aa' })).toBe('hi');
  });

  it('listBackups returns commit ids for the file in mtime order', () => {
    const file = join(tmp, 'b.tsx');
    writeFileSync(file, 'x', 'utf8');
    writeBackup({ root: tmp, filePath: file, commitId: 'aa', content: 'v1' });
    writeBackup({ root: tmp, filePath: file, commitId: 'bb', content: 'v2' });
    const ids = listBackups({ root: tmp, filePath: file });
    expect(ids).toEqual(['aa', 'bb']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/code-mods -- backups`
Expected: FAIL — `backups` module missing.

- [ ] **Step 3: Write `packages/code-mods/src/backups.ts`**

```ts
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

export interface BackupOps {
  root: string;        // project root (visual-edit.config.ts root)
  filePath: string;    // absolute path of the user file being backed up
  commitId: string;    // assigned by commit pipeline
  content: string;     // exact bytes to persist (pre-commit)
}

function backupsDir(root: string): string {
  return join(root, '.visual-edit', 'backups');
}

function backupPath(root: string, filePath: string, commitId: string): string {
  return join(backupsDir(root), `${basename(filePath)}-${commitId}`);
}

export function writeBackup(opts: BackupOps): string {
  const dir = backupsDir(opts.root);
  mkdirSync(dir, { recursive: true });
  const path = backupPath(opts.root, opts.filePath, opts.commitId);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, opts.content, 'utf8');
  // fsync so the bytes hit the platter before we trust the backup.
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  // Rename is atomic on the same filesystem.
  // Using fs.rename via writeFileSync semantics; on Windows we rely on the OS rename behavior.
  // Node's `renameSync` is what we want here.
  // (writeFileSync above already wrote the data; now atomic-rename.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renameSync } = require('node:fs') as typeof import('node:fs');
  renameSync(tmp, path);
  return path;
}

export function readBackup(opts: { root: string; filePath: string; commitId: string }): string {
  const path = backupPath(opts.root, opts.filePath, opts.commitId);
  if (!existsSync(path)) throw new Error(`backup not found: ${path}`);
  return readFileSync(path, 'utf8');
}

export function listBackups(opts: { root: string; filePath: string }): string[] {
  const dir = backupsDir(opts.root);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(opts.filePath)}-`;
  const entries = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs, id: name.slice(prefix.length) }))
    .sort((a, b) => a.mtime - b.mtime);
  return entries.map((e) => e.id);
}

// Keep dirname import used to satisfy linter on unused import warnings.
void dirname;
```

(Remove the unused `dirname` and the `require` shim by switching to a top-level `import { renameSync }` — corrected version below.)

Replace the previous body with the cleaner version:

```ts
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { join, basename } from 'node:path';

export interface BackupOps {
  root: string;
  filePath: string;
  commitId: string;
  content: string;
}

function backupsDir(root: string): string {
  return join(root, '.visual-edit', 'backups');
}

function backupPath(root: string, filePath: string, commitId: string): string {
  return join(backupsDir(root), `${basename(filePath)}-${commitId}`);
}

export function writeBackup(opts: BackupOps): string {
  const dir = backupsDir(opts.root);
  mkdirSync(dir, { recursive: true });
  const path = backupPath(opts.root, opts.filePath, opts.commitId);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, opts.content, 'utf8');
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  return path;
}

export function readBackup(opts: { root: string; filePath: string; commitId: string }): string {
  const path = backupPath(opts.root, opts.filePath, opts.commitId);
  if (!existsSync(path)) throw new Error(`backup not found: ${path}`);
  return readFileSync(path, 'utf8');
}

export function listBackups(opts: { root: string; filePath: string }): string[] {
  const dir = backupsDir(opts.root);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(opts.filePath)}-`;
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs, id: name.slice(prefix.length) }))
    .sort((a, b) => a.mtime - b.mtime)
    .map((e) => e.id);
}
```

- [ ] **Step 4: Update `packages/code-mods/src/index.ts`**

Append:
```ts
export { writeBackup, readBackup, listBackups, type BackupOps } from './backups.js';
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/code-mods && npm test -w @visual-edit/code-mods -- backups`
Expected: 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): backups module with fsync + atomic rename"
```

---

### Task 7: Commit log (append-only JSON, ordered by commit time)

**Files:**
- Create: `packages/code-mods/src/commitLog.ts`
- Create: `packages/code-mods/tests/commitLog.test.ts`
- Modify: `packages/code-mods/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/commitLog.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCommit, readCommitLog, findCommit, type CommitLogEntry } from '../src/commitLog.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cl-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('commitLog', () => {
  it('appends entries and reads them back in order', () => {
    const e1: CommitLogEntry = {
      commitId: 'aa', filePath: '/a.tsx', sha256Before: 'b', sha256After: 'a', kind: 'commit', timestamp: 't1',
    };
    const e2: CommitLogEntry = {
      commitId: 'bb', filePath: '/a.tsx', sha256Before: 'a', sha256After: 'c', kind: 'commit', timestamp: 't2',
    };
    appendCommit(tmp, e1);
    appendCommit(tmp, e2);
    expect(readCommitLog(tmp)).toEqual([e1, e2]);
  });

  it('findCommit returns the entry by id (latest match if duplicated)', () => {
    appendCommit(tmp, { commitId: 'aa', filePath: '/a.tsx', sha256Before: '1', sha256After: '2', kind: 'commit', timestamp: 't1' });
    appendCommit(tmp, { commitId: 'aa', filePath: '/a.tsx', sha256Before: '2', sha256After: '1', kind: 'rollback', timestamp: 't2', rollbackOf: 'aa' });
    const found = findCommit(tmp, 'aa');
    expect(found?.kind).toBe('rollback');
  });

  it('persists as JSONL on disk for crash safety', () => {
    appendCommit(tmp, { commitId: 'cc', filePath: '/x.tsx', sha256Before: 'x', sha256After: 'y', kind: 'commit', timestamp: 't' });
    const raw = readFileSync(join(tmp, '.visual-edit', 'commit-log.jsonl'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(raw.trim())).toMatchObject({ commitId: 'cc' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/code-mods -- commitLog`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `packages/code-mods/src/commitLog.ts`**

```ts
import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';

export interface CommitLogEntry {
  commitId: string;
  filePath: string;
  sha256Before: string;
  sha256After: string;
  kind: 'commit' | 'rollback' | 'instrument';
  timestamp: string;
  rollbackOf?: string;
}

function logPath(root: string): string {
  return join(root, '.visual-edit', 'commit-log.jsonl');
}

export function appendCommit(root: string, entry: CommitLogEntry): void {
  mkdirSync(join(root, '.visual-edit'), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  appendFileSync(logPath(root), line, 'utf8');
  // fsync so the entry survives a crash before the next operation.
  const fd = openSync(logPath(root), 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function readCommitLog(root: string): CommitLogEntry[] {
  const p = logPath(root);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((s) => s.trim().length > 0)
    .map((line) => JSON.parse(line) as CommitLogEntry);
}

export function findCommit(root: string, commitId: string): CommitLogEntry | null {
  const all = readCommitLog(root);
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.commitId === commitId) return all[i]!;
  }
  return null;
}
```

- [ ] **Step 4: Update `packages/code-mods/src/index.ts`**

Append:
```ts
export { appendCommit, readCommitLog, findCommit, type CommitLogEntry } from './commitLog.js';
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/code-mods && npm test -w @visual-edit/code-mods -- commitLog`
Expected: 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): append-only JSONL commit log"
```

---

### Task 8: `commit()` — Windows-safe atomic write with retry/verify

**Files:**
- Create: `packages/code-mods/src/commit.ts`
- Create: `packages/code-mods/tests/commit.test.ts`
- Modify: `packages/diagnostics/src/codes.ts` (add `VE_FS_002_RENAME_RETRY_EXHAUSTED`, `VE_FS_003_VERIFY_MISMATCH`, `VE_CODEMOD_003_STALE_DRY_RUN` already exists)
- Modify: `packages/code-mods/src/index.ts`

- [ ] **Step 1: Add the new diagnostic codes**

In `packages/diagnostics/src/codes.ts`, append before `VE_INTERNAL_999_ASSERT`:

```ts
  VE_FS_002_RENAME_RETRY_EXHAUSTED: 'VE_FS_002',
  VE_FS_003_VERIFY_MISMATCH: 'VE_FS_003',
```

Run `npm run build -w @visual-edit/diagnostics`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/code-mods/tests/commit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { commit, type CommitInput } from '../src/commit.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-commit-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('commit', () => {
  it('writes the new content, creates backup, appends commit log entry', async () => {
    const file = join(tmp, 'src', 'p.tsx');
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(file, 'OLD', 'utf8');
    const result = await commit({
      root: tmp,
      filePath: file,
      expectedBeforeHash: sha('OLD'),
      newContent: 'NEW',
    } satisfies CommitInput);
    expect(result.status).toBe('committed');
    expect(readFileSync(file, 'utf8')).toBe('NEW');
    expect(result.sha256After).toBe(sha('NEW'));
  });

  it('rejects when current file content does not match expectedBeforeHash', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'CURRENT', 'utf8');
    await expect(
      commit({
        root: tmp,
        filePath: file,
        expectedBeforeHash: sha('STALE'),
        newContent: 'NEW',
      }),
    ).rejects.toThrow(/VE_CODEMOD_003/);
    // Source untouched.
    expect(readFileSync(file, 'utf8')).toBe('CURRENT');
  });

  it('returns commit-uncertain after retries exhausted (simulated rename failure)', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'OLD', 'utf8');
    let attempts = 0;
    const result = await commit({
      root: tmp,
      filePath: file,
      expectedBeforeHash: sha('OLD'),
      newContent: 'NEW',
      // Test hook: throw EPERM on every rename attempt.
      _renameImpl: () => { attempts++; const e: NodeJS.ErrnoException = new Error('EPERM'); e.code = 'EPERM'; throw e; },
    });
    expect(result.status).toBe('commit-uncertain');
    expect(attempts).toBe(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @visual-edit/code-mods -- commit`
Expected: FAIL — `commit` module missing.

- [ ] **Step 4: Write `packages/code-mods/src/commit.ts`**

```ts
import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { writeBackup } from './backups.js';
import { appendCommit } from './commitLog.js';

export interface CommitInput {
  root: string;
  filePath: string;
  expectedBeforeHash: string;
  newContent: string;
  /** Test hook only — production code uses Node's fs.renameSync. */
  _renameImpl?: (from: string, to: string) => void;
}

export interface CommitResult {
  commitId: string;
  filePath: string;
  sha256Before: string;
  sha256After: string;
  status: 'committed' | 'commit-uncertain';
  retries: number;
  lastError?: string;
}

const RETRY_BACKOFFS_MS = [100, 400, 900]; // 3 attempts total

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function commit(input: CommitInput): Promise<CommitResult> {
  const current = readFileSync(input.filePath, 'utf8');
  const currentHash = sha(current);
  if (currentHash !== input.expectedBeforeHash) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_003_STALE_DRY_RUN,
      message: `[VE_CODEMOD_003]: file ${input.filePath} sha mismatch — expected ${input.expectedBeforeHash.slice(0, 8)}, found ${currentHash.slice(0, 8)}`,
      severity: 'error',
      recovery: 'user-action',
      blame: 'environment',
      hint: 'The file changed since the dry-run. Re-plan and try again.',
    }));
  }

  const commitId = randomBytes(4).toString('hex');
  const sha256Before = currentHash;
  const sha256After = sha(input.newContent);

  // Backup BEFORE we touch the file (so rollback is always possible).
  writeBackup({ root: input.root, filePath: input.filePath, commitId, content: current });

  const renameFn = input._renameImpl ?? renameSync;
  let lastError: string | undefined;
  let attempts = 0;

  for (let i = 0; i < RETRY_BACKOFFS_MS.length; i++) {
    attempts = i + 1;
    const tmp = `${input.filePath}.${commitId}.tmp`;
    try {
      writeFileSync(tmp, input.newContent, 'utf8');
      const fd = openSync(tmp, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameFn(tmp, input.filePath);
      // Verify by reading back from disk.
      const verify = sha(readFileSync(input.filePath, 'utf8'));
      if (verify !== sha256After) {
        lastError = `verify-mismatch: expected ${sha256After.slice(0, 8)}, found ${verify.slice(0, 8)}`;
        continue;
      }
      appendCommit(input.root, {
        commitId,
        filePath: input.filePath,
        sha256Before,
        sha256After,
        kind: 'commit',
        timestamp: new Date().toISOString(),
      });
      return { commitId, filePath: input.filePath, sha256Before, sha256After, status: 'committed', retries: i };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      lastError = `${e.code ?? 'ERR'}: ${e.message}`;
      if (i < RETRY_BACKOFFS_MS.length - 1) await sleep(RETRY_BACKOFFS_MS[i]!);
    }
  }

  // All retries failed — return commit-uncertain. Editor reloads + re-fetches sha to verify.
  return {
    commitId,
    filePath: input.filePath,
    sha256Before,
    sha256After,
    status: 'commit-uncertain',
    retries: attempts,
    lastError,
  };
}
```

- [ ] **Step 5: Update `packages/code-mods/src/index.ts`**

Append:
```ts
export { commit, type CommitInput, type CommitResult } from './commit.js';
```

- [ ] **Step 6: Build + test**

Run: `npm run build -w @visual-edit/diagnostics @visual-edit/code-mods && npm test -w @visual-edit/code-mods -- commit`
Expected: 3 tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/code-mods/ packages/diagnostics/src/codes.ts
git commit -m "feat(code-mods): Windows-safe commit with retry+verify+commit-uncertain"
```

---

### Task 9: `rollback()` — restore from backup with sha verification

**Files:**
- Create: `packages/code-mods/src/rollback.ts`
- Create: `packages/code-mods/tests/rollback.test.ts`
- Modify: `packages/code-mods/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/code-mods/tests/rollback.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { commit } from '../src/commit.js';
import { rollback } from '../src/rollback.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-rb-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('rollback', () => {
  it('restores the pre-commit content and appends a rollback log entry', async () => {
    const file = join(tmp, 'src', 'p.tsx');
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(file, 'V1', 'utf8');
    const result = await commit({
      root: tmp, filePath: file, expectedBeforeHash: sha('V1'), newContent: 'V2',
    });
    expect(readFileSync(file, 'utf8')).toBe('V2');
    await rollback({ root: tmp, commitId: result.commitId });
    expect(readFileSync(file, 'utf8')).toBe('V1');
  });

  it('refuses to rollback if current file sha != commit.sha256After (ambiguous)', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'V1', 'utf8');
    const r = await commit({ root: tmp, filePath: file, expectedBeforeHash: sha('V1'), newContent: 'V2' });
    // External edit between commit and rollback.
    writeFileSync(file, 'EXTERNAL', 'utf8');
    await expect(rollback({ root: tmp, commitId: r.commitId })).rejects.toThrow(/VE_FS_003/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/code-mods -- rollback`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `packages/code-mods/src/rollback.ts`**

```ts
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import { findCommit, appendCommit } from './commitLog.js';
import { readBackup } from './backups.js';

export interface RollbackInput {
  root: string;
  commitId: string;
}

export interface RollbackResult {
  commitId: string;          // the rollback's own id
  rollbackOf: string;
  filePath: string;
  sha256Before: string;
  sha256After: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function rollback(input: RollbackInput): Promise<RollbackResult> {
  const original = findCommit(input.root, input.commitId);
  if (!original) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_003_STALE_DRY_RUN,
      message: `[VE_CODEMOD_003]: rollback target commit '${input.commitId}' not found in commit log`,
      severity: 'error',
      recovery: 'user-action',
      blame: 'user-config',
    }));
  }
  if (original.kind !== 'commit') {
    throw new Error(`rollback: target ${input.commitId} is not a forward commit`);
  }
  const current = readFileSync(original.filePath, 'utf8');
  const currentHash = sha(current);
  if (currentHash !== original.sha256After) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_FS_003_VERIFY_MISMATCH,
      message: `[VE_FS_003]: cannot rollback — file ${original.filePath} no longer matches commit's sha256After`,
      severity: 'error',
      recovery: 'user-action',
      blame: 'environment',
      hint: 'The file was modified after this commit. Resolve manually before rollback.',
    }));
  }
  const restored = readBackup({ root: input.root, filePath: original.filePath, commitId: original.commitId });
  // Atomic write the restored content.
  const tmp = `${original.filePath}.rb.tmp`;
  writeFileSync(tmp, restored, 'utf8');
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, original.filePath);

  const newCommitId = randomBytes(4).toString('hex');
  appendCommit(input.root, {
    commitId: newCommitId,
    filePath: original.filePath,
    sha256Before: original.sha256After,
    sha256After: original.sha256Before,
    kind: 'rollback',
    timestamp: new Date().toISOString(),
    rollbackOf: original.commitId,
  });

  return {
    commitId: newCommitId,
    rollbackOf: original.commitId,
    filePath: original.filePath,
    sha256Before: original.sha256After,
    sha256After: original.sha256Before,
  };
}
```

- [ ] **Step 4: Update `packages/code-mods/src/index.ts`**

Append:
```ts
export { rollback, type RollbackInput, type RollbackResult } from './rollback.js';
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/code-mods && npm test -w @visual-edit/code-mods -- rollback`
Expected: 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): rollback with sha verification + log append"
```

---

### Task 10: Extend protocol WS messages (edit, dry-run, commit, commit-ok, commit-uncertain, file-changed, error) and snapshot

**Files:**
- Modify: `packages/protocol/src/ws.ts`
- Create: `packages/protocol/tests/ws.editing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/tests/ws.editing.test.ts
import { describe, it, expect } from 'vitest';
import {
  WsEditMessage,
  WsDryRunMessage,
  WsCommitMessage,
  WsCommitOkMessage,
  WsCommitUncertainMessage,
  WsFileChangedMessage,
  WsErrorMessage,
  WsSnapshotMessage,
} from '../src/ws.js';

describe('ws editing schemas', () => {
  it('parses an edit message with a single className edit', () => {
    const parsed = WsEditMessage.parse({
      kind: 'edit',
      requestId: 'req1',
      sessionId: 's1',
      edits: [{ kind: 'className', element: 'abc12345', newValue: 'p-4' }],
    });
    expect(parsed.edits).toHaveLength(1);
  });

  it('parses a dry-run reply with patches + hashes', () => {
    expect(() => WsDryRunMessage.parse({
      kind: 'dry-run',
      requestId: 'req1',
      sessionId: 's1',
      planId: 'plan1',
      filePath: '/abs/Home.tsx',
      patches: [{ start: 0, end: 1, replacement: 'x', reason: 'r' }],
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64),
    })).not.toThrow();
  });

  it('parses commit + commit-ok + commit-uncertain', () => {
    WsCommitMessage.parse({ kind: 'commit', requestId: 'r', sessionId: 's', planId: 'p' });
    WsCommitOkMessage.parse({ kind: 'commit-ok', requestId: 'r', sessionId: 's', commitId: 'c' });
    WsCommitUncertainMessage.parse({ kind: 'commit-uncertain', requestId: 'r', sessionId: 's', lastError: 'EPERM' });
  });

  it('parses file-changed and error messages', () => {
    WsFileChangedMessage.parse({ kind: 'file-changed', sessionId: 's', filePath: '/abs/x.tsx', sha256: 'a'.repeat(64), dirtySourceMap: true });
    WsErrorMessage.parse({ kind: 'error', sessionId: 's', code: 'VE_CODEMOD_003', message: 'stale' });
  });

  it('snapshot now carries sourceMap, sourceText, editorUrl', () => {
    const m = WsSnapshotMessage.parse({
      kind: 'snapshot',
      sessionId: 's1',
      url: 'http://127.0.0.1:5180',
      status: 'ready',
      filePath: '/abs/Home.tsx',
      sourceText: 'export const X = () => <div />;\n',
      sourceMap: { abc12345: { vid: 'abc12345', tagName: 'div', nodeStart: 0, nodeEnd: 10, openingTagEnd: 5, classNameAttr: null, styleAttr: null, attrsInsertPos: 5 } },
      editorUrl: 'http://127.0.0.1:5170/__editor/?session=s1',
    });
    expect(m.sourceMap['abc12345']!.tagName).toBe('div');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/protocol -- ws.editing`
Expected: FAIL — schemas missing.

- [ ] **Step 3: Update `packages/protocol/src/ws.ts`**

Replace the file with:

```ts
import { z } from 'zod';

const HEX_64 = z.string().regex(/^[a-f0-9]{64}$/);
const SHORT_HEX = z.string().regex(/^[a-f0-9]+$/);

export const WsHelloMessage = z.object({
  kind: z.literal('hello'),
  version: z.literal('1.0'),
  sessionId: z.string().min(1),
});
export type WsHelloMessage = z.infer<typeof WsHelloMessage>;

const AttrRangeSchema = z.object({
  attrStart: z.number().int().nonnegative(),
  attrEnd: z.number().int().nonnegative(),
  valueStart: z.number().int().nonnegative(),
  valueEnd: z.number().int().nonnegative(),
  valueKind: z.enum(['string-literal', 'expression']),
}).nullable();

const ElementSourceMapEntrySchema = z.object({
  vid: SHORT_HEX,
  tagName: z.string().min(1),
  nodeStart: z.number().int().nonnegative(),
  nodeEnd: z.number().int().nonnegative(),
  openingTagEnd: z.number().int().nonnegative(),
  classNameAttr: AttrRangeSchema,
  styleAttr: AttrRangeSchema,
  attrsInsertPos: z.number().int().nonnegative(),
});

export const WsSnapshotMessage = z.object({
  kind: z.literal('snapshot'),
  sessionId: z.string().min(1),
  url: z.string().url(),
  status: z.enum(['starting', 'ready', 'crashed', 'closed']),
  filePath: z.string().min(1),
  sourceText: z.string(),
  sourceMap: z.record(SHORT_HEX, ElementSourceMapEntrySchema),
  editorUrl: z.string().url(),
});
export type WsSnapshotMessage = z.infer<typeof WsSnapshotMessage>;

export const WsByeMessage = z.object({
  kind: z.literal('bye'),
  sessionId: z.string().min(1),
});
export type WsByeMessage = z.infer<typeof WsByeMessage>;

const ClassNameEditSchema = z.object({
  kind: z.literal('className'),
  element: SHORT_HEX,
  newValue: z.string(),
});
const StyleEditSchema = z.object({
  kind: z.literal('style'),
  element: SHORT_HEX,
  newObjectText: z.string(),
});
const EditSchema = z.union([ClassNameEditSchema, StyleEditSchema]);

export const WsEditMessage = z.object({
  kind: z.literal('edit'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  edits: z.array(EditSchema).min(1),
});
export type WsEditMessage = z.infer<typeof WsEditMessage>;

const TextPatchSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  replacement: z.string(),
  reason: z.string(),
});

export const WsDryRunMessage = z.object({
  kind: z.literal('dry-run'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  planId: z.string().min(1),
  filePath: z.string().min(1),
  patches: z.array(TextPatchSchema),
  beforeHash: HEX_64,
  afterHash: HEX_64,
});
export type WsDryRunMessage = z.infer<typeof WsDryRunMessage>;

export const WsCommitMessage = z.object({
  kind: z.literal('commit'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  planId: z.string().min(1),
});
export type WsCommitMessage = z.infer<typeof WsCommitMessage>;

export const WsCommitOkMessage = z.object({
  kind: z.literal('commit-ok'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  commitId: z.string().min(1),
});
export type WsCommitOkMessage = z.infer<typeof WsCommitOkMessage>;

export const WsCommitUncertainMessage = z.object({
  kind: z.literal('commit-uncertain'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  lastError: z.string(),
});
export type WsCommitUncertainMessage = z.infer<typeof WsCommitUncertainMessage>;

export const WsFileChangedMessage = z.object({
  kind: z.literal('file-changed'),
  sessionId: z.string().min(1),
  filePath: z.string().min(1),
  sha256: HEX_64,
  dirtySourceMap: z.boolean(),
});
export type WsFileChangedMessage = z.infer<typeof WsFileChangedMessage>;

export const WsErrorMessage = z.object({
  kind: z.literal('error'),
  sessionId: z.string().min(1),
  code: z.string().min(1),
  message: z.string(),
  requestId: z.string().optional(),
});
export type WsErrorMessage = z.infer<typeof WsErrorMessage>;

export const WsMessage = z.union([
  WsHelloMessage,
  WsSnapshotMessage,
  WsByeMessage,
  WsEditMessage,
  WsDryRunMessage,
  WsCommitMessage,
  WsCommitOkMessage,
  WsCommitUncertainMessage,
  WsFileChangedMessage,
  WsErrorMessage,
]);
export type WsMessage = z.infer<typeof WsMessage>;
```

- [ ] **Step 4: Build + test**

Run: `npm run build -w @visual-edit/protocol && npm test -w @visual-edit/protocol`
Expected: all tests green (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/
git commit -m "feat(protocol): WS schemas for edit/dry-run/commit/commit-ok/commit-uncertain/file-changed/error + extended snapshot"
```

---

### Task 11: Daemon `EditPipeline` worker — wire planEdits → apply → commit through WS

**Files:**
- Create: `packages/daemon/src/editPipeline.ts`
- Create: `packages/daemon/tests/editPipeline.test.ts`
- Modify: `packages/daemon/src/ws.ts` (route edit/commit messages)
- Modify: `packages/daemon/src/daemon.ts` (instantiate one EditPipeline per session, wire to WS)
- Modify: `packages/daemon/package.json` (add `@visual-edit/code-mods` dep)
- Modify: `packages/daemon/tsconfig.json` (add reference to `code-mods`)

- [ ] **Step 1: Add the dep**

In `packages/daemon/package.json` `dependencies`:
```json
"@visual-edit/code-mods": "*"
```

In `packages/daemon/tsconfig.json` `references`:
```json
{ "path": "../code-mods" }
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

```ts
// packages/daemon/tests/editPipeline.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditPipeline } from '../src/editPipeline.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-ep-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('EditPipeline', () => {
  it('instruments file once, plans+applies a className edit, dry-run sha matches commit', async () => {
    const file = join(tmp, 'src', 'Home.tsx');
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(file, 'export const X = () => <div className="a">x</div>;\n', 'utf8');
    const ep = new EditPipeline({ root: tmp, filePath: file });
    const { sourceMap } = await ep.getSnapshot();
    const vid = Object.keys(sourceMap)[0]!;

    const dry = await ep.planAndApply([{ kind: 'className', element: vid, newValue: 'b' }]);
    expect(dry.patches).toHaveLength(1);
    expect(dry.beforeHash).toMatch(/^[a-f0-9]{64}$/);

    const commit = await ep.commit(dry.planId);
    expect(commit.status).toBe('committed');
    expect(readFileSync(file, 'utf8')).toContain('className="b"');
  });

  it('rejects commit with unknown planId', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'export const X = () => <div />;\n', 'utf8');
    const ep = new EditPipeline({ root: tmp, filePath: file });
    await expect(ep.commit('bogus')).rejects.toThrow(/unknown planId/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @visual-edit/daemon -- editPipeline`
Expected: FAIL — module missing.

- [ ] **Step 4: Write `packages/daemon/src/editPipeline.ts`**

```ts
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import {
  instrument,
  planEdits,
  apply,
  commit as commitWrite,
  rollback as rollbackWrite,
  writeBackup,
  appendCommit,
  type ElementSourceMap,
  type TextPatch,
  type CommitResult,
} from '@visual-edit/code-mods';
import type { Edit } from '@visual-edit/shared';

export interface EditPipelineOpts {
  root: string;
  filePath: string;
  /** Called after any disk write the pipeline performs (initial instrument, commit, rollback). */
  onSelfWrite?: (filePath: string, sha256: string) => void;
}

export interface DryRunArtifact {
  planId: string;
  patches: TextPatch[];
  beforeHash: string;
  afterHash: string;
  newContent: string;
}

export interface InstrumentSnapshot {
  sourceText: string;       // instrumented source (with data-vid attributes injected)
  sourceMap: ElementSourceMap;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Per-session, per-file edit pipeline.
 *
 * - Caches the instrumented source + sourceMap (lazy first call).
 * - Persists data-vid attributes to disk on first instrument so subsequent runs are stable
 *   and the editor's selectors remain valid across edits.
 * - Initial instrumentation goes through backup + commit log (kind: 'instrument') and
 *   registers self-write so FileWatcher doesn't fire spurious external-change events.
 * - Holds dry-run artifacts in-memory keyed by planId; commit() consumes them.
 */
export class EditPipeline {
  private snapshot: InstrumentSnapshot | null = null;
  private dryRuns = new Map<string, DryRunArtifact>();

  constructor(private opts: EditPipelineOpts) {}

  /** Public so WS handlers don't need to cast. */
  getFilePath(): string { return this.opts.filePath; }

  async getSnapshot(): Promise<InstrumentSnapshot> {
    if (this.snapshot) return this.snapshot;
    const original = readFileSync(this.opts.filePath, 'utf8');
    const { instrumented, sourceMap } = instrument(original, this.opts.filePath);
    if (instrumented !== original) {
      const commitId = randomBytes(4).toString('hex');
      const beforeHash = sha(original);
      const afterHash = sha(instrumented);
      // Backup the pre-instrument content so we can revert if needed.
      writeBackup({ root: this.opts.root, filePath: this.opts.filePath, commitId, content: original });
      // Atomic write so a crash mid-write doesn't leave a partial file.
      const tmp = `${this.opts.filePath}.${commitId}.tmp`;
      writeFileSync(tmp, instrumented, 'utf8');
      const fd = openSync(tmp, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, this.opts.filePath);
      // Audit trail.
      appendCommit(this.opts.root, {
        commitId,
        filePath: this.opts.filePath,
        sha256Before: beforeHash,
        sha256After: afterHash,
        kind: 'instrument',
        timestamp: new Date().toISOString(),
      });
      // Tell FileWatcher this is our write.
      this.opts.onSelfWrite?.(this.opts.filePath, afterHash);
    }
    this.snapshot = { sourceText: instrumented, sourceMap };
    return this.snapshot;
  }

  async planAndApply(edits: Edit[]): Promise<DryRunArtifact> {
    const snap = await this.getSnapshot();
    const patches = planEdits(snap.sourceText, snap.sourceMap, edits);
    const applied = apply(snap.sourceText, patches);
    const planId = randomBytes(4).toString('hex');
    const artifact: DryRunArtifact = {
      planId,
      patches,
      beforeHash: applied.beforeHash,
      afterHash: applied.afterHash,
      newContent: applied.after,
    };
    this.dryRuns.set(planId, artifact);
    return artifact;
  }

  async commit(planId: string): Promise<CommitResult> {
    const dr = this.dryRuns.get(planId);
    if (!dr) throw new Error(`commit: unknown planId ${planId}`);
    const result = await commitWrite({
      root: this.opts.root,
      filePath: this.opts.filePath,
      expectedBeforeHash: dr.beforeHash,
      newContent: dr.newContent,
    });
    if (result.status === 'committed') {
      this.opts.onSelfWrite?.(this.opts.filePath, result.sha256After);
      // Refresh snapshot from the new disk content (vids are unchanged; positions shifted).
      const newContent = readFileSync(this.opts.filePath, 'utf8');
      const re = instrument(newContent, this.opts.filePath);
      this.snapshot = { sourceText: re.instrumented, sourceMap: re.sourceMap };
      this.dryRuns.delete(planId);
    }
    return result;
  }

  async rollback(commitId: string): Promise<void> {
    await rollbackWrite({ root: this.opts.root, commitId });
    const newContent = readFileSync(this.opts.filePath, 'utf8');
    this.opts.onSelfWrite?.(this.opts.filePath, sha(newContent));
    const re = instrument(newContent, this.opts.filePath);
    this.snapshot = { sourceText: re.instrumented, sourceMap: re.sourceMap };
  }
}
```

- [ ] **Step 5: Update `packages/daemon/src/daemon.ts`**

Add a per-session map of EditPipelines, populated when a preview opens, exposed to the WS handler.

In the `Daemon` class, add:

```ts
private editPipelines = new Map<string, EditPipeline>();
```

After `await this.supervisor.spawn(sessionId, adapterInput);` in `openPreview`, append:

```ts
this.editPipelines.set(sessionId, new EditPipeline({
  root: this.opts.root,
  filePath: matchedPage.filePath,
}));
```

In `closePreview`, append:

```ts
this.editPipelines.delete(req.sessionId);
```

Update the `attachWebSocket` call to also pass:

```ts
this.wsServer = attachWebSocket(this.httpServer, {
  getSession: (id) => this.supervisor.list().find((s) => s.id === id) ?? null,
  getPipeline: (id) => this.editPipelines.get(id) ?? null,
  daemonPort: () => this.actualPort!,
});
```

Add the import at the top:
```ts
import { EditPipeline } from './editPipeline.js';
```

- [ ] **Step 6: Update `packages/daemon/src/ws.ts`** to handle edit/commit/rollback

Replace the file with:

```ts
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  WsHelloMessage,
  WsEditMessage,
  WsCommitMessage,
  type WsSnapshotMessage,
  type WsDryRunMessage,
  type WsCommitOkMessage,
  type WsCommitUncertainMessage,
  type WsErrorMessage,
} from '@visual-edit/protocol';
import type { PreviewSession } from '@visual-edit/shared';
import type { EditPipeline } from './editPipeline.js';

export interface WsHandlers {
  getSession: (sessionId: string) => PreviewSession | null;
  getPipeline: (sessionId: string) => EditPipeline | null;
  daemonPort: () => number;
}

export function attachWebSocket(http: Server, handlers: WsHandlers): WebSocketServer {
  const wss = new WebSocketServer({ server: http, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    let sessionId: string | null = null;

    socket.on('message', async (raw) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString()); }
      catch { socket.close(1003, 'invalid json'); return; }

      const obj = parsed as { kind?: string };

      if (obj.kind === 'hello') {
        const hello = WsHelloMessage.safeParse(parsed);
        if (!hello.success) { socket.close(1003, 'expected hello'); return; }
        const session = handlers.getSession(hello.data.sessionId);
        const pipeline = handlers.getPipeline(hello.data.sessionId);
        if (!session || !pipeline) { socket.close(1008, 'unknown session'); return; }
        sessionId = session.id;
        const snap = await pipeline.getSnapshot();
        const editorUrl = `http://127.0.0.1:${handlers.daemonPort()}/__editor/?session=${session.id}`;
        const filePath = pipeline.getFilePath();
        const msg: WsSnapshotMessage = {
          kind: 'snapshot',
          sessionId: session.id,
          url: session.url,
          status: session.status,
          filePath,
          sourceText: snap.sourceText,
          sourceMap: snap.sourceMap,
          editorUrl,
        };
        socket.send(JSON.stringify(msg));
        return;
      }

      if (!sessionId) { socket.close(1008, 'no session'); return; }
      const pipeline = handlers.getPipeline(sessionId);
      if (!pipeline) { socket.close(1008, 'session gone'); return; }

      if (obj.kind === 'edit') {
        const edit = WsEditMessage.safeParse(parsed);
        if (!edit.success) return sendError(socket, sessionId, 'VE_PROTOCOL_002', 'invalid edit message', undefined);
        try {
          const dr = await pipeline.planAndApply(edit.data.edits);
          const reply: WsDryRunMessage = {
            kind: 'dry-run',
            requestId: edit.data.requestId,
            sessionId,
            planId: dr.planId,
            filePath: pipeline.getFilePath(),
            patches: dr.patches,
            beforeHash: dr.beforeHash,
            afterHash: dr.afterHash,
          };
          socket.send(JSON.stringify(reply));
        } catch (err) {
          sendError(socket, sessionId, codeOf(err), (err as Error).message, edit.data.requestId);
        }
        return;
      }

      if (obj.kind === 'commit') {
        const c = WsCommitMessage.safeParse(parsed);
        if (!c.success) return sendError(socket, sessionId, 'VE_PROTOCOL_002', 'invalid commit message', undefined);
        try {
          const result = await pipeline.commit(c.data.planId);
          if (result.status === 'committed') {
            const reply: WsCommitOkMessage = {
              kind: 'commit-ok',
              requestId: c.data.requestId,
              sessionId,
              commitId: result.commitId,
            };
            socket.send(JSON.stringify(reply));
          } else {
            const reply: WsCommitUncertainMessage = {
              kind: 'commit-uncertain',
              requestId: c.data.requestId,
              sessionId,
              lastError: result.lastError ?? 'unknown',
            };
            socket.send(JSON.stringify(reply));
          }
        } catch (err) {
          sendError(socket, sessionId, codeOf(err), (err as Error).message, c.data.requestId);
        }
        return;
      }

      if (obj.kind === 'bye') { socket.close(1000, 'bye'); return; }
    });
  });

  return wss;
}

function sendError(socket: WebSocket, sessionId: string, code: string, message: string, requestId: string | undefined): void {
  const msg: WsErrorMessage = { kind: 'error', sessionId, code, message, requestId };
  socket.send(JSON.stringify(msg));
}

function codeOf(err: unknown): string {
  const m = (err as Error).message ?? '';
  const match = m.match(/VE_[A-Z]+_\d+/);
  return match ? match[0] : 'VE_INTERNAL_999';
}
```

- [ ] **Step 7: Build + test**

Run: `npm run build -w @visual-edit/code-mods @visual-edit/protocol @visual-edit/daemon && npm test -w @visual-edit/daemon`
Expected: all tests green.

- [ ] **Step 8: Commit**

```bash
git add packages/daemon/ packages/protocol/ packages/code-mods/
git commit -m "feat(daemon): EditPipeline worker + WS routing for edit/commit/rollback"
```

---

## Sub-phase 1.B-3 — File watcher & snapshot enrichment

### Task 12: `FileWatcher` worker (chokidar + recent-writes set + reconciliation)

**Files:**
- Create: `packages/daemon/src/fileWatcher.ts`
- Create: `packages/daemon/tests/fileWatcher.test.ts`
- Modify: `packages/daemon/package.json` (add `chokidar` dep)

- [ ] **Step 1: Run Sonatype Guide check on chokidar**

Per CLAUDE.md feedback (sonatype-guide skill must be used before any new dep). Pass `chokidar@^3.6.0`. If risk surfaces, surface to user before proceeding; otherwise add the dep.

- [ ] **Step 2: Add the dep**

In `packages/daemon/package.json` `dependencies`:
```json
"chokidar": "^3.6.0"
```

Run: `npm install`

- [ ] **Step 3: Write the failing test**

```ts
// packages/daemon/tests/fileWatcher.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileWatcher } from '../src/fileWatcher.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-fw-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('FileWatcher', () => {
  it('emits "external-change" when watched file is modified by another process', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'V1', 'utf8');
    const fw = new FileWatcher();
    const events: { filePath: string; sha256: string }[] = [];
    fw.on('external-change', (e) => events.push(e));
    await fw.watch(file);
    writeFileSync(file, 'V2', 'utf8');
    await wait(500);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.sha256).toBe(sha('V2'));
    await fw.close();
  });

  it('does NOT emit when our own commit registered the new sha first (recent-writes dedup)', async () => {
    const file = join(tmp, 'p.tsx');
    writeFileSync(file, 'V1', 'utf8');
    const fw = new FileWatcher();
    const events: unknown[] = [];
    fw.on('external-change', (e) => events.push(e));
    await fw.watch(file);
    fw.registerSelfWrite(file, sha('V2'));
    writeFileSync(file, 'V2', 'utf8');
    await wait(500);
    expect(events).toHaveLength(0);
    await fw.close();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w @visual-edit/daemon -- fileWatcher`
Expected: FAIL — module missing.

- [ ] **Step 5: Write `packages/daemon/src/fileWatcher.ts`**

```ts
import { EventEmitter } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';

export interface ExternalChange {
  filePath: string;
  sha256: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Watches user-source files. Dedups self-writes via a hash set so commits the daemon performed
 * itself don't fire `external-change` events. Reconciliation rescan every 5s catches lossy
 * chokidar events on Windows.
 */
export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private watched = new Set<string>();
  private recentWrites = new Map<string, Set<string>>();   // filePath → set of recent sha256
  private lastSeenSha = new Map<string, string>();          // filePath → sha last reported
  private reconcileTimer: NodeJS.Timeout | null = null;

  async watch(filePath: string): Promise<void> {
    this.watched.add(filePath);
    if (existsSync(filePath)) this.lastSeenSha.set(filePath, sha(readFileSync(filePath, 'utf8')));
    if (!this.watcher) {
      this.watcher = chokidar.watch([], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } });
      this.watcher.on('change', (changedPath) => this.handleChange(changedPath));
      this.startReconciliation();
    }
    this.watcher.add(filePath);
  }

  /** Register a sha that the daemon itself just wrote. Future events with this sha are ignored. */
  registerSelfWrite(filePath: string, sha256: string): void {
    if (!this.recentWrites.has(filePath)) this.recentWrites.set(filePath, new Set());
    this.recentWrites.get(filePath)!.add(sha256);
    // GC after 5s — long enough to outlive event delivery.
    setTimeout(() => this.recentWrites.get(filePath)?.delete(sha256), 5000).unref();
  }

  async close(): Promise<void> {
    if (this.reconcileTimer) { clearInterval(this.reconcileTimer); this.reconcileTimer = null; }
    if (this.watcher) { await this.watcher.close(); this.watcher = null; }
    this.watched.clear();
    this.recentWrites.clear();
    this.lastSeenSha.clear();
  }

  private handleChange(filePath: string): void {
    if (!this.watched.has(filePath) || !existsSync(filePath)) return;
    const newSha = sha(readFileSync(filePath, 'utf8'));
    if (this.recentWrites.get(filePath)?.has(newSha)) return;            // self-write
    if (this.lastSeenSha.get(filePath) === newSha) return;                // no actual change
    this.lastSeenSha.set(filePath, newSha);
    this.emit('external-change', { filePath, sha256: newSha } as ExternalChange);
  }

  private startReconciliation(): void {
    this.reconcileTimer = setInterval(() => {
      for (const filePath of this.watched) {
        if (!existsSync(filePath)) continue;
        const newSha = sha(readFileSync(filePath, 'utf8'));
        if (this.recentWrites.get(filePath)?.has(newSha)) continue;
        if (this.lastSeenSha.get(filePath) === newSha) continue;
        this.lastSeenSha.set(filePath, newSha);
        this.emit('external-change', { filePath, sha256: newSha } as ExternalChange);
      }
    }, 5000).unref?.();
  }
}
```

- [ ] **Step 6: Build + test**

Run: `npm run build -w @visual-edit/daemon && npm test -w @visual-edit/daemon -- fileWatcher`
Expected: 2 tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/
git commit -m "feat(daemon): FileWatcher with self-write dedup + reconciliation rescan"
```

---

### Task 13: Wire `FileWatcher` to broadcast `file-changed` over WS, plug EditPipeline.onSelfWrite

**Files:**
- Modify: `packages/daemon/src/daemon.ts` (instantiate one FileWatcher; per session, watch the file + wire EditPipeline.onSelfWrite to FileWatcher.registerSelfWrite + bridge external-change to all WS clients)
- Modify: `packages/daemon/src/ws.ts` (expose a broadcast helper for the daemon to push file-changed messages)
- Create: `packages/daemon/tests/fileChangedBroadcast.test.ts`

(EditPipeline already accepts `onSelfWrite` from Task 11 — no further change needed there.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/tests/fileChangedBroadcast.test.ts
import { describe, it, expect } from 'vitest';
import { broadcastFileChanged, attachWebSocket } from '../src/ws.js';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';

describe('broadcastFileChanged', () => {
  it('sends a file-changed message to all connected clients for the session', async () => {
    const http = createServer();
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const port = (http.address() as { port: number }).port;

    // Stub handlers for the WS server.
    const session = { id: 's1', url: 'http://x', pageRef: { route: '/', filePath: '/x.tsx', isClientOnly: true, cssImports: [] }, startedAt: '', status: 'ready' as const };
    const pipeline = { getSnapshot: async () => ({ sourceText: '', sourceMap: {} }), opts: { filePath: '/x.tsx' } } as unknown as import('../src/editPipeline.js').EditPipeline;
    const wss = attachWebSocket(http, {
      getSession: (id) => (id === 's1' ? session : null),
      getPipeline: (id) => (id === 's1' ? pipeline : null),
      daemonPort: () => port,
    });

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => client.once('open', () => r()));
    client.send(JSON.stringify({ kind: 'hello', version: '1.0', sessionId: 's1' }));
    await new Promise<void>((r) => client.once('message', () => r())); // snapshot

    const got: unknown[] = [];
    client.on('message', (raw) => got.push(JSON.parse(raw.toString())));
    broadcastFileChanged(wss, { sessionId: 's1', filePath: '/x.tsx', sha256: 'a'.repeat(64), dirtySourceMap: false });
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(got.find((m) => (m as { kind: string }).kind === 'file-changed')).toBeDefined();

    client.close();
    wss.close();
    await new Promise<void>((r) => http.close(() => r()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/daemon -- fileChangedBroadcast`
Expected: FAIL — `broadcastFileChanged` not exported.

- [ ] **Step 3: Update `packages/daemon/src/ws.ts`**

Append to the file:

```ts
import type { WsFileChangedMessage } from '@visual-edit/protocol';

/**
 * Broadcast a file-changed event to all WS clients connected to the daemon. The clients
 * filter by sessionId on receive (each client is a single editor instance attached to one
 * session, but a session may have multiple tabs open — they all need the notification).
 */
export function broadcastFileChanged(wss: WebSocketServer, msg: Omit<WsFileChangedMessage, 'kind'>): void {
  const wire: WsFileChangedMessage = { kind: 'file-changed', ...msg };
  const payload = JSON.stringify(wire);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
```

(Confirm `WebSocketServer` is already imported at the top — it is.)

- [ ] **Step 4: Update `packages/daemon/src/daemon.ts`** to wire FileWatcher

Add fields:

```ts
private fileWatcher = new FileWatcher();
```

Import:
```ts
import { FileWatcher } from './fileWatcher.js';
```

In `start()`, after `attachWebSocket(...)`, wire:

```ts
this.fileWatcher.on('external-change', (e) => {
  // Broadcast to every session whose file matches.
  for (const [sessionId, pipeline] of this.editPipelines) {
    const opts = (pipeline as unknown as { opts: { filePath: string } }).opts;
    if (opts.filePath !== e.filePath) continue;
    broadcastFileChanged(this.wsServer!, {
      sessionId,
      filePath: e.filePath,
      sha256: e.sha256,
      dirtySourceMap: true, // 1.B treats every external change as dirty (re-instrument required)
    });
  }
});
```

Add the import:
```ts
import { broadcastFileChanged } from './ws.js';
```

In `openPreview()`, when creating the EditPipeline, pass the `onSelfWrite` hook and also start watching:

```ts
const pipeline = new EditPipeline({
  root: this.opts.root,
  filePath: matchedPage.filePath,
  onSelfWrite: (path, sha256) => this.fileWatcher.registerSelfWrite(path, sha256),
});
this.editPipelines.set(sessionId, pipeline);
await this.fileWatcher.watch(matchedPage.filePath);
```

In `stop()`, before `removeLock`:

```ts
await this.fileWatcher.close();
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/daemon && npm test -w @visual-edit/daemon`
Expected: all tests green (existing + new broadcast test).

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/
git commit -m "feat(daemon): wire FileWatcher to broadcast file-changed + EditPipeline self-writes"
```

---

### Task 14: Daemon HTTP serves editor-ui static files at `/__editor/`; openPreview returns `editorUrl`

**Files:**
- Modify: `packages/daemon/src/http.ts` (add `GET /__editor/*` static handler)
- Modify: `packages/daemon/src/daemon.ts` (pass `editorAssetsRoot` into createHttpServer)
- Modify: `packages/protocol/src/http.ts` (extend `OpenPreviewResponse` schema with `editorUrl`)
- Modify: `packages/daemon/tests/` (add static-serve test)

- [ ] **Step 1: Extend the OpenPreviewResponse schema**

In `packages/protocol/src/http.ts`, find `OpenPreviewResponse` and add the `editorUrl` field. Run the existing protocol test suite to confirm nothing else uses this response shape rigidly.

```ts
// (excerpt — keep existing fields, add editorUrl)
export const OpenPreviewResponse = z.object({
  url: z.string().url(),
  sessionId: z.string().min(1),
  editorUrl: z.string().url(),
});
export type OpenPreviewResponse = z.infer<typeof OpenPreviewResponse>;
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/daemon/tests/staticEditor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHttpServer } from '../src/http.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-static-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('GET /__editor/*', () => {
  it('serves editor-ui static assets from configured directory', async () => {
    const assetsRoot = join(tmp, 'editor-dist');
    mkdirSync(assetsRoot, { recursive: true });
    writeFileSync(join(assetsRoot, 'index.html'), '<!doctype html><title>editor</title>', 'utf8');
    writeFileSync(join(assetsRoot, 'main.js'), 'console.log("hi")', 'utf8');

    const server = createHttpServer({
      openPreview: async () => ({ url: 'http://x', sessionId: 's', editorUrl: 'http://x/__editor/?session=s' }),
      closePreview: async () => undefined,
      getStatus: async () => ({ daemonVersion: 'x', uptime: 0, activePreviews: 0, workerHealth: {} }),
      editorAssetsRoot: assetsRoot,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const indexResp = await fetch(`http://127.0.0.1:${port}/__editor/`);
    expect(indexResp.status).toBe(200);
    expect(await indexResp.text()).toContain('editor');

    const jsResp = await fetch(`http://127.0.0.1:${port}/__editor/main.js`);
    expect(jsResp.status).toBe(200);
    expect(await jsResp.text()).toBe('console.log("hi")');

    const missingResp = await fetch(`http://127.0.0.1:${port}/__editor/no-such.js`);
    expect(missingResp.status).toBe(404);

    // Path traversal guard — must send the raw path (fetch normalizes ../ client-side, so we
    // use a low-level http request that puts the literal traversal sequence on the wire).
    const traversalStatus = await new Promise<number>((res) => {
      const req = require('node:http').request(
        { host: '127.0.0.1', port, method: 'GET', path: '/__editor/..%2F..%2Fetc%2Fpasswd' },
        (r: { statusCode?: number }) => res(r.statusCode ?? 0),
      );
      req.end();
    });
    expect(traversalStatus).toBe(404);

    await new Promise<void>((r) => server.close(() => r()));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @visual-edit/daemon -- staticEditor`
Expected: FAIL — `editorAssetsRoot` not accepted; route not implemented.

- [ ] **Step 4: Update `packages/daemon/src/http.ts`**

Replace with:

```ts
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep, extname } from 'node:path';
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
  /** Absolute path to a directory containing editor-ui's static build (index.html etc.). */
  editorAssetsRoot?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createHttpServer(handlers: HttpHandlers): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    try {
      // Static editor route — handle BEFORE JSON body parsing.
      if (req.method === 'GET' && req.url?.startsWith('/__editor/')) {
        return await serveEditor(req.url, handlers.editorAssetsRoot, res);
      }
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

async function serveEditor(
  reqUrl: string,
  assetsRoot: string | undefined,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (!assetsRoot) { res.statusCode = 404; res.end('editor not configured'); return; }
  // Strip query string + leading /__editor/. Decode percent-escapes BEFORE normalizing so
  // an attacker sending `..%2F..%2Fetc%2Fpasswd` cannot bypass the `..` guard.
  let decoded: string;
  try { decoded = decodeURIComponent(reqUrl.split('?')[0]!); }
  catch { res.statusCode = 400; res.end('bad request'); return; }
  const stripped = decoded.replace(/^\/__editor\//, '');
  const safeRel = normalize(stripped).replace(/^(\.\.[\/\\])+/g, '');
  if (safeRel.includes('..')) { res.statusCode = 404; res.end('not found'); return; }
  let target = safeRel === '' ? 'index.html' : safeRel;
  let abs = join(assetsRoot, target);
  // Make sure abs is still under assetsRoot (defensive).
  const normRoot = normalize(assetsRoot) + sep;
  if (!(normalize(abs) + sep).startsWith(normRoot) && normalize(abs) !== normalize(assetsRoot)) {
    res.statusCode = 404; res.end('not found'); return;
  }
  if (!existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
  if (statSync(abs).isDirectory()) abs = join(abs, 'index.html');
  if (!existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
  const content = await readFile(abs);
  const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', mime);
  res.end(content);
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

- [ ] **Step 5: Update `packages/daemon/src/daemon.ts`**

In `openPreview()`, build `editorUrl` and include in the return value:

```ts
const editorUrl = `http://127.0.0.1:${this.actualPort}/__editor/?session=${sessionId}`;
return { url: session.url, sessionId, editorUrl };
```

In `start()`, pass `editorAssetsRoot` to `createHttpServer` (resolve from `import.meta.url` or env). Add a constructor option:

```ts
export interface DaemonOptions {
  root: string;
  port?: number;
  logger?: Logger;
  editorAssetsRoot?: string;
}
```

```ts
this.httpServer = createHttpServer({
  openPreview: this.openPreview.bind(this),
  closePreview: this.closePreview.bind(this),
  getStatus: this.getStatus.bind(this),
  editorAssetsRoot: this.opts.editorAssetsRoot,
});
```

In `packages/daemon/src/cli.ts`, resolve a default `editorAssetsRoot` from `node_modules/@visual-edit/editor-ui/dist`:

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

function resolveEditorAssetsRoot(): string | undefined {
  // Try the resolved package layout first.
  try {
    // require.resolve isn't available in ESM; use import.meta.resolve fallback.
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, '../../editor-ui/dist'),
      resolve(here, '../../../node_modules/@visual-edit/editor-ui/dist'),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
  } catch {}
  return undefined;
}
```

Pass it to `Daemon` options.

- [ ] **Step 6: Build + test**

Run: `npm run build -w @visual-edit/protocol @visual-edit/daemon && npm test -w @visual-edit/daemon -- staticEditor`
Expected: 4 assertions green.

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/ packages/protocol/
git commit -m "feat(daemon): static-serve editor-ui at /__editor/ + editorUrl in OpenPreviewResponse"
```

---

## Sub-phase 1.B-4 — Editor-UI, bridge script, MCP rollback, and e2e

### Task 15: Scaffold `packages/editor-ui` (Vite + React + Tailwind + Zustand)

**Files:**
- Create: `packages/editor-ui/package.json`
- Create: `packages/editor-ui/tsconfig.json`
- Create: `packages/editor-ui/vite.config.ts`
- Create: `packages/editor-ui/tailwind.config.js`
- Create: `packages/editor-ui/postcss.config.js`
- Create: `packages/editor-ui/index.html`
- Create: `packages/editor-ui/src/main.tsx`
- Create: `packages/editor-ui/src/App.tsx`
- Create: `packages/editor-ui/src/styles.css`

- [ ] **Step 1: Run Sonatype Guide on the new deps**

Per CLAUDE.md feedback, validate before adding: `react@^18.3.0`, `react-dom@^18.3.0`, `zustand@^4.5.0`, `react-color@^2.19.3`, `vite@^5.4.0`, `@vitejs/plugin-react@^4.3.0`, `tailwindcss@^3.4.0`, `postcss@^8.4.0`, `autoprefixer@^10.4.0`, `@types/react@^18.3.0`, `@types/react-dom@^18.3.0`, `@types/react-color@^3.0.0`. Surface any high-risk dep to the user.

- [ ] **Step 2: Write `packages/editor-ui/package.json`**

```json
{
  "name": "@visual-edit/editor-ui",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0",
    "react-color": "^2.19.3",
    "@visual-edit/protocol": "*",
    "@visual-edit/shared": "*"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/react-color": "^3.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
  "files": ["dist"]
}
```

- [ ] **Step 3: Write `packages/editor-ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "noEmit": true,
    "outDir": "./dist-ts"
  },
  "include": ["src/**/*", "vite.config.ts"]
}
```

- [ ] **Step 4: Write `packages/editor-ui/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/__editor/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { output: { manualChunks: undefined } },
  },
  test: { environment: 'jsdom' },
});
```

- [ ] **Step 5: Write `packages/editor-ui/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 6: Write `packages/editor-ui/postcss.config.js`**

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 7: Write `packages/editor-ui/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Visual Edit</title>
  </head>
  <body class="m-0 bg-neutral-900 text-neutral-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Write `packages/editor-ui/src/styles.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 9: Write `packages/editor-ui/src/main.tsx`** and `App.tsx` (placeholder; populated in Tasks 16–19)

`main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
createRoot(root).render(<App />);
```

`App.tsx`:
```tsx
export function App(): JSX.Element {
  return <div className="p-4">Visual Edit (loading…)</div>;
}
```

- [ ] **Step 10: Build to verify the scaffold**

Run: `npm install` (root) then `npm run build -w @visual-edit/editor-ui`
Expected: `packages/editor-ui/dist/index.html` exists.

- [ ] **Step 11: Commit**

```bash
git add packages/editor-ui/ package.json package-lock.json
git commit -m "feat(editor-ui): scaffold Vite + React + Tailwind + Zustand package"
```

---

### Task 16: Editor-ui state store (Zustand) + WS client

**Files:**
- Create: `packages/editor-ui/src/state.ts`
- Create: `packages/editor-ui/src/wsClient.ts`
- Create: `packages/editor-ui/tests/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/editor-ui/tests/state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/state.js';

beforeEach(() => useStore.setState(useStore.getInitialState()));

describe('editor state', () => {
  it('selectVid sets selectedVid', () => {
    useStore.getState().selectVid('abc12345');
    expect(useStore.getState().selectedVid).toBe('abc12345');
  });

  it('setSnapshot stores sourceText, sourceMap, previewUrl, filePath', () => {
    useStore.getState().setSnapshot({
      url: 'http://x',
      filePath: '/p.tsx',
      sourceText: 'src',
      sourceMap: { abc12345: { vid: 'abc12345', tagName: 'div', nodeStart: 0, nodeEnd: 1, openingTagEnd: 1, classNameAttr: null, styleAttr: null, attrsInsertPos: 1 } },
    });
    expect(useStore.getState().filePath).toBe('/p.tsx');
    expect(Object.keys(useStore.getState().sourceMap)).toContain('abc12345');
  });

  it('setRect stores per-vid rect from bridge messages', () => {
    useStore.getState().setRect('abc12345', { x: 10, y: 20, width: 100, height: 50 });
    expect(useStore.getState().rects['abc12345']).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('markStale sets staleSnapshot=true on file-changed', () => {
    useStore.getState().markStale('a'.repeat(64));
    expect(useStore.getState().staleSnapshot).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/editor-ui`
Expected: FAIL — `state.ts` missing.

- [ ] **Step 3: Write `packages/editor-ui/src/state.ts`**

```ts
import { create } from 'zustand';
import type { ElementSourceMap } from '@visual-edit/protocol';

export interface Rect { x: number; y: number; width: number; height: number; }

export interface EditorState {
  // Connection
  status: 'connecting' | 'ready' | 'stale' | 'disconnected';
  sessionId: string | null;
  // Snapshot
  url: string | null;            // preview URL
  filePath: string | null;
  sourceText: string;
  sourceMap: ElementSourceMap;
  // Selection + bridge
  selectedVid: string | null;
  rects: Record<string, Rect>;
  // Edits
  pendingDryRun: { planId: string; afterHash: string } | null;
  staleSnapshot: boolean;
  lastError: string | null;
  // Mutators
  setSnapshot: (s: { url: string; filePath: string; sourceText: string; sourceMap: ElementSourceMap; sessionId?: string }) => void;
  selectVid: (vid: string | null) => void;
  setRect: (vid: string, rect: Rect) => void;
  setRects: (rects: Record<string, Rect>) => void;
  setDryRun: (planId: string, afterHash: string) => void;
  clearDryRun: () => void;
  markStale: (sha256: string) => void;
  setError: (msg: string) => void;
  setStatus: (s: EditorState['status']) => void;
}

export const useStore = create<EditorState>()((set) => ({
  status: 'connecting',
  sessionId: null,
  url: null,
  filePath: null,
  sourceText: '',
  sourceMap: {},
  selectedVid: null,
  rects: {},
  pendingDryRun: null,
  staleSnapshot: false,
  lastError: null,
  setSnapshot: (s) => set({ url: s.url, filePath: s.filePath, sourceText: s.sourceText, sourceMap: s.sourceMap, status: 'ready', staleSnapshot: false, sessionId: s.sessionId ?? undefined }),
  selectVid: (vid) => set({ selectedVid: vid }),
  setRect: (vid, rect) => set((st) => ({ rects: { ...st.rects, [vid]: rect } })),
  setRects: (rects) => set({ rects }),
  setDryRun: (planId, afterHash) => set({ pendingDryRun: { planId, afterHash } }),
  clearDryRun: () => set({ pendingDryRun: null }),
  markStale: () => set({ staleSnapshot: true, status: 'stale' }),
  setError: (msg) => set({ lastError: msg }),
  setStatus: (status) => set({ status }),
}));
```

- [ ] **Step 4: Write `packages/editor-ui/src/wsClient.ts`**

```ts
import { useStore } from './state.js';
import type { Edit } from '@visual-edit/shared';

export interface WsClient {
  sendEdit: (edits: Edit[]) => string;     // returns requestId
  sendCommit: (planId: string) => string;
  close: () => void;
}

export function connect(url: string, sessionId: string): WsClient {
  const ws = new WebSocket(url);
  let counter = 0;
  const nextId = () => `r${++counter}`;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ kind: 'hello', version: '1.0', sessionId }));
  });

  ws.addEventListener('message', (e) => {
    let msg: { kind: string; [k: string]: unknown };
    try { msg = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
    const s = useStore.getState();
    switch (msg.kind) {
      case 'snapshot':
        s.setSnapshot({
          url: msg.url as string,
          filePath: msg.filePath as string,
          sourceText: msg.sourceText as string,
          sourceMap: msg.sourceMap as never,
          sessionId,
        });
        return;
      case 'dry-run':
        s.setDryRun(msg.planId as string, msg.afterHash as string);
        return;
      case 'commit-ok':
        s.clearDryRun();
        return;
      case 'commit-uncertain':
        s.setError(`commit-uncertain: ${msg.lastError}`);
        s.clearDryRun();
        return;
      case 'file-changed':
        s.markStale(msg.sha256 as string);
        return;
      case 'error':
        s.setError(`[${msg.code}] ${msg.message}`);
        return;
    }
  });

  ws.addEventListener('close', () => useStore.getState().setStatus('disconnected'));

  return {
    sendEdit: (edits) => { const requestId = nextId(); ws.send(JSON.stringify({ kind: 'edit', requestId, sessionId, edits })); return requestId; },
    sendCommit: (planId) => { const requestId = nextId(); ws.send(JSON.stringify({ kind: 'commit', requestId, sessionId, planId })); return requestId; },
    close: () => ws.close(),
  };
}
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/protocol @visual-edit/shared @visual-edit/editor-ui && npm test -w @visual-edit/editor-ui`
Expected: 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/editor-ui/
git commit -m "feat(editor-ui): Zustand store + WS client"
```

---

### Task 17: Bridge script in mock-runtime — preview reports `data-vid` rects to parent via `postMessage`

**Files:**
- Modify: `packages/mock-runtime/src/entryWrapper.ts` (inject bridge.js after wrapPage mounts)
- Create: `packages/mock-runtime/tests/entryWrapper.bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/mock-runtime/tests/entryWrapper.bridge.test.ts
import { describe, it, expect } from 'vitest';
import { buildEntryWrapper } from '../src/entryWrapper.js';

describe('bridge in entryWrapper', () => {
  it('emits a ResizeObserver / mutationObserver block that posts data-vid rects to parent', () => {
    const code = buildEntryWrapper({
      pageImportPath: './Home.tsx',
      configImportPath: '../visual-edit.config.ts',
      fakerBindingsImportPath: './faker-bindings.ts',
      userCssImportPath: null,
      sessionId: 's1',
    });
    expect(code).toContain('window.parent.postMessage');
    expect(code).toContain('data-vid');
    expect(code).toContain('MutationObserver');
    expect(code).toContain('ResizeObserver');
    expect(code).toContain('__veInstallBridge');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/mock-runtime -- bridge`
Expected: FAIL — `buildEntryWrapper` does not currently emit bridge code.

- [ ] **Step 3: Update `packages/mock-runtime/src/entryWrapper.ts`**

The existing implementation builds the entry as `const lines: string[] = []` and `lines.push(...)` per line, returning `lines.join('\n')` (verified: this is the current shape of `buildEntryWrapper`).

Define a module-level constant ABOVE the function:

```ts
const BRIDGE_SOURCE = `
function __veCollectRects() {
  const out = {};
  for (const el of document.querySelectorAll('[data-vid]')) {
    const r = el.getBoundingClientRect();
    out[el.getAttribute('data-vid')] = { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  window.parent.postMessage({ type: 've-rects', rects: out }, '*');
}
function __veInstallBridge() {
  __veCollectRects();
  const mo = new MutationObserver(() => __veCollectRects());
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-vid', 'class', 'style'] });
  const ro = new ResizeObserver(() => __veCollectRects());
  ro.observe(document.documentElement);
  window.addEventListener('scroll', () => __veCollectRects(), { passive: true });
  window.addEventListener('resize', () => __veCollectRects(), { passive: true });
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 've-rects-request') __veCollectRects();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __veInstallBridge);
else __veInstallBridge();
`;
```

Then, INSIDE `buildEntryWrapper`, immediately before the final `return lines.join('\n');`, append:

```ts
lines.push('');
lines.push(BRIDGE_SOURCE);
```

This guarantees the bridge code lands in the emitted entry — the previous version of this step omitted the actual `lines.push(BRIDGE_SOURCE)`, which would have left the bridge undefined.

- [ ] **Step 4: Build + test**

Run: `npm run build -w @visual-edit/mock-runtime && npm test -w @visual-edit/mock-runtime`
Expected: bridge test green; existing entry-wrapper tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/mock-runtime/
git commit -m "feat(mock-runtime): bridge.js posts data-vid rects to parent editor"
```

---

### Task 18: Iframe + Overlay components — receive rects from bridge, render selection box

**Files:**
- Create: `packages/editor-ui/src/canvas/Iframe.tsx`
- Create: `packages/editor-ui/src/canvas/Overlay.tsx`
- Modify: `packages/editor-ui/src/App.tsx` (use these)
- Create: `packages/editor-ui/tests/canvas.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/editor-ui/tests/canvas.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Overlay } from '../src/canvas/Overlay.js';
import { useStore } from '../src/state.js';

describe('Overlay', () => {
  it('renders one rect div per known vid', () => {
    useStore.setState({
      ...useStore.getInitialState(),
      sourceMap: { abc12345: { vid: 'abc12345', tagName: 'div', nodeStart: 0, nodeEnd: 1, openingTagEnd: 1, classNameAttr: null, styleAttr: null, attrsInsertPos: 1 } },
      rects: { abc12345: { x: 10, y: 10, width: 100, height: 50 } },
    });
    const { container } = render(<Overlay />);
    expect(container.querySelectorAll('[data-vid-overlay]')).toHaveLength(1);
  });
});
```

(Add `@testing-library/react` and `@testing-library/jest-dom` as devDependencies in editor-ui — run sonatype check first.)

- [ ] **Step 2: Add testing-library deps**

In `packages/editor-ui/package.json` `devDependencies`:
```json
"@testing-library/react": "^16.0.0",
"@testing-library/jest-dom": "^6.5.0"
```
Run `npm install`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @visual-edit/editor-ui -- canvas`
Expected: FAIL — `Overlay` not found.

- [ ] **Step 4: Write `packages/editor-ui/src/canvas/Iframe.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useStore } from '../state.js';

export function Iframe(): JSX.Element {
  const url = useStore((s) => s.url);
  const setRects = useStore((s) => s.setRects);
  const ref = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; rects?: Record<string, { x: number; y: number; width: number; height: number }> };
      if (data?.type === 've-rects' && data.rects) setRects(data.rects);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setRects]);

  if (!url) return <div className="p-4 text-neutral-400">waiting for snapshot…</div>;
  return (
    <iframe
      ref={ref}
      src={url}
      className="w-full h-full border-0 bg-white"
      title="preview"
    />
  );
}
```

- [ ] **Step 5: Write `packages/editor-ui/src/canvas/Overlay.tsx`**

```tsx
import { useStore } from '../state.js';

export function Overlay(): JSX.Element {
  const rects = useStore((s) => s.rects);
  const sourceMap = useStore((s) => s.sourceMap);
  const selectedVid = useStore((s) => s.selectedVid);
  const selectVid = useStore((s) => s.selectVid);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {Object.entries(sourceMap).map(([vid]) => {
        const r = rects[vid];
        if (!r) return null;
        const isSelected = selectedVid === vid;
        return (
          <div
            key={vid}
            data-vid-overlay={vid}
            onClick={(e) => { e.stopPropagation(); selectVid(vid); }}
            className={`absolute pointer-events-auto cursor-pointer ${isSelected ? 'border-2 border-blue-500' : 'border border-blue-300/40 hover:border-blue-400'}`}
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Update `App.tsx` to use them (provisional layout — properties panel added in Task 19)**

```tsx
import { Iframe } from './canvas/Iframe.js';
import { Overlay } from './canvas/Overlay.js';

export function App(): JSX.Element {
  return (
    <div className="flex h-screen">
      <div className="flex-1 relative">
        <Iframe />
        <Overlay />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build + test**

Run: `npm run build -w @visual-edit/editor-ui && npm test -w @visual-edit/editor-ui`
Expected: all tests green.

- [ ] **Step 8: Commit**

```bash
git add packages/editor-ui/ package.json package-lock.json
git commit -m "feat(editor-ui): iframe + overlay receiving postMessage rects from preview bridge"
```

---

### Task 19: Properties panel (className textbox + color picker + padding inputs) + WS edit/commit wiring

**Files:**
- Create: `packages/editor-ui/src/panels/PropertiesPanel.tsx`
- Modify: `packages/editor-ui/src/App.tsx` (mount panel + bootstrap WS connection from `?session=` query param)
- Create: `packages/editor-ui/tests/panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/editor-ui/tests/panel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesPanel } from '../src/panels/PropertiesPanel.js';
import { useStore } from '../src/state.js';

describe('PropertiesPanel', () => {
  it('renders className input only when an element is selected', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: null });
    const send = { sendEdit: vi.fn(() => 'r1'), sendCommit: vi.fn(() => 'r2'), close: vi.fn() };
    render(<PropertiesPanel client={send} />);
    expect(screen.queryByTestId('classname-input')).toBeNull();

    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345' });
    render(<PropertiesPanel client={send} />);
    expect(screen.queryByTestId('classname-input')).not.toBeNull();
  });

  it('Apply button sends an edit message with current className', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345' });
    const send = { sendEdit: vi.fn(() => 'r1'), sendCommit: vi.fn(() => 'r2'), close: vi.fn() };
    render(<PropertiesPanel client={send} />);
    const input = screen.getByTestId('classname-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'text-red-500' } });
    fireEvent.click(screen.getByTestId('apply-className'));
    expect(send.sendEdit).toHaveBeenCalledWith([{ kind: 'className', element: 'abc12345', newValue: 'text-red-500' }]);
  });

  it('Ctrl+S triggers commit when there is a pending dry-run', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345', pendingDryRun: { planId: 'p1', afterHash: 'a'.repeat(64) } });
    const send = { sendEdit: vi.fn(() => 'r1'), sendCommit: vi.fn(() => 'r2'), close: vi.fn() };
    render(<PropertiesPanel client={send} />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(send.sendCommit).toHaveBeenCalledWith('p1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @visual-edit/editor-ui -- panel`
Expected: FAIL — panel missing.

- [ ] **Step 3: Write `packages/editor-ui/src/panels/PropertiesPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { SketchPicker } from 'react-color';
import { useStore } from '../state.js';
import type { WsClient } from '../wsClient.js';

interface Props { client: Pick<WsClient, 'sendEdit' | 'sendCommit'>; }

export function PropertiesPanel({ client }: Props): JSX.Element {
  const selectedVid = useStore((s) => s.selectedVid);
  const sourceMap = useStore((s) => s.sourceMap);
  const sourceText = useStore((s) => s.sourceText);
  const pendingDryRun = useStore((s) => s.pendingDryRun);

  const [className, setClassName] = useState('');
  const [color, setColor] = useState<string>('#000000');
  const [padding, setPadding] = useState<{ t: number; r: number; b: number; l: number }>({ t: 0, r: 0, b: 0, l: 0 });

  // Initialize panel from current source whenever selection changes.
  useEffect(() => {
    if (!selectedVid) return;
    const entry = sourceMap[selectedVid];
    if (!entry) return;
    if (entry.classNameAttr && entry.classNameAttr.valueKind === 'string-literal') {
      setClassName(sourceText.slice(entry.classNameAttr.valueStart, entry.classNameAttr.valueEnd));
    } else {
      setClassName('');
    }
  }, [selectedVid, sourceMap, sourceText]);

  // Ctrl+S → commit if there's a dry-run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (pendingDryRun) client.sendCommit(pendingDryRun.planId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDryRun, client]);

  if (!selectedVid) {
    return <aside className="w-72 p-4 border-l border-neutral-700 text-sm text-neutral-400">Select an element</aside>;
  }

  const sendClassNameEdit = () => client.sendEdit([{ kind: 'className', element: selectedVid, newValue: className }]);
  const sendStyleEdit = () => {
    const obj = `{ color: '${color}', paddingTop: ${padding.t}, paddingRight: ${padding.r}, paddingBottom: ${padding.b}, paddingLeft: ${padding.l} }`;
    client.sendEdit([{ kind: 'style', element: selectedVid, newObjectText: obj }]);
  };

  return (
    <aside className="w-72 p-4 border-l border-neutral-700 text-sm space-y-4 bg-neutral-900 text-neutral-100">
      <div>
        <div className="font-semibold mb-1">className</div>
        <input
          data-testid="classname-input"
          className="w-full px-2 py-1 bg-neutral-800 border border-neutral-700 rounded"
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendClassNameEdit()}
        />
        <button
          data-testid="apply-className"
          className="mt-2 w-full px-2 py-1 bg-blue-600 rounded"
          onClick={sendClassNameEdit}
        >
          Apply (Enter)
        </button>
      </div>

      <div>
        <div className="font-semibold mb-1">color</div>
        <SketchPicker color={color} onChange={(c) => setColor(c.hex)} disableAlpha presetColors={[]} />
      </div>

      <div>
        <div className="font-semibold mb-1">padding (T/R/B/L)</div>
        <div className="grid grid-cols-4 gap-1">
          {(['t', 'r', 'b', 'l'] as const).map((k) => (
            <input
              key={k}
              type="number"
              className="px-1 py-1 bg-neutral-800 border border-neutral-700 rounded"
              value={padding[k]}
              onChange={(e) => setPadding({ ...padding, [k]: Number(e.target.value) })}
            />
          ))}
        </div>
        <button
          data-testid="apply-style"
          className="mt-2 w-full px-2 py-1 bg-blue-600 rounded"
          onClick={sendStyleEdit}
        >
          Apply style
        </button>
      </div>

      {pendingDryRun && (
        <div className="text-xs text-amber-400">dry-run ready (Ctrl+S to commit)</div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Update `App.tsx`** to bootstrap WS + mount panel

```tsx
import { useEffect, useState } from 'react';
import { Iframe } from './canvas/Iframe.js';
import { Overlay } from './canvas/Overlay.js';
import { PropertiesPanel } from './panels/PropertiesPanel.js';
import { connect, type WsClient } from './wsClient.js';

export function App(): JSX.Element {
  const [client, setClient] = useState<WsClient | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session');
    if (!sessionId) return;
    const wsUrl = `ws://${location.host}/ws`;
    const c = connect(wsUrl, sessionId);
    setClient(c);
    return () => c.close();
  }, []);

  return (
    <div className="flex h-screen">
      <div className="flex-1 relative">
        <Iframe />
        <Overlay />
      </div>
      {client && <PropertiesPanel client={client} />}
    </div>
  );
}
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/editor-ui && npm test -w @visual-edit/editor-ui`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/editor-ui/
git commit -m "feat(editor-ui): properties panel (className + color + padding) with Ctrl+S commit"
```

---

### Task 20: Wire daemon to bundle editor-ui dist as the default `editorAssetsRoot` (e2e plumbing check)

**Files:**
- Modify: `packages/daemon/package.json` (add `@visual-edit/editor-ui` as a dep so the workspace places it next to daemon for resolution)
- Modify: `packages/daemon/src/cli.ts` (already has `resolveEditorAssetsRoot` from Task 14; verify it finds editor-ui's dist)
- Create: `packages/daemon/tests/cliResolvesEditorRoot.test.ts`

- [ ] **Step 1: Add the dep**

In `packages/daemon/package.json` `dependencies`:
```json
"@visual-edit/editor-ui": "*"
```

Run: `npm install`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/daemon/tests/cliResolvesEditorRoot.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('editor-ui dist resolution', () => {
  it('editor-ui has been built and dist/index.html exists for daemon to serve', () => {
    const candidates = [
      join(process.cwd(), 'packages/editor-ui/dist/index.html'),
    ];
    const found = candidates.find(existsSync);
    expect(found, `expected editor-ui dist to exist; checked ${candidates.join(', ')}`).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails (or passes if dist already present)**

Run: `npm test -w @visual-edit/daemon -- cliResolvesEditorRoot`
If FAIL: `npm run build -w @visual-edit/editor-ui` first, re-run test.

- [ ] **Step 4: Commit (mostly a wiring check + dep addition)**

```bash
git add packages/daemon/package.json package.json package-lock.json packages/daemon/tests/cliResolvesEditorRoot.test.ts
git commit -m "chore(daemon): depend on @visual-edit/editor-ui for dist resolution"
```

---

### Task 21: MCP `rollback` tool

**Files:**
- Modify: `packages/mcp-server/src/index.ts` (add `rollback` tool)
- Modify: `packages/mcp-server/src/daemonClient.ts` (add `rollback({ commitId })` method)
- Modify: `packages/protocol/src/http.ts` (add `RollbackRequest` schema + new daemon route)
- Modify: `packages/daemon/src/http.ts` (route `POST /rollback`)
- Modify: `packages/daemon/src/daemon.ts` (rollback method)
- Create: `packages/mcp-server/tests/rollback.test.ts`

- [ ] **Step 1: Add protocol schema**

In `packages/protocol/src/http.ts`, append:
```ts
export const RollbackRequest = z.object({ commitId: z.string().min(1) });
export type RollbackRequest = z.infer<typeof RollbackRequest>;
```

Build: `npm run build -w @visual-edit/protocol`.

- [ ] **Step 2: Add daemon route**

In `packages/daemon/src/http.ts`, add the `RollbackRequest` import and append a route branch:

```ts
} else if (req.method === 'POST' && req.url === '/rollback') {
  const parsed = RollbackRequest.parse(body);
  await handlers.rollback(parsed);
  send(204, null);
}
```

Add `rollback` to `HttpHandlers`:
```ts
rollback: (req: RollbackRequest) => Promise<void>;
```

In `packages/daemon/src/daemon.ts`, add a `rollback` method:

```ts
async rollback(req: { commitId: string }): Promise<void> {
  const log = readCommitLog(this.opts.root);
  const entry = log.find((e) => e.commitId === req.commitId && e.kind === 'commit');
  if (!entry) throw new Error(`unknown commitId ${req.commitId}`);
  // Find the pipeline whose file matches.
  for (const pipeline of this.editPipelines.values()) {
    const opts = (pipeline as unknown as { opts: { filePath: string } }).opts;
    if (opts.filePath === entry.filePath) { await pipeline.rollback(req.commitId); return; }
  }
  // No active pipeline — perform a one-shot rollback.
  const { rollback: rollbackFn } = await import('@visual-edit/code-mods');
  await rollbackFn({ root: this.opts.root, commitId: req.commitId });
}
```

Add the import:
```ts
import { readCommitLog } from '@visual-edit/code-mods';
```

Wire into `createHttpServer` handlers:
```ts
rollback: this.rollback.bind(this),
```

- [ ] **Step 3: Add MCP tool**

In `packages/mcp-server/src/daemonClient.ts`, add:

```ts
async rollback(commitId: string): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${this.port}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commitId }),
  });
  if (!r.ok && r.status !== 204) throw new Error(`rollback failed: ${r.status}`);
}
```

In `packages/mcp-server/src/tools.ts`, locate the existing `registerTools(server, client)` function and append a `rollback` registration that mirrors the surrounding pattern. The Phase 1.A code uses `server.registerTool(name, { inputSchema: { ...zodFields } }, async (args) => ({ content: [...] }))`. Add this block alongside the existing `open_page` / `close_preview` / `get_status` registrations:

```ts
import { z } from 'zod';

server.registerTool(
  'rollback',
  {
    title: 'Rollback a commit',
    description: 'Restore a file to its pre-commit content using the commit id from a prior visual-edit commit.',
    inputSchema: { commitId: z.string().min(1) },
  },
  async ({ commitId }: { commitId: string }) => {
    await client.rollback(commitId);
    return { content: [{ type: 'text', text: `rolled back commit ${commitId}` }] };
  },
);
```

(If the existing registration style in this repo differs — e.g. uses `server.tool(...)` instead of `registerTool(...)` — match the existing style verbatim. Read `tools.ts` first.)

- [ ] **Step 4: Write the failing test**

```ts
// packages/mcp-server/tests/rollback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DaemonClient } from '../src/daemonClient.js';

describe('DaemonClient.rollback', () => {
  it('POSTs to /rollback', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 } as Response);
    const c = new DaemonClient({ port: 1234 });
    await c.rollback('aabbccdd');
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:1234/rollback', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ commitId: 'aabbccdd' }),
    }));
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 5: Build + test**

Run: `npm run build -w @visual-edit/protocol @visual-edit/code-mods @visual-edit/daemon @visual-edit/mcp-server && npm test -w @visual-edit/mcp-server`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/ packages/daemon/ packages/protocol/
git commit -m "feat(mcp-server,daemon): rollback tool + /rollback HTTP route"
```

---

### Task 22: E2E acceptance test — full edit + commit + invariants flow

**Files:**
- Create: `tests/e2e/edit-and-commit.test.ts`
- Modify: `tests/e2e/package.json` (no changes if already configured for Playwright; if not, add Playwright steps)
- Modify: `examples/basic-vite/src/pages/Home.tsx` (no change — confirm it has at least one `<h1 className="…">`)

- [ ] **Step 1: Verify pre-conditions for the e2e**

Three quick smoke checks before writing the test (any failure = fix that thing first, then continue):

a) **Seed has an editable target.** Read `examples/basic-vite/src/pages/Home.tsx`; confirm there is at least one element with a string-literal `className` (e.g. `<h1 className="text-3xl font-bold">…</h1>`). If absent, add one with the simplest possible markup.

b) **Daemon emits a parseable "ready" signal on stdout.** Look at `packages/daemon/src/cli.ts` — the e2e waits for the literal substring `"daemon started"` on stdout. Confirm `cli.ts` calls `console.log('daemon started')` (or routes the Logger output to stdout) at the end of `start()`. If it doesn't, add a `console.log('daemon started')` after `await daemon.start();` so the e2e has a deterministic gate.

c) **mcp-server CLI accepts the `call <tool> <jsonArgs>` form.** Look at `packages/mcp-server/src/cli.ts`. The e2e invokes `node packages/mcp-server/dist/cli.js call open_page '{"root":...,"page":...}'` and expects JSON on stdout. If the CLI uses a different shape (e.g. positional args), adjust the e2e's `runCli` invocation OR update the CLI to accept this shape. Either is acceptable — pick whichever is smaller.

- [ ] **Step 2: Write the failing test**

```ts
// tests/e2e/edit-and-commit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import {
  instrument,
  apply,
  planEdits,
  assertEditEquivalence,
  assertCommentsPreserved,
  assertWhitespacePreservedOutsidePatches,
  readCommitLog,
} from '@visual-edit/code-mods';

const REPO_ROOT = resolve(__dirname, '../..');
const EXAMPLE_ROOT = resolve(REPO_ROOT, 'examples/basic-vite');
const HOME_TSX = resolve(EXAMPLE_ROOT, 'src/pages/Home.tsx');

let daemon: ChildProcess;
let browser: Browser;
let originalHome: string;

beforeAll(async () => {
  originalHome = readFileSync(HOME_TSX, 'utf8');
  daemon = spawn('node', [resolve(REPO_ROOT, 'packages/daemon/dist/cli.js'), 'start', '--root', EXAMPLE_ROOT], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait for "daemon started" line.
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('daemon start timeout')), 15_000);
    daemon.stdout!.on('data', (chunk) => {
      if (chunk.toString().includes('daemon started')) { clearTimeout(t); res(); }
    });
  });
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  daemon?.kill('SIGTERM');
  // Restore original file so the test is rerunnable locally.
  writeFileSync(HOME_TSX, originalHome, 'utf8');
});

describe('edit-and-commit e2e', () => {
  it('opens preview, selects h1, changes className, commits to disk, invariants hold', async () => {
    // Open preview via mcp-server CLI.
    const openProc = await runCli(['packages/mcp-server/dist/cli.js', 'call', 'open_page', JSON.stringify({ root: EXAMPLE_ROOT, page: 'src/pages/Home.tsx' })]);
    const { url, sessionId, editorUrl } = JSON.parse(openProc.stdout);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    expect(editorUrl).toContain(`session=${sessionId}`);

    // Boot editor-ui in a Playwright page.
    const page: Page = await browser.newPage();
    await page.goto(editorUrl);
    // Wait for snapshot to render at least one overlay rect.
    await page.waitForSelector('[data-vid-overlay]', { timeout: 15_000 });

    // Pick the first <h1> rect and click it. We can't introspect tagName from overlay alone,
    // so rely on the editor's source map exposed through window via the Zustand store.
    const h1Vid = await page.evaluate(() => {
      const w = window as unknown as { __useStore?: () => { sourceMap: Record<string, { tagName: string }> } };
      // Provided by Task 22b setup — see below in this test we patch the editor-ui to expose the store.
      // Fallback: query the iframe via postMessage round-trip.
      const sm = (window as unknown as { __VE_DEBUG_SOURCEMAP?: Record<string, { tagName: string }> }).__VE_DEBUG_SOURCEMAP;
      if (!sm) return null;
      return Object.entries(sm).find(([, e]) => e.tagName === 'h1')?.[0] ?? null;
    });
    expect(h1Vid).not.toBeNull();

    // Click the overlay for h1.
    await page.click(`[data-vid-overlay="${h1Vid}"]`);
    // Type new className and Apply.
    await page.fill('[data-testid="classname-input"]', 'text-red-500');
    await page.click('[data-testid="apply-className"]');
    // Wait for dry-run badge.
    await page.waitForSelector('text=dry-run ready', { timeout: 5_000 });
    // Ctrl+S commit.
    await page.keyboard.press('Control+S');
    // Allow the WS round-trip.
    await page.waitForTimeout(800);

    // Disk file now contains text-red-500 in the h1's className.
    const after = readFileSync(HOME_TSX, 'utf8');
    expect(after).toContain('text-red-500');

    // Run invariants on the BEFORE (original) → AFTER (current disk) using the same pipeline.
    const { instrumented: instrumentedBefore, sourceMap } = instrument(originalHome, HOME_TSX);
    const targetVid = Object.entries(sourceMap).find(([, e]) => e.tagName === 'h1')?.[0];
    expect(targetVid).toBeDefined();
    const patches = planEdits(instrumentedBefore, sourceMap, [
      { kind: 'className', element: targetVid!, newValue: 'text-red-500' },
    ]);
    const expected = apply(instrumentedBefore, patches);
    // The on-disk content is the daemon-instrumented version with our edit applied.
    expect(after).toBe(expected.after);
    expect(() => assertEditEquivalence(instrumentedBefore, after, [targetVid!])).not.toThrow();
    expect(() => assertCommentsPreserved(instrumentedBefore, after)).not.toThrow();
    expect(() => assertWhitespacePreservedOutsidePatches(instrumentedBefore, after, patches)).not.toThrow();

    // Commit log entry for the user-driven commit exists, with the right hash.
    const log = readCommitLog(EXAMPLE_ROOT);
    const userCommit = log.find((e) => e.kind === 'commit' && e.sha256After === createHash('sha256').update(after).digest('hex'));
    expect(userCommit).toBeDefined();
    // Backup of pre-commit content exists at .visual-edit/backups/Home.tsx-<commitId>.
    const backupPath = join(EXAMPLE_ROOT, '.visual-edit/backups', `Home.tsx-${userCommit!.commitId}`);
    expect(readFileSync(backupPath, 'utf8')).toContain('text-3xl'); // pre-commit className
  }, 60_000);
});

interface CliResult { stdout: string; stderr: string; }
function runCli(args: string[]): Promise<CliResult> {
  return new Promise((res, rej) => {
    const p = spawn('node', args.map((a, i) => i === 0 ? resolve(REPO_ROOT, a) : a), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => (out += c.toString()));
    p.stderr.on('data', (c) => (err += c.toString()));
    p.on('exit', (code) => code === 0 ? res({ stdout: out, stderr: err }) : rej(new Error(`exit ${code}: ${err}`)));
  });
}
```

- [ ] **Step 3: Expose source map for the e2e (small editor-ui debug hook)**

The test reads `window.__VE_DEBUG_SOURCEMAP`. Add the export in `packages/editor-ui/src/wsClient.ts` snapshot handler:

```ts
case 'snapshot':
  s.setSnapshot({ /* … existing args … */ });
  (window as unknown as { __VE_DEBUG_SOURCEMAP?: typeof msg.sourceMap }).__VE_DEBUG_SOURCEMAP = msg.sourceMap as never;
  return;
```

Rebuild editor-ui: `npm run build -w @visual-edit/editor-ui`.

- [ ] **Step 4: Run all packages' tests + e2e**

Run: `npm run build --workspaces` (or per-package). Ensure all `dist/` are fresh.

Run: `npm test -w tests/e2e -- edit-and-commit`

Expected: e2e green; original Home.tsx restored on teardown.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ packages/editor-ui/src/wsClient.ts
git commit -m "test(e2e): phase 1.b acceptance — edit + commit + invariants"
```

- [ ] **Step 6: Write phase 1.B results document**

Create `docs/superpowers/specs/2026-05-10-phase-1b-results.md` mirroring the structure of `2026-05-09-phase-1a-results.md`. Include:
- Date, outcome (PASS/FAIL on the acceptance test)
- Per-package test counts
- Bugs found + fixed during execution (running list)
- Limitations & out-of-scope (deferred to 1.C)
- GO/NO-GO decision

```bash
git add docs/superpowers/specs/2026-05-10-phase-1b-results.md
git commit -m "docs(plan): mark phase 1.B complete + results writeup"
```

---

## Self-review checklist (run after Task 22)

1. **Spec coverage** (Section 6.2 Phase 1 MVP-α minus what 1.A delivered):
   - [x] code-mods with tailwind-class + inline-style targets — Tasks 2, 3
   - [x] commit pipeline (text-patch + Windows-safe atomic write) — Task 8
   - [x] editor-ui minimal (select, color picker, padding handle, Ctrl+S) — Tasks 18, 19
   - [x] mcp-server `rollback` — Task 21
   - [x] commit log + backups + rollback — Tasks 6, 7, 9
   - [x] file watcher + recent-writes set — Tasks 12, 13
   - [x] WS protocol extended for editing — Task 10
   - [x] Daemon EditPipeline worker — Task 11
   - [x] Acceptance gate (edit on real seed + invariants) — Task 22

2. **Placeholder scan**: each step has runnable code or exact commands; no TBDs; no "similar to Task N" without code repeated.

3. **Type consistency**:
   - `Edit` discriminated union (`shared/src/edit.ts`) used everywhere — `code-mods.planEdits`, `WsEditMessage`, `editor-ui.PropertiesPanel`
   - `TextPatch` shape identical across `code-mods` (internal) and protocol Zod schema
   - `ElementSourceMap` / `ElementSourceMapEntry` defined once in `code-mods/src/types.ts`, mirrored by Zod in `protocol/src/ws.ts`
   - `EditPipeline.commit()` returns `CommitResult` from `@visual-edit/code-mods` — used in `daemon/src/ws.ts` and tests

4. **Cross-task interface check**:
   - Task 11 wires `WsHandlers.daemonPort()` — Task 13 uses it for `editorUrl`; Task 14 confirms `editorUrl` is in `OpenPreviewResponse`.
   - Task 17 (bridge) emits `{ type: 've-rects' }` — Task 18 (Iframe) listens for exactly that key.
   - Task 21 (MCP rollback) calls `daemon /rollback` — Task 21 itself adds that route.
   - Task 13 `EditPipeline.onSelfWrite` callback signature matches `FileWatcher.registerSelfWrite(filePath, sha256)`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-phase-1b-edit-and-commit.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
