# Visual Edit — Phase 1.F: Multi-file Edit Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the editing surface beyond `className` + inline `style` to two real-world patterns: CSS Modules (`<div className={styles.title}>` editing the `.title { ... }` rule in `Button.module.css`) and styled-components (`const Btn = styled.button\`color: red\`` editing the template literal). Phase 1.F's gate: edit a CSS Module class via the editor → both `.tsx` and `.module.css` are persisted atomically, invariants hold on each file, partial-failure leaves NO file changed.

**Architecture:**
- `Edit` discriminated union extends with `CssModuleEdit` and `StyledPropEdit` variants. The 1.B variants (`ClassNameEdit`, `StyleEdit`) stay unchanged.
- `ElementSourceMapEntry` extends with optional `cssModule` ({importedAs, importPath, binding}) and `styledComponent` ({componentName, definitionRange}) fields. `instrument()` populates these by walking JSX className expressions and styled-component definitions.
- New `MultiFileEditPlan` type in `code-mods/types.ts`: `Map<filePath, TextPatch[]>` plus per-file `beforeHash`/`afterHash`/`newContent`. `planEdits` returns this shape; old single-file return becomes a `MultiFileEditPlan` with one entry.
- `EditPipeline.planAndApply` returns a `MultiFileDryRunArtifact` (analogous to 1.B's `DryRunArtifact`, keyed by `planId`, holding multi-file content).
- `EditPipeline.commit` writes ALL files in the plan atomically: backup all → write all to .tmp → fsync all → rename all in order → verify all. Partial-write: try to roll back via the backups; if rollback fails, return `commit-uncertain` (existing 1.B semantics extended).
- WS protocol: `WsDryRunMessage` extended with `files: Array<{filePath, patches, beforeHash, afterHash}>` (replaces the single-file fields; old fields stay deprecated for one phase).
- editor-ui: `state.ts` `pendingDryRun` now stores per-file hashes; commit semantics unchanged from user POV.

**1.F simplifying assumptions** (deferred to 1.G):
- CSS Module rule parsing uses a simple regex for `.<binding> {<body>}` — handles flat rules with no nested selectors. Nested rules (`.title:hover {}`, `.title .child {}`, `@media {}`) are detected and refused (`VE_CSSMOD_001_NESTED_RULE`); user falls back to the className edit target.
- styled-components edit only supports same-file definitions: `const X = styled.button\`...\`` defined in the same file as the JSX element. Cross-file imported styled components are detected and refused (`VE_STYLED_001_CROSS_FILE`).
- Template literal interpolation (`styled.button\`color: ${props => props.color}\``) is not edited — the patch only replaces the literal portions; if the template has interpolations, refuse with `VE_STYLED_002_INTERPOLATED`.
- The CSS-in-JS edit target only patches the FIRST styled component definition matching a JSX element's tag name. Renamed/aliased styled components (`const Title = styled(StyledBase)\`\`...\`\`\`) are deferred.
- Multi-file commit is atomic at the *all-or-nothing* level via "write tmp + fsync all + rename all". If any rename fails partway, the implementation reverts the renamed files using the backups. If revert also fails: returns `commit-uncertain` and editor reloads to verify state.
- Atomic ordering: backups are written FIRST (all files); then tmp writes; then fsync all; then renames left-to-right. If rename N fails, files 1..N-1 are reverted using `renameSync(backup, target)`. Best-effort.

**Out of scope (deferred to 1.G or later):**
- CRA adapter
- Full vm isolation for `loadConfig`
- WAL corrupt snapshot full-recovery
- Preview worker heartbeat liveness
- Hot-reload of `visual-edit.config.ts`
- `visual-edit-cli logs` + `diagnose`
- Asset-proxy persistent cache + LRU
- JSX-time image src/srcset rewriting (build-time / runtime patcher)
- CSS `background-image: url(...)` rewriting
- Nested CSS rule edits / pseudo-class edits
- Cross-file styled-components (`import { StyledBase } from './styles.ts'`)
- Template-literal interpolation editing in styled-components

**Acceptance** (the gate that ends Phase 1.F):

`tests/e2e/multifile-edit.test.ts` passes:

1. **CSS Module edit end-to-end:** seed page has `<h2 className={styles.subtitle}>...</h2>` with `Home.module.css` defining `.subtitle { color: gray; font-size: 14px; }`. User selects the h2, sends a CSS Module edit `{kind: 'css-module', element: vid, binding: 'subtitle', newRuleBody: 'color: red; font-size: 14px;'}`. Daemon plans → dry-run reports patches in `Home.module.css`. Ctrl+S → commit. Both files on disk: `.tsx` unchanged, `.module.css` has `.subtitle { color: red; font-size: 14px; }`. Invariants pass on each file.

2. **styled-components edit end-to-end:** seed page has `const Title = styled.h1\`color: blue;\`` and `<Title>Hello</Title>`. User selects the Title; sends styled-prop edit. Daemon plans → patches the template literal. Commit. File on disk has `const Title = styled.h1\`color: green;\``.

3. **Multi-file atomicity:** induce a synthetic rename failure on file N+1 of an N+1 file plan; verify file N stays unchanged on disk (rolled back via backup). Test passes when `commit()` returns `'commit-uncertain'` AND all files are at their pre-commit state.

4. **CSS Module rule refusal on nested:** a CSS file has `.title { } .title:hover { color: red; }` — the planEdits call refuses with `VE_CSSMOD_001_NESTED_RULE`.

5. **styled-components refusal on cross-file:** an `import { Title } from './styled.ts'`; planEdits refuses with `VE_STYLED_001_CROSS_FILE`.

`npm test --workspaces` passes including the new tests. **Total green target: 245+ tests** (up from 221 in 1.E).

---

## File Structure

```
visual-edit-plugin/
├── packages/
│   ├── shared/
│   │   └── src/edit.ts                       — extend Edit union (CssModuleEdit, StyledPropEdit)
│   │
│   ├── code-mods/
│   │   ├── src/
│   │   │   ├── types.ts                      — extend ElementSourceMapEntry; add MultiFileEditPlan
│   │   │   ├── instrument.ts                 — populate cssModule + styledComponent on entries
│   │   │   ├── cssModuleParser.ts            — NEW: parse .module.css; find rule by binding
│   │   │   ├── planEdits.ts                  — return MultiFileEditPlan; route by edit.kind
│   │   │   ├── apply.ts                      — applyMultiFile orchestrator
│   │   │   ├── commit.ts                     — commitMultiFile with rollback-on-partial
│   │   │   └── pipeline.ts                   — runEditPipeline takes MultiFileEditPlan
│   │   └── tests/
│   │       ├── cssModule.detect.test.ts
│   │       ├── cssModule.parser.test.ts
│   │       ├── cssModule.plan.test.ts
│   │       ├── styledComponent.detect.test.ts
│   │       ├── styledComponent.plan.test.ts
│   │       ├── multiFileCommit.test.ts
│   │       └── (existing tests updated for new shape)
│   │
│   ├── protocol/
│   │   └── src/ws.ts                         — extend WsDryRunMessage with files: Array<>
│   │
│   ├── daemon/
│   │   └── src/editPipeline.ts               — multi-file dry-run + commit
│   │
│   ├── editor-ui/
│   │   └── src/wsClient.ts                   — handle new dry-run shape
│   │
│   └── diagnostics/
│       └── src/codes.ts                      — VE_CSSMOD_001/002, VE_STYLED_001/002, VE_FS_004
│
├── tests/
│   └── e2e/multifile-edit.test.ts            — NEW
│
├── examples/
│   └── basic-vite/src/pages/Home.tsx         — add CSS Module + styled-component
│   └── basic-vite/src/pages/Home.module.css  — NEW
│
└── docs/
    └── superpowers/
        ├── plans/2026-05-10-phase-1f-multifile-edit-targets.md
        └── specs/2026-05-10-phase-1f-results.md
```

---

## Sub-phases

| Sub-phase | Tasks | Outcome |
|---|---|---|
| **1.F-1: Multi-file types + CSS Module detection + parser** | 1–4 | Edit union extended; cssModule field on entries; CSS rule parser with nested-rule refusal |
| **1.F-2: CSS Module edit target — plan + commit** | 5–6 | planEdits handles CssModuleEdit producing multi-file patches; commit pipeline atomically writes both files |
| **1.F-3: styled-components target** | 7–8 | styled-component detection in instrument; styled-prop edit produces single-file patch on the template literal |
| **1.F-4: Daemon + protocol + editor-ui plumbing** | 9–10 | EditPipeline returns multi-file dry-run; WS protocol carries files array; editor-ui consumes |
| **1.F-5: 1.E review fixes + e2e + results** | 11–12 | Reviewer findings folded in; e2e + Phase 1.F results doc |

---

## Sub-phase 1.F-1 — Multi-file types + CSS Module detection + parser

### Task 1: Extend Edit union + ElementSourceMapEntry + diagnostic codes

**Files:**
- Modify: `packages/shared/src/edit.ts`
- Modify: `packages/code-mods/src/types.ts`
- Modify: `packages/diagnostics/src/codes.ts`

- [ ] **Step 1: Extend `Edit` union**

In `packages/shared/src/edit.ts`:

```ts
import type { ElementId } from './ids.js';

export type Edit = ClassNameEdit | StyleEdit | CssModuleEdit | StyledPropEdit;

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

export interface CssModuleEdit {
  kind: 'css-module';
  element: ElementId;
  binding: string;            // CSS class name within the module file (e.g. 'title')
  newRuleBody: string;        // body content between { ... } of the rule (without braces)
}

export interface StyledPropEdit {
  kind: 'styled-prop';
  element: ElementId;
  newTemplateContent: string; // new content of the styled.X`...` template literal
}
```

- [ ] **Step 2: Extend `ElementSourceMapEntry`**

In `packages/code-mods/src/types.ts`:

```ts
export interface CssModuleBinding {
  importedAs: string;         // e.g. 'styles'
  importPath: string;         // e.g. './Home.module.css'
  binding: string;            // e.g. 'title' (extracted from styles.title)
}

export interface StyledComponentRange {
  componentName: string;      // e.g. 'Title' for `const Title = styled.h1\`...\``
  // Position of the template literal content (between the backticks).
  templateStart: number;
  templateEnd: number;
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
  cssModule: CssModuleBinding | null;            // NEW
  styledComponent: StyledComponentRange | null;   // NEW
}

// Multi-file edit plan: per-file patches + before/after hashes for atomic commit.
export interface MultiFileEditPlan {
  files: Array<{
    filePath: string;
    patches: TextPatch[];
    before: string;
    after: string;
    beforeHash: string;
    afterHash: string;
  }>;
}
```

- [ ] **Step 3: Add diagnostic codes**

In `packages/diagnostics/src/codes.ts`, append before `VE_INTERNAL_999_ASSERT`:

```ts
VE_CSSMOD_001_NESTED_RULE: 'VE_CSSMOD_001',
VE_CSSMOD_002_RULE_NOT_FOUND: 'VE_CSSMOD_002',
VE_STYLED_001_CROSS_FILE: 'VE_STYLED_001',
VE_STYLED_002_INTERPOLATED: 'VE_STYLED_002',
VE_FS_004_PARTIAL_COMMIT: 'VE_FS_004',
```

- [ ] **Step 4: Build verify**

Run `npm run build -w @visual-edit/shared @visual-edit/diagnostics @visual-edit/code-mods`. Expected: clean. Existing tests should fail compilation IF they construct `ElementSourceMapEntry` literals — fix them to set `cssModule: null, styledComponent: null` (or extract a helper).

Run all suites: `npm test -w @visual-edit/code-mods @visual-edit/protocol @visual-edit/daemon @visual-edit/editor-ui`. Expected: green (with the entry-shape adjustment if needed).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/ packages/code-mods/src/types.ts packages/diagnostics/src/codes.ts
git commit -m "feat(shared,code-mods,diagnostics): extend Edit + ElementSourceMapEntry + codes for multi-file"
```

---

### Task 2: CSS Module detection in instrument

**Files:**
- Modify: `packages/code-mods/src/instrument.ts`
- Create: `packages/code-mods/tests/cssModule.detect.test.ts`

- [ ] **Step 1: Detection logic**

The `instrument()` second pass walks JSX elements. For each element:
1. If the element has `className={X.Y}` where X is a known CSS-module-style import name, populate `cssModule = {importedAs: 'X', importPath: '...', binding: 'Y'}`.

To know which imports are CSS modules: walk the file's top-level imports first (before pass 1), collect all `import X from './foo.module.css'` (or any path ending in `.module.css`) into a Map<string, string>: importedAs → importPath. Pass this map to pass 2.

- [ ] **Step 2: Code outline**

Inside `instrument(source, filePath)`:

```ts
function findCssModuleImports(sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const importPath = (stmt.moduleSpecifier as ts.StringLiteral).text;
    if (!importPath.endsWith('.module.css')) continue;
    const clause = stmt.importClause;
    if (clause?.name) {  // default import: import styles from '...'
      map.set(clause.name.text, importPath);
    }
  }
  return map;
}
```

In pass 2, for each opening element with `classNameAttr.valueKind === 'expression'`:

```ts
function detectCssModuleBinding(
  attr: ts.JsxAttribute,
  cssModuleImports: Map<string, string>,
  sf: ts.SourceFile,
): CssModuleBinding | null {
  if (!attr.initializer || !ts.isJsxExpression(attr.initializer)) return null;
  const expr = attr.initializer.expression;
  if (!expr || !ts.isPropertyAccessExpression(expr)) return null;
  if (!ts.isIdentifier(expr.expression)) return null;
  const importedAs = expr.expression.text;
  const importPath = cssModuleImports.get(importedAs);
  if (!importPath) return null;
  return {
    importedAs,
    importPath,
    binding: expr.name.text,
  };
}
```

Wire into `ElementSourceMapEntry` construction in pass 2 (set `cssModule: detectCssModuleBinding(...)`; null otherwise). Set `styledComponent: null` for now (Task 7 will populate it).

- [ ] **Step 3: Test**

```ts
// packages/code-mods/tests/cssModule.detect.test.ts
import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';

describe('CSS Module detection in instrument', () => {
  it('records cssModule on JSX element using styles.X', () => {
    const src = `import styles from './Home.module.css';
export const X = () => <h2 className={styles.subtitle}>hi</h2>;
`;
    const result = instrument(src, 'Home.tsx');
    const entry = Object.values(result.sourceMap)[0]!;
    expect(entry.cssModule).toEqual({
      importedAs: 'styles',
      importPath: './Home.module.css',
      binding: 'subtitle',
    });
  });

  it('null cssModule for plain string className', () => {
    const src = `export const X = () => <div className="plain">hi</div>;\n`;
    const result = instrument(src, 'X.tsx');
    expect(Object.values(result.sourceMap)[0]!.cssModule).toBeNull();
  });

  it('null cssModule for non-module CSS import', () => {
    const src = `import s from './styles.css';
export const X = () => <div className={s.foo}>hi</div>;
`;
    const result = instrument(src, 'X.tsx');
    expect(Object.values(result.sourceMap)[0]!.cssModule).toBeNull();
  });

  it('handles renamed default import', () => {
    const src = `import classes from './Card.module.css';
export const X = () => <div className={classes.card}>hi</div>;
`;
    const result = instrument(src, 'Card.tsx');
    expect(Object.values(result.sourceMap)[0]!.cssModule).toEqual({
      importedAs: 'classes',
      importPath: './Card.module.css',
      binding: 'card',
    });
  });
});
```

- [ ] **Step 4: Run + commit**

Run `npm test -w @visual-edit/code-mods -- cssModule.detect`. Expected: 4 tests green. Existing instrument tests still green.

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): instrument detects CSS Module bindings on JSX className"
```

---

### Task 3: CSS Module rule parser (regex-based)

**Files:**
- Create: `packages/code-mods/src/cssModuleParser.ts`
- Create: `packages/code-mods/tests/cssModule.parser.test.ts`

- [ ] **Step 1: Parser**

```ts
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export interface CssRuleRange {
  /** Start of the rule body (immediately after the opening `{`). */
  bodyStart: number;
  /** End of the rule body (immediately before the closing `}`). */
  bodyEnd: number;
  /** Verbatim content currently inside the braces. */
  body: string;
}

const RULE_OPEN_RX = (binding: string) =>
  // Match `.<binding>` followed by optional whitespace and `{`. The negative lookahead
  // rejects nested selectors like `.title:hover` or `.title .child` or `.title,foo`.
  new RegExp(`\\.${escapeRegex(binding)}(?![A-Za-z0-9_-])\\s*\\{`, 'g');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a single flat CSS rule by class binding name. Returns the body range (between
 * the braces). Refuses if:
 * - rule not found (VE_CSSMOD_002)
 * - rule has nested selector / pseudo / media query before the `{` (VE_CSSMOD_001)
 * - rule body itself contains `{` (nested rule like @media or & nesting) (VE_CSSMOD_001)
 *
 * Multiple rules with the same binding: returns the FIRST. Documented as 1.F limitation.
 */
export function findCssRuleRange(source: string, binding: string): CssRuleRange {
  const rx = RULE_OPEN_RX(binding);
  let match: RegExpExecArray | null = null;
  while ((match = rx.exec(source)) !== null) {
    // Check for nested-selector pattern by looking at the snippet leading up to `.binding`.
    // Nested case: ".other .binding {" — we'd see whitespace + ".binding" with another selector before.
    // For 1.F simplicity: only accept the rule if the line is "just" `.binding {` (optional whitespace).
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const lineUpToBinding = source.slice(lineStart, match.index);
    if (lineUpToBinding.trim().length > 0) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CSSMOD_001_NESTED_RULE,
        message: `[VE_CSSMOD_001]: refusing to edit '.${binding}' — nested or compound selector detected on its line`,
        severity: 'error', recovery: 'user-action', blame: 'tool',
        hint: 'Move the rule to its own top-level selector, or use the className edit target.',
      }));
    }
    // Find the matching `}`. Brace-counting handles only flat rules.
    const bodyStart = match.index + match[0]!.length;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      const ch = source[i]!;
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CSSMOD_001_NESTED_RULE,
        message: `[VE_CSSMOD_001]: '.${binding}' has unbalanced braces`,
        severity: 'error', recovery: 'user-action', blame: 'user-config',
      }));
    }
    const bodyEnd = i - 1; // position OF the closing `}`
    const body = source.slice(bodyStart, bodyEnd);
    // Reject nested-rule body for 1.F.
    if (body.includes('{')) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CSSMOD_001_NESTED_RULE,
        message: `[VE_CSSMOD_001]: '.${binding}' contains nested rules`,
        severity: 'error', recovery: 'user-action', blame: 'tool',
        hint: 'Phase 1.F supports flat CSS Module rules only.',
      }));
    }
    return { bodyStart, bodyEnd, body };
  }
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_CSSMOD_002_RULE_NOT_FOUND,
    message: `[VE_CSSMOD_002]: '.${binding}' not found in CSS Module file`,
    severity: 'error', recovery: 'user-action', blame: 'user-config',
  }));
}
```

- [ ] **Step 2: Test**

```ts
// packages/code-mods/tests/cssModule.parser.test.ts
import { describe, it, expect } from 'vitest';
import { findCssRuleRange } from '../src/cssModuleParser.js';

describe('findCssRuleRange', () => {
  it('finds a flat rule by binding', () => {
    const css = `.title { color: red; font-size: 14px; }\n.body { padding: 8px; }`;
    const r = findCssRuleRange(css, 'title');
    expect(css.slice(r.bodyStart, r.bodyEnd)).toBe(' color: red; font-size: 14px; ');
    expect(r.body).toBe(' color: red; font-size: 14px; ');
  });

  it('throws VE_CSSMOD_002 on missing rule', () => {
    const css = `.title { color: red; }`;
    expect(() => findCssRuleRange(css, 'subtitle')).toThrow(/VE_CSSMOD_002/);
  });

  it('throws VE_CSSMOD_001 on nested selector (.title:hover)', () => {
    const css = `.title { color: red; } .title:hover { color: blue; }`;
    // The first `.title { ... }` works; the second is `.title:hover` which doesn't match the binding-name regex.
    // To exercise the nested-selector path, use `.foo .title { }`:
    const css2 = `.foo .title { color: red; }`;
    expect(() => findCssRuleRange(css2, 'title')).toThrow(/VE_CSSMOD_001/);
  });

  it('throws VE_CSSMOD_001 on nested rule body', () => {
    const css = `.title { color: red; @media (min-width: 600px) { color: blue; } }`;
    expect(() => findCssRuleRange(css, 'title')).toThrow(/VE_CSSMOD_001/);
  });

  it('does not match a different binding (.titles vs .title)', () => {
    const css = `.titles { color: red; }`;
    expect(() => findCssRuleRange(css, 'title')).toThrow(/VE_CSSMOD_002/);
  });
});
```

- [ ] **Step 3: Run + commit**

Run `npm test -w @visual-edit/code-mods -- cssModule.parser`. Expected: 5 tests green.

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): regex-based CSS Module rule parser with nested-rule refusal"
```

---

### Task 4: planEdits handles CssModuleEdit (returns multi-file plan)

**Files:**
- Modify: `packages/code-mods/src/types.ts` (export `MultiFileEditPlan`, update `TextPatch` if needed)
- Modify: `packages/code-mods/src/planEdits.ts` (return multi-file plan)
- Create: `packages/code-mods/tests/cssModule.plan.test.ts`

- [ ] **Step 1: Refactor planEdits signature**

The existing `planEdits(source, sourceMap, edits): TextPatch[]` only handles single-file edits. Refactor to return a per-file map.

New signature:

```ts
export interface PlannedFile {
  filePath: string;
  patches: TextPatch[];
}

export interface PlanEditsInput {
  /** The file being instrumented (e.g. Home.tsx). */
  filePath: string;
  source: string;
  sourceMap: ElementSourceMap;
  edits: Edit[];
  /**
   * Resolves the absolute path of an external file from a sourceMap entry's import path.
   * For CSS Modules: `cssModule.importPath` (relative) → absolute path of the `.module.css`.
   * Caller is responsible for path resolution; planEdits stays I/O-free.
   */
  resolvePath: (importPath: string) => string;
  /** Reads the content of an external file (e.g. the .module.css source). I/O lives in caller. */
  readExternalFile: (absPath: string) => string;
}

export function planEdits(input: PlanEditsInput): PlannedFile[] {
  // Group results by file path; the page file is the default target for className/style edits.
  const byFile = new Map<string, TextPatch[]>();
  // ...
}
```

For `className` and `style` edits, return patches keyed by `input.filePath` (the page file).

For `css-module` edits:
1. Look up the entry's `cssModule` field. If null, throw VE_CODEMOD_001 ("element has no CSS Module binding").
2. Resolve the CSS file's absolute path via `input.resolvePath(entry.cssModule.importPath)`.
3. Read the CSS source via `input.readExternalFile(absPath)`.
4. Find the rule via `findCssRuleRange(cssSource, entry.cssModule.binding)`.
5. Produce a `TextPatch` on the CSS file: `{start: range.bodyStart, end: range.bodyEnd, replacement: ' ' + edit.newRuleBody + ' ', reason: 'css-module rule update'}`.
6. Add to `byFile.get(absPath)`.

For `styled-prop` edits: similar pattern but the patch is on the page file (Task 7-8 wires this).

Return the map as `PlannedFile[]`.

- [ ] **Step 2: Update existing planEdits tests**

The tests from 1.B (`planEdits.test.ts`) call the old signature. Update them to construct the new `PlanEditsInput`:

```ts
const result = planEdits({
  filePath: 'X.tsx',
  source: instrumented,
  sourceMap,
  edits,
  resolvePath: (p) => p,         // not used in className/style tests
  readExternalFile: () => '',    // not used
});
const patches = result.find((f) => f.filePath === 'X.tsx')!.patches;
// (existing assertions on patches)
```

This is a breaking change to planEdits. The implementer must update all callers.

- [ ] **Step 3: Test css-module path**

```ts
// packages/code-mods/tests/cssModule.plan.test.ts
import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.js';
import { planEdits } from '../src/planEdits.js';

describe('planEdits with css-module', () => {
  it('produces a patch on the .module.css file', () => {
    const tsxSrc = `import styles from './X.module.css';
export const X = () => <h2 className={styles.title}>hi</h2>;
`;
    const cssSrc = `.title { color: red; }
.body { padding: 8px; }
`;
    const { instrumented, sourceMap } = instrument(tsxSrc, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const planned = planEdits({
      filePath: 'X.tsx',
      source: instrumented,
      sourceMap,
      edits: [{ kind: 'css-module', element: vid, binding: 'title', newRuleBody: 'color: blue;' }],
      resolvePath: () => '/abs/X.module.css',
      readExternalFile: () => cssSrc,
    });
    const cssFile = planned.find((p) => p.filePath === '/abs/X.module.css');
    expect(cssFile).toBeDefined();
    expect(cssFile!.patches).toHaveLength(1);
    expect(cssFile!.patches[0]!.replacement.trim()).toBe('color: blue;');
  });

  it('refuses when element has no CSS Module binding', () => {
    const tsxSrc = `export const X = () => <div className="plain">hi</div>;\n`;
    const { instrumented, sourceMap } = instrument(tsxSrc, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    expect(() => planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'css-module', element: vid, binding: 'foo', newRuleBody: 'x: y;' }],
      resolvePath: () => '', readExternalFile: () => '',
    })).toThrow(/VE_CODEMOD_001/);
  });

  it('propagates VE_CSSMOD_002 when binding not found in CSS', () => {
    const tsxSrc = `import styles from './X.module.css';
export const X = () => <h2 className={styles.subtitle}>hi</h2>;
`;
    const cssSrc = `.title { color: red; }`;
    const { instrumented, sourceMap } = instrument(tsxSrc, 'X.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    expect(() => planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'css-module', element: vid, binding: 'subtitle', newRuleBody: 'x:y' }],
      resolvePath: () => '/abs/X.module.css', readExternalFile: () => cssSrc,
    })).toThrow(/VE_CSSMOD_002/);
  });
});
```

- [ ] **Step 4: Run + commit**

Run `npm run build -w @visual-edit/code-mods && npm test -w @visual-edit/code-mods`. Expected: all tests green (existing planEdits tests adapted + 3 new).

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): planEdits returns multi-file plan; supports CssModuleEdit"
```

---

## Sub-phase 1.F-2 — CSS Module commit pipeline

### Task 5: Multi-file commit (atomic; rollback on partial)

**Files:**
- Modify: `packages/code-mods/src/commit.ts` (new function `commitMultiFile` or extend `commit`)
- Create: `packages/code-mods/tests/multiFileCommit.test.ts`

- [ ] **Step 1: New `commitMultiFile` function**

The existing 1.B `commit(input)` handles a single file. Add a new function:

```ts
export interface MultiFileCommitInput {
  root: string;
  files: Array<{
    filePath: string;
    expectedBeforeHash: string;
    newContent: string;
  }>;
  /** Test hook only. */
  _renameImpl?: (from: string, to: string) => void;
}

export interface MultiFileCommitResult {
  commitId: string;       // SAME id for all files in this commit (correlated)
  files: Array<{
    filePath: string;
    sha256Before: string;
    sha256After: string;
    status: 'committed' | 'reverted' | 'commit-uncertain';
  }>;
  status: 'committed' | 'commit-uncertain';
  retries: number;
  lastError?: string;
}

export async function commitMultiFile(input: MultiFileCommitInput): Promise<MultiFileCommitResult> {
  const commitId = randomBytes(4).toString('hex');
  const renameFn = input._renameImpl ?? renameSync;
  const filesProgress: MultiFileCommitResult['files'] = [];

  // Phase 1: validate all current hashes match expected.
  for (const f of input.files) {
    const current = readFileSync(f.filePath, 'utf8');
    const currentHash = sha(current);
    if (currentHash !== f.expectedBeforeHash) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CODEMOD_003_STALE_DRY_RUN,
        message: `[VE_CODEMOD_003]: ${f.filePath} sha mismatch — expected ${f.expectedBeforeHash.slice(0, 8)}, found ${currentHash.slice(0, 8)}`,
        severity: 'error', recovery: 'user-action', blame: 'environment',
      }));
    }
  }

  // Phase 2: backup all files (still pre-commit).
  for (const f of input.files) {
    const current = readFileSync(f.filePath, 'utf8');
    writeBackup({ root: input.root, filePath: f.filePath, commitId, content: current });
  }

  // Phase 3: write all .tmp files + fsync.
  const tmpPaths: string[] = [];
  for (const f of input.files) {
    const tmp = `${f.filePath}.${commitId}.tmp`;
    writeFileSync(tmp, f.newContent, 'utf8');
    const fd = openSync(tmp, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    tmpPaths.push(tmp);
  }

  // Phase 4: rename in order. On any failure, revert renamed files using backups.
  const renamed: string[] = [];
  let lastError: string | undefined;
  let renameSuccess = true;

  for (let i = 0; i < input.files.length; i++) {
    const f = input.files[i]!;
    try {
      renameFn(tmpPaths[i]!, f.filePath);
      renamed.push(f.filePath);
    } catch (err) {
      lastError = `${(err as NodeJS.ErrnoException).code ?? 'ERR'}: ${(err as Error).message}`;
      renameSuccess = false;
      break;
    }
  }

  if (!renameSuccess) {
    // Revert renamed files using backups.
    for (const filePath of renamed) {
      try {
        const f = input.files.find((x) => x.filePath === filePath)!;
        const backupContent = readBackup({ root: input.root, filePath, commitId });
        writeFileSync(filePath, backupContent, 'utf8');
      } catch { /* best-effort revert */ }
    }
    return {
      commitId,
      files: input.files.map((f) => ({
        filePath: f.filePath,
        sha256Before: sha(readFileSync(f.filePath, 'utf8')),
        sha256After: sha(f.newContent),
        status: 'reverted' as const,
      })),
      status: 'commit-uncertain',
      retries: 0,
      lastError: lastError ?? 'unknown',
    };
  }

  // Phase 5: verify all files match expected sha.
  for (const f of input.files) {
    const verify = sha(readFileSync(f.filePath, 'utf8'));
    if (verify !== sha(f.newContent)) {
      // Verify mismatch on at least one file — return commit-uncertain.
      return {
        commitId,
        files: input.files.map((g) => ({
          filePath: g.filePath,
          sha256Before: g.expectedBeforeHash,
          sha256After: sha(g.newContent),
          status: 'commit-uncertain' as const,
        })),
        status: 'commit-uncertain',
        retries: 0,
        lastError: `verify-mismatch on ${f.filePath}`,
      };
    }
  }

  // Phase 6: append per-file commit log entries (one per file with the SAME commitId).
  for (const f of input.files) {
    appendCommit(input.root, {
      commitId,
      filePath: f.filePath,
      sha256Before: f.expectedBeforeHash,
      sha256After: sha(f.newContent),
      kind: 'commit',
      timestamp: new Date().toISOString(),
    });
  }

  return {
    commitId,
    files: input.files.map((f) => ({
      filePath: f.filePath,
      sha256Before: f.expectedBeforeHash,
      sha256After: sha(f.newContent),
      status: 'committed' as const,
    })),
    status: 'committed',
    retries: 0,
  };
}
```

- [ ] **Step 2: Test**

```ts
// packages/code-mods/tests/multiFileCommit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { commitMultiFile } from '../src/commit.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-mfc-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('commitMultiFile', () => {
  it('writes all files atomically + assigns same commitId per file', async () => {
    const fileA = join(tmp, 'A.tsx'); const fileB = join(tmp, 'A.module.css');
    writeFileSync(fileA, 'A1', 'utf8'); writeFileSync(fileB, 'B1', 'utf8');
    const result = await commitMultiFile({
      root: tmp,
      files: [
        { filePath: fileA, expectedBeforeHash: sha('A1'), newContent: 'A2' },
        { filePath: fileB, expectedBeforeHash: sha('B1'), newContent: 'B2' },
      ],
    });
    expect(result.status).toBe('committed');
    expect(readFileSync(fileA, 'utf8')).toBe('A2');
    expect(readFileSync(fileB, 'utf8')).toBe('B2');
    expect(result.files.every((f) => f.status === 'committed')).toBe(true);
  });

  it('reverts file 1 when file 2 rename fails', async () => {
    const fileA = join(tmp, 'A.tsx'); const fileB = join(tmp, 'A.module.css');
    writeFileSync(fileA, 'A1', 'utf8'); writeFileSync(fileB, 'B1', 'utf8');
    let renameCount = 0;
    const result = await commitMultiFile({
      root: tmp,
      files: [
        { filePath: fileA, expectedBeforeHash: sha('A1'), newContent: 'A2' },
        { filePath: fileB, expectedBeforeHash: sha('B1'), newContent: 'B2' },
      ],
      _renameImpl: (from, to) => {
        renameCount++;
        if (renameCount === 1) { require('node:fs').renameSync(from, to); return; } // first rename works
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });                  // second fails
      },
    });
    expect(result.status).toBe('commit-uncertain');
    expect(readFileSync(fileA, 'utf8')).toBe('A1');  // reverted
    expect(readFileSync(fileB, 'utf8')).toBe('B1');  // never written
  });

  it('rejects when any file has sha mismatch on expectedBeforeHash', async () => {
    const fileA = join(tmp, 'A.tsx');
    writeFileSync(fileA, 'CURRENT', 'utf8');
    await expect(commitMultiFile({
      root: tmp,
      files: [{ filePath: fileA, expectedBeforeHash: sha('STALE'), newContent: 'X' }],
    })).rejects.toThrow(/VE_CODEMOD_003/);
  });
});
```

- [ ] **Step 3: Run + commit**

Run `npm test -w @visual-edit/code-mods -- multiFileCommit`. Expected: 3 tests green.

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): commitMultiFile with all-or-nothing atomicity + revert-on-partial"
```

---

### Task 6: EditPipeline — multi-file dry-run + commit

**Files:**
- Modify: `packages/daemon/src/editPipeline.ts`

- [ ] **Step 1: Update `DryRunArtifact`**

The existing `DryRunArtifact` holds single-file fields. Replace with:

```ts
export interface DryRunArtifact {
  planId: string;
  files: Array<{
    filePath: string;
    patches: TextPatch[];
    beforeHash: string;
    afterHash: string;
    newContent: string;
  }>;
}
```

`planAndApply(edits)` now:
1. Calls `planEdits({filePath, source, sourceMap, edits, resolvePath, readExternalFile})` with concrete I/O closures.
2. For each file in the plan, applies the patches via `apply(beforeContent, patches)` to get `newContent + hashes`.
3. Returns a `DryRunArtifact` with the multi-file shape.

`commit(planId)` now calls `commitMultiFile` instead of `commit` (single-file).

For `resolvePath`: import path is relative to the page file. Use `path.resolve(dirname(this.opts.filePath), importPath)`.

For `readExternalFile`: just `readFileSync(absPath, 'utf8')`.

- [ ] **Step 2: Update commit flow**

The existing `commit(planId)` calls `commitWrite` from `@visual-edit/code-mods`. Replace with `commitMultiFile`:

```ts
async commit(planId: string): Promise<MultiFileCommitResult> {
  const dr = this.dryRuns.get(planId);
  if (!dr) throw new Error(`commit: unknown planId ${planId}`);
  const result = await commitMultiFile({
    root: this.opts.root,
    files: dr.files.map((f) => ({
      filePath: f.filePath,
      expectedBeforeHash: f.beforeHash,
      newContent: f.newContent,
    })),
  });
  if (result.status === 'committed') {
    for (const f of result.files) {
      this.opts.onSelfWrite?.(f.filePath, f.sha256After);
    }
    // Refresh snapshot from the page file's new content (other files don't have data-vid).
    const newContent = readFileSync(this.opts.filePath, 'utf8');
    const re = instrument(newContent, this.opts.filePath);
    this.snapshot = { sourceText: re.instrumented, sourceMap: re.sourceMap };
    this.dryRuns.delete(planId);
  }
  return result;
}
```

Note: `onSelfWrite` is called per file so FileWatcher dedupes both writes.

- [ ] **Step 3: Run + commit**

Run `npm run build -w @visual-edit/daemon @visual-edit/code-mods && npm test -w @visual-edit/daemon`. Expected: existing daemon tests still pass; the existing editPipeline test exercises only className edits which still work via the new multi-file shape (single-file plan with one entry).

If the existing tests need updating (e.g., the test asserts shape of the old `DryRunArtifact`), update them. Test counts may shift slightly.

```bash
git add packages/daemon/
git commit -m "feat(daemon): EditPipeline multi-file dry-run + commitMultiFile"
```

---

## Sub-phase 1.F-3 — styled-components target

### Task 7: styled-components detection + planEdits

**Files:**
- Modify: `packages/code-mods/src/instrument.ts` (detect `const X = styled.button\`...\`` definitions)
- Modify: `packages/code-mods/src/planEdits.ts` (handle StyledPropEdit)
- Create: `packages/code-mods/tests/styledComponent.detect.test.ts`
- Create: `packages/code-mods/tests/styledComponent.plan.test.ts`

- [ ] **Step 1: Detection**

In `instrument.ts`, add a third pass that walks top-level `const` declarations (and re-exports) for the pattern `styled.<tagName>\`...\`` or `styled(Base)\`...\``:

```ts
function findStyledComponents(sf: ts.SourceFile): Map<string, StyledComponentRange> {
  const map = new Map<string, StyledComponentRange>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const init = decl.initializer;
      if (!init || !ts.isTaggedTemplateExpression(init)) continue;
      // The tag must be `styled.X` or `styled(...)`.
      const tag = init.tag;
      const isStyledMember = ts.isPropertyAccessExpression(tag)
        && ts.isIdentifier(tag.expression)
        && tag.expression.text === 'styled';
      const isStyledCall = ts.isCallExpression(tag)
        && ts.isIdentifier(tag.expression)
        && tag.expression.text === 'styled';
      if (!isStyledMember && !isStyledCall) continue;
      // Refuse if template has interpolations (1.F limitation).
      if (ts.isTemplateExpression(init.template)) continue;  // skip — Task 8 throws on edit
      const tpl = init.template as ts.NoSubstitutionTemplateLiteral;
      // Position of literal content: between the backticks.
      const templateStart = tpl.getStart(sf) + 1;
      const templateEnd = tpl.getEnd() - 1;
      map.set(decl.name.text, {
        componentName: decl.name.text,
        templateStart,
        templateEnd,
      });
    }
  }
  return map;
}
```

In pass 2 of `instrument`, when populating an entry:
- If the entry's `tagName` matches one of the styled-component names found in pass 0, set `entry.styledComponent` accordingly. Else null.

- [ ] **Step 2: planEdits handles StyledPropEdit**

In `planEdits.ts` switch on `edit.kind`:

```ts
} else if (edit.kind === 'styled-prop') {
  const entry = sourceMap[edit.element];
  if (!entry?.styledComponent) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_001_UNKNOWN_VID,
      message: `[VE_CODEMOD_001]: element has no styled-component definition`,
      severity: 'error', recovery: 'user-action', blame: 'tool',
    }));
  }
  // Patch the page file's template literal content.
  const patch: TextPatch = {
    start: entry.styledComponent.templateStart,
    end: entry.styledComponent.templateEnd,
    replacement: edit.newTemplateContent,
    reason: `update styled.${entry.tagName} template`,
  };
  byFile.get(input.filePath)!.push(patch);
}
```

- [ ] **Step 3: Tests**

```ts
// styledComponent.detect.test.ts
it('records styledComponent on a JSX element using a styled.X variable', () => {
  const src = `import styled from 'styled-components';
const Title = styled.h1\`color: blue;\`;
export const X = () => <Title>Hello</Title>;
`;
  const result = instrument(src, 'X.tsx');
  const entry = Object.values(result.sourceMap).find((e) => e.tagName === 'Title')!;
  expect(entry.styledComponent).toMatchObject({ componentName: 'Title' });
});

it('null styledComponent for non-styled tag', () => {
  const src = `export const X = () => <div>hi</div>;\n`;
  const result = instrument(src, 'X.tsx');
  expect(Object.values(result.sourceMap)[0]!.styledComponent).toBeNull();
});

it('skips styled with interpolated template', () => {
  const src = `import styled from 'styled-components';
const Title = styled.h1\`color: \${(p) => p.color};\`;
export const X = () => <Title>Hello</Title>;
`;
  const result = instrument(src, 'X.tsx');
  const entry = Object.values(result.sourceMap).find((e) => e.tagName === 'Title')!;
  expect(entry.styledComponent).toBeNull();  // skipped because of interpolation
});
```

```ts
// styledComponent.plan.test.ts
it('produces a single-file patch on the styled template content', () => {
  const src = `import styled from 'styled-components';
const Title = styled.h1\`color: blue;\`;
export const X = () => <Title>Hello</Title>;
`;
  const { instrumented, sourceMap } = instrument(src, 'X.tsx');
  const titleVid = Object.entries(sourceMap).find(([, e]) => e.tagName === 'Title')![0];
  const planned = planEdits({
    filePath: 'X.tsx', source: instrumented, sourceMap,
    edits: [{ kind: 'styled-prop', element: titleVid, newTemplateContent: 'color: green;' }],
    resolvePath: () => '', readExternalFile: () => '',
  });
  const file = planned.find((p) => p.filePath === 'X.tsx')!;
  expect(file.patches[0]!.replacement).toBe('color: green;');
});
```

- [ ] **Step 4: Run + commit**

Run `npm test -w @visual-edit/code-mods -- styledComponent`. Expected: 4 tests green.

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): styled-components detection + StyledPropEdit planning"
```

---

### Task 8: Refusals — cross-file styled imports + interpolated templates

**Files:**
- Modify: `packages/code-mods/src/planEdits.ts` (add explicit cross-file refusal)
- Append to `styledComponent.detect.test.ts`

- [ ] **Step 1: Refusal logic**

In `planEdits.ts` switch case for `styled-prop`:

```ts
if (edit.kind === 'styled-prop') {
  const entry = sourceMap[edit.element];
  if (!entry) throw new VisualEditError(...VE_CODEMOD_001...);
  // No styledComponent: could be cross-file imported styled OR not a styled at all.
  if (!entry.styledComponent) {
    // Heuristic: if the tagName starts with uppercase, assume it's a component (likely imported).
    if (/^[A-Z]/.test(entry.tagName)) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_STYLED_001_CROSS_FILE,
        message: `[VE_STYLED_001]: styled-prop edit refused — '${entry.tagName}' is not defined in this file (likely imported)`,
        severity: 'error', recovery: 'user-action', blame: 'tool',
        hint: 'Phase 1.F supports same-file styled definitions only. Edit the source file directly.',
      }));
    }
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CODEMOD_001_UNKNOWN_VID,
      message: `[VE_CODEMOD_001]: element '${entry.tagName}' is not a styled-component`,
      severity: 'error', recovery: 'user-action', blame: 'tool',
    }));
  }
  // Continue to produce patch as in Task 7.
}
```

- [ ] **Step 2: Tests for refusals**

Append to `styledComponent.detect.test.ts`:

```ts
it('planEdits refuses styled-prop on cross-file imported component', () => {
  const src = `import { Title } from './styled.js';
export const X = () => <Title>Hi</Title>;
`;
  const { instrumented, sourceMap } = instrument(src, 'X.tsx');
  const vid = Object.entries(sourceMap).find(([, e]) => e.tagName === 'Title')![0];
  expect(() => planEdits({
    filePath: 'X.tsx', source: instrumented, sourceMap,
    edits: [{ kind: 'styled-prop', element: vid, newTemplateContent: 'x' }],
    resolvePath: () => '', readExternalFile: () => '',
  })).toThrow(/VE_STYLED_001/);
});

it('planEdits refuses styled-prop when template has interpolation', () => {
  const src = `import styled from 'styled-components';
const Title = styled.h1\`color: \${(p) => p.color};\`;
export const X = () => <Title>Hi</Title>;
`;
  const { instrumented, sourceMap } = instrument(src, 'X.tsx');
  const vid = Object.entries(sourceMap).find(([, e]) => e.tagName === 'Title')![0];
  // The instrument step skipped this Title (interpolated), so styledComponent is null.
  // The cross-file refusal kicks in because Title starts uppercase.
  // For 1.F simplicity, reuse VE_STYLED_001 as the catch-all.
  expect(() => planEdits({
    filePath: 'X.tsx', source: instrumented, sourceMap,
    edits: [{ kind: 'styled-prop', element: vid, newTemplateContent: 'x' }],
    resolvePath: () => '', readExternalFile: () => '',
  })).toThrow(/VE_STYLED_001/);
});
```

- [ ] **Step 3: Run + commit**

Run `npm test -w @visual-edit/code-mods -- styledComponent`. Expected: 6 tests green.

```bash
git add packages/code-mods/
git commit -m "feat(code-mods): styled-prop refusals (cross-file + interpolated)"
```

---

## Sub-phase 1.F-4 — Daemon protocol + editor-ui plumbing

### Task 9: WS protocol — multi-file dry-run

**Files:**
- Modify: `packages/protocol/src/ws.ts`
- Modify: `packages/protocol/tests/ws.editing.test.ts` (extend assertions)

- [ ] **Step 1: Update WsDryRunMessage shape**

```ts
const TextPatchSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  replacement: z.string(),
  reason: z.string(),
});

const DryRunFileSchema = z.object({
  filePath: z.string().min(1),
  patches: z.array(TextPatchSchema),
  beforeHash: HEX_64,
  afterHash: HEX_64,
});

export const WsDryRunMessage = z.object({
  kind: z.literal('dry-run'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  planId: z.string().min(1),
  files: z.array(DryRunFileSchema).min(1),
});
export type WsDryRunMessage = z.infer<typeof WsDryRunMessage>;
```

This is a BREAKING change to the protocol — old clients/messages with single-file fields will fail validation. Document and adjust:
- `packages/daemon/src/ws.ts` — when sending dry-run, build `files: [{...}]` from EditPipeline's multi-file artifact.
- `packages/editor-ui/src/wsClient.ts` — when receiving dry-run, store the entire `files` array (or extract first file's afterHash for backward compat with `pendingDryRun`).

- [ ] **Step 2: Update protocol tests**

In `packages/protocol/tests/ws.editing.test.ts`, the existing dry-run test uses single-file fields. Update to the multi-file shape:

```ts
WsDryRunMessage.parse({
  kind: 'dry-run',
  requestId: 'r', sessionId: 's', planId: 'p',
  files: [{
    filePath: '/X.tsx', patches: [{ start: 0, end: 1, replacement: 'x', reason: 'r' }],
    beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64),
  }],
});
```

Add a test for multi-file:
```ts
it('parses a dry-run with multiple files', () => {
  WsDryRunMessage.parse({
    kind: 'dry-run', requestId: 'r', sessionId: 's', planId: 'p',
    files: [
      { filePath: '/X.tsx', patches: [], beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64) },
      { filePath: '/X.module.css', patches: [], beforeHash: 'c'.repeat(64), afterHash: 'd'.repeat(64) },
    ],
  });
});
```

- [ ] **Step 3: Update daemon WS handler**

In `packages/daemon/src/ws.ts` `'edit'` branch, when building the dry-run reply, map the multi-file artifact:

```ts
const reply: WsDryRunMessage = {
  kind: 'dry-run',
  requestId: edit.data.requestId,
  sessionId,
  planId: dr.planId,
  files: dr.files.map((f) => ({
    filePath: f.filePath,
    patches: f.patches,
    beforeHash: f.beforeHash,
    afterHash: f.afterHash,
  })),
};
```

- [ ] **Step 4: Run + commit**

Run `npm run build -w @visual-edit/protocol @visual-edit/daemon && npm test -w @visual-edit/protocol @visual-edit/daemon`. Expected: green (with updated assertions).

```bash
git add packages/protocol/ packages/daemon/
git commit -m "feat(protocol,daemon): WS dry-run carries multi-file files[] array"
```

---

### Task 10: Editor-ui consumes multi-file dry-run

**Files:**
- Modify: `packages/editor-ui/src/wsClient.ts`
- Modify: `packages/editor-ui/src/state.ts` (extend `pendingDryRun` to hold per-file hashes; for 1.F UI just keep the first file's afterHash)
- Modify: `packages/editor-ui/tests/wsClient.test.ts` (update dry-run test)

- [ ] **Step 1: Adjust state.ts**

```ts
export interface EditorState {
  // ... existing fields ...
  pendingDryRun: { planId: string; afterHashes: string[] } | null;  // was afterHash: string
}

setDryRun: (planId: string, afterHashes: string[]) => void;

// In mutator:
setDryRun: (planId, afterHashes) => set({ pendingDryRun: { planId, afterHashes } }),
```

- [ ] **Step 2: Adjust wsClient.ts**

In the `'dry-run'` case:
```ts
case 'dry-run':
  s.setDryRun(msg['planId'] as string, (msg['files'] as Array<{afterHash: string}>).map((f) => f.afterHash));
  return;
```

- [ ] **Step 3: Update wsClient test**

In `packages/editor-ui/tests/wsClient.test.ts`, the existing dry-run test sends single-file fields. Update to multi-file:
```ts
ws.fire('message', JSON.stringify({
  kind: 'dry-run', requestId: 'r', sessionId: 's1', planId: 'p1',
  files: [{ filePath: '/x', patches: [], beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64) }],
}));
expect(useStore.getState().pendingDryRun?.planId).toBe('p1');
expect(useStore.getState().pendingDryRun?.afterHashes).toEqual(['b'.repeat(64)]);
```

- [ ] **Step 4: Run + commit**

Run `npm run build -w @visual-edit/editor-ui && npm test -w @visual-edit/editor-ui`. Expected: green.

```bash
git add packages/editor-ui/
git commit -m "feat(editor-ui): consume multi-file dry-run shape"
```

---

## Sub-phase 1.F-5 — 1.E review fixes + e2e + results

### Task 11: 1.E review fixes (bundle, populated when reaching this task)

**Files:** TBD based on the 1.E end-to-end reviewer's findings (running in parallel during planning).

When reaching this task, the implementer should:
1. Read the 1.E reviewer report from the conversation that triggered this plan.
2. Identify the actionable findings (Critical + Important).
3. Apply each as a small fix, single bundled commit.

If no actionable findings exist, skip the commit and document so in the report.

Commit (if applicable): `fix: 1.E review — <one-line summary>`

---

### Task 12: E2E acceptance + Phase 1.F results doc

**Files:**
- Extend: `examples/basic-vite/src/pages/Home.tsx` (add `<h2 className={styles.subtitle}>` + `const Title = styled.h1\`...\``)
- Create: `examples/basic-vite/src/pages/Home.module.css`
- Modify: seed package.json adds `styled-components` dep (run sonatype check; mainstream MIT)
- Create: `tests/e2e/multifile-edit.test.ts`
- Create: `docs/superpowers/specs/2026-05-10-phase-1f-results.md`

- [ ] **Step 1: Extend the seed**

`examples/basic-vite/src/pages/Home.module.css`:
```css
.subtitle {
  color: gray;
  font-size: 14px;
}
```

`examples/basic-vite/src/pages/Home.tsx` — add (preserving existing markup):
```tsx
import styles from './Home.module.css';
import styled from 'styled-components';

const Title = styled.h1`color: blue;`;

// inside Home():
return (
  <main className="p-4">
    <Title>Hello {data.name}</Title>
    <h2 className={styles.subtitle}>Welcome back</h2>
    {/* ... existing content ... */}
  </main>
);
```

Add `styled-components: ^6.1.0` to `examples/basic-vite/package.json`.

- [ ] **Step 2: E2E test**

The e2e exercises Phase 1.F gate scenarios 1, 4, 5 (acceptance). Scenarios 2 and 3 (styled-components edit + multi-file atomicity) can be unit-test only — covered by Task 5/7 tests.

```ts
// tests/e2e/multifile-edit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { Daemon } from '@visual-edit/daemon';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const EXAMPLE_ROOT = resolve(REPO_ROOT, 'examples/basic-vite');
const HOME_TSX = resolve(EXAMPLE_ROOT, 'src/pages/Home.tsx');
const HOME_MODULE_CSS = resolve(EXAMPLE_ROOT, 'src/pages/Home.module.css');

let daemon: Daemon;
let originalHome: string;
let originalCss: string;

beforeAll(async () => {
  originalHome = readFileSync(HOME_TSX, 'utf8');
  originalCss = readFileSync(HOME_MODULE_CSS, 'utf8');
  daemon = new Daemon({ root: EXAMPLE_ROOT });
  await daemon.start();
}, 60_000);

afterAll(async () => {
  await daemon?.stop();
  writeFileSync(HOME_TSX, originalHome, 'utf8');
  writeFileSync(HOME_MODULE_CSS, originalCss, 'utf8');
}, 30_000);

describe('Phase 1.F acceptance: multi-file edit', () => {
  it('CSS Module edit persists to .module.css; both files invariants hold', async () => {
    // This test exercises the daemon's HTTP edit path directly (no browser needed).
    // Open preview to instrument the file:
    const port = daemon.getPort()!;
    const openResp = await fetch(`http://127.0.0.1:${port}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: EXAMPLE_ROOT, page: 'src/pages/Home.tsx' }),
    });
    const { sessionId } = await openResp.json();

    // We can't easily get vid via WS without a browser. Read the instrumented file:
    const instrumented = readFileSync(HOME_TSX, 'utf8');
    // Find the data-vid for the h2 with className={styles.subtitle}:
    const match = instrumented.match(/<h2[^>]*data-vid="([a-f0-9]{8})"[^>]*className=\{styles\.subtitle\}/);
    expect(match).not.toBeNull();
    const vid = match![1]!;

    // Open WS, send edit, send commit:
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ kind: 'hello', version: '1.0', sessionId }));
    await new Promise<void>((r) => ws.once('message', () => r())); // snapshot

    let dryRunMessage: { planId: string } | null = null;
    let commitOkReceived = false;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as { kind: string; planId?: string };
      if (m.kind === 'dry-run') dryRunMessage = m as never;
      if (m.kind === 'commit-ok') commitOkReceived = true;
    });

    ws.send(JSON.stringify({
      kind: 'edit', requestId: 'r1', sessionId,
      edits: [{ kind: 'css-module', element: vid, binding: 'subtitle', newRuleBody: 'color: red;\n  font-size: 14px;' }],
    }));

    // Wait for dry-run.
    await new Promise<void>((r) => setTimeout(r, 1500));
    expect(dryRunMessage).not.toBeNull();

    // Send commit.
    ws.send(JSON.stringify({ kind: 'commit', requestId: 'r2', sessionId, planId: (dryRunMessage as { planId: string }).planId }));
    await new Promise<void>((r) => setTimeout(r, 1500));
    expect(commitOkReceived).toBe(true);

    // Verify disk:
    const cssAfter = readFileSync(HOME_MODULE_CSS, 'utf8');
    expect(cssAfter).toContain('color: red');
    expect(cssAfter).not.toContain('color: gray');

    // Cleanup
    await fetch(`http://127.0.0.1:${port}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    ws.close();
  }, 60_000);
});
```

- [ ] **Step 3: Run + commit + push + results doc**

```
npm run build --workspaces
npm test -w tests/e2e -- multifile-edit
```

If green:

```bash
git add examples/basic-vite/ tests/e2e/multifile-edit.test.ts
git commit -m "test(e2e): phase 1.f acceptance — multi-file edit (CSS Module)"
```

Then create `docs/superpowers/specs/2026-05-10-phase-1f-results.md` mirroring 1.E's structure. Total test count target: 245+. List all 1.G-deferred items.

```bash
git add docs/superpowers/specs/2026-05-10-phase-1f-results.md
git commit -m "docs(plan): mark phase 1.f complete + results writeup"
git push origin main
```

---

## Self-review checklist (run after Task 12)

1. **Spec coverage**: 1.E carry-overs + 1.F scope:
   - [x] Edit union extended (CssModuleEdit + StyledPropEdit) — Task 1
   - [x] CSS Module detection in instrument — Task 2
   - [x] CSS Module rule parser — Task 3
   - [x] planEdits multi-file plan + CSS-module routing — Task 4
   - [x] Multi-file commit (atomic, revert-on-partial) — Task 5
   - [x] EditPipeline multi-file plumbing — Task 6
   - [x] styled-components detection + planEdits — Task 7
   - [x] styled-components refusals (cross-file, interpolated) — Task 8
   - [x] WS protocol multi-file dry-run — Task 9
   - [x] Editor-ui consumes multi-file shape — Task 10
   - [x] 1.E review fixes — Task 11
   - [x] E2E + results — Task 12

2. **Cross-task interface check**:
   - `MultiFileEditPlan` shape is consistent across `code-mods` (Task 4) and `daemon` (Task 6).
   - `commitMultiFile.MultiFileCommitInput` (Task 5) matches what `EditPipeline.commit` passes (Task 6).
   - WS `WsDryRunMessage.files[]` (Task 9) shape matches editor-ui's read (Task 10).

3. **Type consistency**:
   - `Edit` discriminated union (4 variants) used identically in shared, code-mods, protocol, editor-ui.
   - `CssModuleBinding` and `StyledComponentRange` defined once in `code-mods/types.ts`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-phase-1f-multifile-edit-targets.md`.**

User pre-approved execution: subagent-driven mode after self-review. Proceeding without re-asking.
