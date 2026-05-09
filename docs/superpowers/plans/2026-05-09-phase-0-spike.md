# Visual Edit — Phase 0 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that text-patch via TypeScript Compiler API positions can durably edit real-world TSX files without losing comments, whitespace, or formatting outside the targeted attribute. The output is a go/no-go decision for Phase 1.

**Architecture:** Single standalone package at the repo root (`spike/`). Pure functions: `instrument(source) → { instrumented, sourceMap }`, `planEdits(source, edits) → patches`, `apply(source, patches) → { after, beforeHash, afterHash }`. No file I/O in core, no daemon, no UI. Tests live alongside; OSS projects cloned into `spike/oss/` (gitignored).

**Tech Stack:** Node 22+, ESM-only, TypeScript 5.6+ as a library (`typescript` package, Compiler API directly — no `ts-morph`), vitest, fast-check, glob.

**Edit shape (spike-only, simplified from spec):** The full `StyleProps` → Tailwind class mapping is Phase 1. The spike validates positional precision only, so edits target attribute text directly:
- `{ kind: 'className', element, newValue: string }` — replaces the className value
- `{ kind: 'style', element, newObjectText: string }` — replaces the entire `style={{...}}` expression (or inserts one if absent)

**Go/No-Go Gate for Phase 1:** ALL of the following must hold:
1. All 10 fixture pipeline tests pass
2. Property-based test runs 1000 iterations clean
3. All 3 OSS projects: 30 random edits each pass invariants (90 edits total, zero failures)
4. Per edit: AST equivalence (only target nodes' className/style attribute differs), zero comment loss, byte-identical whitespace outside patched ranges, TS still parses

If any criterion fails, Phase 1 plan must be reworked (likely abandoning text-patch in favor of an AST-print approach).

**Scope explicitly OUT:** CSS Modules target, styled-components target, daemon, preview-worker, editor-ui, mcp-server, monorepo layout, anything that touches the user's filesystem (the spike reads OSS into a local clone and never writes back).

---

## File Structure

```
visual-edit-plugin/
├── spike/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── .gitignore
│   ├── .gitattributes
│   ├── src/
│   │   ├── types.ts            — SpikeEdit, TextPatch, ElementSourceMap
│   │   ├── vid.ts              — deterministic ID per (file, position, tag)
│   │   ├── instrument.ts       — adds data-vid attrs, builds sourceMap
│   │   ├── planEdits.ts        — Edit[] → TextPatch[]
│   │   ├── apply.ts            — splice patches into buffer + hash
│   │   ├── pipeline.ts         — instrument + plan + apply + invariants
│   │   ├── invariants/         — real code: invariants pipeline asserts
│   │   │   ├── astEquivalence.ts
│   │   │   ├── commentPreservation.ts
│   │   │   └── whitespacePreservation.ts
│   │   └── index.ts
│   ├── tests/
│   │   ├── __fixtures__/tsx/   — 10 hand-crafted .tsx files
│   │   ├── helpers/
│   │   │   ├── tsxGenerator.ts
│   │   │   └── randomEdit.ts
│   │   ├── vid.test.ts
│   │   ├── instrument.test.ts
│   │   ├── planEdits.test.ts
│   │   ├── apply.test.ts
│   │   ├── pipeline.test.ts
│   │   ├── fixtures.test.ts
│   │   ├── property.test.ts
│   │   ├── oss.test.ts
│   │   └── invariants/
│   │       ├── astEquivalence.test.ts
│   │       └── preservation.test.ts
│   └── scripts/
│       ├── clone-oss.ts        — pins SHAs, clones into spike/oss/
│       └── report.ts           — produces SPIKE_RESULTS.md
├── docs/superpowers/
│   ├── specs/2026-05-09-visual-edit-plugin-design.md   (existing)
│   ├── plans/2026-05-09-phase-0-spike.md               (this file)
│   └── specs/2026-05-09-spike-results.md               (output of Task 17)
└── .gitignore
```

---

### Task 1: Project bootstrap + git init

**Files:**
- Create: `.gitignore` (repo root)
- Create: `spike/package.json`
- Create: `spike/tsconfig.json`
- Create: `spike/vitest.config.ts`
- Create: `spike/.gitignore`
- Create: `spike/.gitattributes`
- Create: `spike/src/index.ts` (placeholder)
- Create: `spike/tests/smoke.test.ts`

- [ ] **Step 1: Init repo + root .gitignore**

Run from repo root:
```bash
git init
```

Create `.gitignore`:
```
node_modules/
spike/oss/
spike/coverage/
**/*.log
.DS_Store
```

- [ ] **Step 2: Create spike/package.json**

```json
{
  "name": "visual-edit-spike",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:fixtures": "vitest run tests/fixtures.test.ts",
    "test:property": "vitest run tests/property.test.ts",
    "test:oss": "vitest run tests/oss.test.ts",
    "clone-oss": "tsx scripts/clone-oss.ts",
    "report": "tsx scripts/report.ts",
    "spike:full": "npm run clone-oss && npm test && npm run report"
  },
  "dependencies": {
    "typescript": "5.6.3",
    "fast-glob": "3.3.2"
  },
  "devDependencies": {
    "vitest": "2.1.4",
    "fast-check": "3.23.1",
    "tsx": "4.19.2",
    "@types/node": "22.9.0"
  }
}
```

- [ ] **Step 3: Create spike/tsconfig.json**

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
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "lib": ["ES2022"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*", "scripts/**/*"]
}
```

- [ ] **Step 4: Create spike/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
});
```

- [ ] **Step 5: Create spike/.gitignore + spike/.gitattributes**

`spike/.gitignore`:
```
node_modules/
oss/
coverage/
*.log
SPIKE_RESULTS.json
```

`spike/.gitattributes` (force LF for fixture stability):
```
*.tsx text eol=lf
*.ts text eol=lf
*.jsx text eol=lf
*.js text eol=lf
```

- [ ] **Step 6: Placeholder src/index.ts + smoke test**

`spike/src/index.ts`:
```ts
export const SPIKE_VERSION = '0.0.0';
```

`spike/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SPIKE_VERSION } from '../src/index.ts';

describe('smoke', () => {
  it('module loads', () => {
    expect(SPIKE_VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 7: Install + run smoke**

Run from `spike/`:
```bash
npm install
npm test
```

Expected: 1 test passes (`smoke > module loads`).

- [ ] **Step 8: Commit**

```bash
git add .gitignore spike/
git commit -m "chore: bootstrap phase 0 spike project"
```

---

### Task 2: vid generation (deterministic per position)

**Files:**
- Create: `spike/src/vid.ts`
- Create: `spike/tests/vid.test.ts`

**Why:** vids must be stable across re-instrumentations of the same file (so editor state survives reload). They're derived from `(filePath, start, end, tagName)` via sha256 truncated to 8 hex chars.

- [ ] **Step 1: Write the failing test**

`spike/tests/vid.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeVid } from '../src/vid.ts';

describe('computeVid', () => {
  it('produces 8-char hex string', () => {
    const vid = computeVid({ filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' });
    expect(vid).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = computeVid({ filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' });
    const b = computeVid({ filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' });
    expect(a).toBe(b);
  });

  it('differs when any input differs', () => {
    const base = { filePath: 'src/App.tsx', start: 10, end: 50, tagName: 'div' };
    expect(computeVid(base)).not.toBe(computeVid({ ...base, filePath: 'src/B.tsx' }));
    expect(computeVid(base)).not.toBe(computeVid({ ...base, start: 11 }));
    expect(computeVid(base)).not.toBe(computeVid({ ...base, end: 51 }));
    expect(computeVid(base)).not.toBe(computeVid({ ...base, tagName: 'span' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/vid.test.ts
```

Expected: FAIL with module-not-found for `../src/vid.ts`.

- [ ] **Step 3: Implement vid.ts**

`spike/src/vid.ts`:
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

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/vid.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add spike/src/vid.ts spike/tests/vid.test.ts
git commit -m "feat(spike): deterministic vid computation"
```

---

### Task 3: Core types

**Files:**
- Create: `spike/src/types.ts`

No tests — types only. Compile-time validation via tsc in subsequent tasks.

- [ ] **Step 1: Create types.ts**

`spike/src/types.ts`:
```ts
export type ElementId = string;

export interface ElementSourceMapEntry {
  vid: ElementId;
  tagName: string;
  nodeStart: number;       // start of opening tag (or self-closing)
  nodeEnd: number;         // end of element
  openingTagEnd: number;   // position right before > or /> of opening tag
  classNameAttr: AttrRange | null;
  styleAttr: AttrRange | null;
  attrsInsertPos: number;  // where to inject new attrs (== openingTagEnd, before > or />)
}

export interface AttrRange {
  attrStart: number;       // start of `className=...` token
  attrEnd: number;         // end of value (after closing quote or })
  valueStart: number;      // start of value content (inside quotes or after `={`)
  valueEnd: number;        // end of value content (before closing quote or `}`)
  valueKind: 'string-literal' | 'expression';
}

export type ElementSourceMap = Record<ElementId, ElementSourceMapEntry>;

export type SpikeEdit = ClassNameEdit | StyleEdit;

export interface ClassNameEdit {
  kind: 'className';
  element: ElementId;
  newValue: string;        // replaces className value (becomes "newValue")
}

export interface StyleEdit {
  kind: 'style';
  element: ElementId;
  newObjectText: string;   // e.g. "{ color: 'red', padding: 4 }" — replaces or inserts style={...}
}

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

export interface ApplyResult {
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  patches: TextPatch[];
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add spike/src/types.ts
git commit -m "feat(spike): core types for instrument/plan/apply"
```

---

### Task 4: instrument() — single JSX element baseline

**Files:**
- Create: `spike/src/instrument.ts`
- Create: `spike/tests/instrument.test.ts`

- [ ] **Step 1: Write the failing test**

`spike/tests/instrument.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.ts';

describe('instrument — baseline', () => {
  it('adds data-vid to single self-closing element', () => {
    const src = `const x = <img src="a.png" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vids = Object.keys(sourceMap);
    expect(vids).toHaveLength(1);
    expect(instrumented).toContain(`data-vid="${vids[0]}"`);
    expect(instrumented).toContain(`src="a.png"`);
    expect(instrumented).toMatch(/<img src="a\.png" data-vid="[0-9a-f]{8}" \/>/);
  });

  it('adds data-vid to single element with children', () => {
    const src = `const x = <div className="foo">hello</div>;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(1);
    expect(instrumented).toMatch(/<div className="foo" data-vid="[0-9a-f]{8}">hello<\/div>/);
  });

  it('records classNameAttr range when present', () => {
    const src = `const x = <div className="foo" />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    const entry = Object.values(sourceMap)[0]!;
    expect(entry.classNameAttr).not.toBeNull();
    expect(entry.classNameAttr!.valueKind).toBe('string-literal');
    const valueText = src.slice(entry.classNameAttr!.valueStart, entry.classNameAttr!.valueEnd);
    expect(valueText).toBe('foo');
  });

  it('records styleAttr range when present', () => {
    const src = `const x = <div style={{ color: 'red' }} />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    const entry = Object.values(sourceMap)[0]!;
    expect(entry.styleAttr).not.toBeNull();
    expect(entry.styleAttr!.valueKind).toBe('expression');
  });

  it('reports null classNameAttr and styleAttr when absent', () => {
    const src = `const x = <div id="a" />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    const entry = Object.values(sourceMap)[0]!;
    expect(entry.classNameAttr).toBeNull();
    expect(entry.styleAttr).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/instrument.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement instrument.ts**

`spike/src/instrument.ts`:
```ts
import ts from 'typescript';
import { computeVid } from './vid.ts';
import type {
  AttrRange,
  ElementSourceMap,
  ElementSourceMapEntry,
  InstrumentResult,
  TextPatch,
} from './types.ts';

const VID_ATTR = 'data-vid';

export function instrument(source: string, filePath: string): InstrumentResult {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sourceMap: ElementSourceMap = {};
  const patches: TextPatch[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      processOpeningElement(node, sf, source, filePath, sourceMap, patches);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const instrumented = applyPatchesToString(source, patches);
  return { instrumented, sourceMap };
}

function processOpeningElement(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
  source: string,
  filePath: string,
  sourceMap: ElementSourceMap,
  patches: TextPatch[],
): void {
  const tagName = node.tagName.getText(sf);
  const nodeStart = node.getStart(sf);
  const nodeEnd = node.getEnd();

  // Skip if already has data-vid (idempotency).
  for (const attr of node.attributes.properties) {
    if (ts.isJsxAttribute(attr) && attr.name.getText(sf) === VID_ATTR) {
      return;
    }
  }

  const vid = computeVid({ filePath, start: nodeStart, end: nodeEnd, tagName });

  const classNameAttr = findAttrRange(node, sf, 'className');
  const styleAttr = findAttrRange(node, sf, 'style');

  // Attrs are inserted right at the end of attributes (== openingTagEnd, before > or />).
  // ts.JsxAttributes.end gives us this position.
  const attrsInsertPos = node.attributes.getEnd();

  const entry: ElementSourceMapEntry = {
    vid,
    tagName,
    nodeStart,
    nodeEnd,
    openingTagEnd: attrsInsertPos,
    classNameAttr,
    styleAttr,
    attrsInsertPos,
  };
  sourceMap[vid] = entry;

  // Inject ` data-vid="<vid>"` at attrsInsertPos. Need a leading space if previous char isn't whitespace.
  const prevChar = source[attrsInsertPos - 1];
  const needsLeadingSpace = prevChar !== ' ' && prevChar !== '\n' && prevChar !== '\t';
  const insertion = `${needsLeadingSpace ? ' ' : ''}${VID_ATTR}="${vid}"`;
  patches.push({
    start: attrsInsertPos,
    end: attrsInsertPos,
    replacement: insertion,
    reason: `inject ${VID_ATTR} for ${tagName}`,
  });
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
    if (!initializer) return null; // shorthand attribute (e.g. `<input disabled />`)
    if (ts.isStringLiteral(initializer)) {
      // initializer.getStart() points at opening quote, getEnd() at after closing quote.
      const attrStart = attr.getStart(sf);
      const attrEnd = initializer.getEnd();
      const valueStart = initializer.getStart(sf) + 1;
      const valueEnd = initializer.getEnd() - 1;
      return { attrStart, attrEnd, valueStart, valueEnd, valueKind: 'string-literal' };
    }
    if (ts.isJsxExpression(initializer)) {
      const attrStart = attr.getStart(sf);
      const attrEnd = initializer.getEnd();
      // valueStart is right after the `{`, valueEnd is right before the `}`.
      const valueStart = initializer.getStart(sf) + 1;
      const valueEnd = initializer.getEnd() - 1;
      return { attrStart, attrEnd, valueStart, valueEnd, valueKind: 'expression' };
    }
    return null;
  }
  return null;
}

function applyPatchesToString(source: string, patches: TextPatch[]): string {
  // Apply in descending order of start to keep earlier offsets stable.
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let out = source;
  for (const p of sorted) {
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/instrument.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add spike/src/instrument.ts spike/tests/instrument.test.ts
git commit -m "feat(spike): instrument() injects data-vid + builds sourceMap"
```

---

### Task 5: instrument() — fragments, nested, conditional, idempotency

**Files:**
- Modify: `spike/tests/instrument.test.ts` (append cases)

The implementation from Task 4 should already cover these (it walks the whole tree). This task locks the behavior with tests.

- [ ] **Step 1: Append failing tests**

Append to `spike/tests/instrument.test.ts`:
```ts
describe('instrument — complex shapes', () => {
  it('handles nested elements with unique vids', () => {
    const src = `const x = <div><span>a</span><span>b</span></div>;`;
    const { sourceMap, instrumented } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(3); // div + 2 spans
    const vids = Object.keys(sourceMap);
    expect(new Set(vids).size).toBe(3); // all unique
    for (const v of vids) {
      expect(instrumented).toContain(`data-vid="${v}"`);
    }
  });

  it('skips fragments (<>...</>)', () => {
    const src = `const x = <><div /><span /></>;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    // Fragment itself has no opening tag we instrument; only div + span.
    expect(Object.keys(sourceMap)).toHaveLength(2);
  });

  it('handles conditional JSX', () => {
    const src = `const x = cond ? <div /> : <span />;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(2);
  });

  it('handles JSX inside expression children', () => {
    const src = `const x = <ul>{items.map(i => <li key={i}>{i}</li>)}</ul>;`;
    const { sourceMap } = instrument(src, 'a.tsx');
    expect(Object.keys(sourceMap)).toHaveLength(2); // ul + li
  });

  it('is idempotent (re-instrumentation is a no-op)', () => {
    const src = `const x = <div className="foo" />;`;
    const r1 = instrument(src, 'a.tsx');
    const r2 = instrument(r1.instrumented, 'a.tsx');
    expect(r2.instrumented).toBe(r1.instrumented);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/instrument.test.ts
```

Expected: 5 baseline + 5 complex = 10 tests pass.

If any fail, fix `instrument.ts` (likely candidates: visit ordering, idempotency check missing for self-closing, fragment detection).

- [ ] **Step 3: Commit**

```bash
git add spike/tests/instrument.test.ts
git commit -m "test(spike): instrument handles fragments, nesting, conditionals, idempotency"
```

---

### Task 6: planEdits() — className target

**Files:**
- Create: `spike/src/planEdits.ts`
- Create: `spike/tests/planEdits.test.ts`

- [ ] **Step 1: Write the failing test**

`spike/tests/planEdits.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { instrument } from '../src/instrument.ts';
import { planEdits } from '../src/planEdits.ts';

describe('planEdits — className', () => {
  it('replaces string-literal className value', () => {
    const src = `const x = <div className="foo" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: vid, newValue: 'bar baz' },
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(instrumented.slice(patch.start, patch.end)).toBe('foo');
    expect(patch.replacement).toBe('bar baz');
  });

  it('throws when element vid is unknown', () => {
    const src = `const x = <div className="foo" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    expect(() =>
      planEdits(instrumented, sourceMap, [
        { kind: 'className', element: 'deadbeef', newValue: 'x' },
      ]),
    ).toThrow(/unknown element/i);
  });

  it('adds className attr when absent', () => {
    const src = `const x = <div id="a" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: vid, newValue: 'newcls' },
    ]);
    expect(patches).toHaveLength(1);
    // Should insert ` className="newcls"` at attrsInsertPos.
    expect(patches[0]!.replacement).toBe(' className="newcls"');
    const entry = sourceMap[vid]!;
    expect(patches[0]!.start).toBe(entry.attrsInsertPos);
    expect(patches[0]!.end).toBe(entry.attrsInsertPos);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/planEdits.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement planEdits.ts (className only)**

`spike/src/planEdits.ts`:
```ts
import type { ElementSourceMap, SpikeEdit, TextPatch } from './types.ts';

export function planEdits(
  source: string,
  sourceMap: ElementSourceMap,
  edits: SpikeEdit[],
): TextPatch[] {
  const patches: TextPatch[] = [];
  for (const edit of edits) {
    const entry = sourceMap[edit.element];
    if (!entry) {
      throw new Error(`planEdits: unknown element vid '${edit.element}'`);
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

function planClassNameEdit(
  entry: import('./types.ts').ElementSourceMapEntry,
  newValue: string,
): TextPatch {
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

function planStyleEdit(
  entry: import('./types.ts').ElementSourceMapEntry,
  newObjectText: string,
): TextPatch {
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

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/planEdits.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add spike/src/planEdits.ts spike/tests/planEdits.test.ts
git commit -m "feat(spike): planEdits for className target"
```

---

### Task 7: planEdits() — style target

**Files:**
- Modify: `spike/tests/planEdits.test.ts` (append cases)

Implementation already exists from Task 6. This task locks the style behavior with tests.

- [ ] **Step 1: Append failing tests**

Append to `spike/tests/planEdits.test.ts`:
```ts
describe('planEdits — style', () => {
  it('replaces existing style={{...}} expression entirely', () => {
    const src = `const x = <div style={{ color: 'red' }} />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'style', element: vid, newObjectText: "{ color: 'blue', padding: 4 }" },
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(instrumented.slice(patch.start, patch.end)).toBe(`style={{ color: 'red' }}`);
    expect(patch.replacement).toBe(`style={{ color: 'blue', padding: 4 }}`);
  });

  it('adds style attr when absent', () => {
    const src = `const x = <div className="foo" />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'style', element: vid, newObjectText: "{ color: 'blue' }" },
    ]);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.replacement).toBe(` style={{ color: 'blue' }}`);
  });

  it('plans both className and style edits in one call', () => {
    const src = `const x = <div />;`;
    const { instrumented, sourceMap } = instrument(src, 'a.tsx');
    const vid = Object.keys(sourceMap)[0]!;
    const patches = planEdits(instrumented, sourceMap, [
      { kind: 'className', element: vid, newValue: 'cls' },
      { kind: 'style', element: vid, newObjectText: '{ color: "red" }' },
    ]);
    expect(patches).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/planEdits.test.ts
```

Expected: 3 className + 3 style = 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add spike/tests/planEdits.test.ts
git commit -m "test(spike): planEdits handles style target"
```

---

### Task 8: apply() — splice patches + hash

**Files:**
- Create: `spike/src/apply.ts`
- Create: `spike/tests/apply.test.ts`

- [ ] **Step 1: Write the failing test**

`spike/tests/apply.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { apply } from '../src/apply.ts';
import type { TextPatch } from '../src/types.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('apply', () => {
  it('returns identical content when no patches', () => {
    const src = 'hello world';
    const r = apply(src, []);
    expect(r.after).toBe(src);
    expect(r.beforeHash).toBe(sha(src));
    expect(r.afterHash).toBe(sha(src));
  });

  it('applies a single patch', () => {
    const src = 'hello world';
    const patches: TextPatch[] = [{ start: 6, end: 11, replacement: 'there', reason: 'test' }];
    const r = apply(src, patches);
    expect(r.after).toBe('hello there');
  });

  it('applies multiple non-overlapping patches in any input order', () => {
    const src = 'AAA BBB CCC';
    const patches: TextPatch[] = [
      { start: 8, end: 11, replacement: 'ccc', reason: 'c' },
      { start: 0, end: 3, replacement: 'aaa', reason: 'a' },
      { start: 4, end: 7, replacement: 'bbb', reason: 'b' },
    ];
    const r = apply(src, patches);
    expect(r.after).toBe('aaa bbb ccc');
  });

  it('throws on overlapping patches', () => {
    const src = 'hello world';
    const patches: TextPatch[] = [
      { start: 0, end: 5, replacement: 'X', reason: 'a' },
      { start: 3, end: 8, replacement: 'Y', reason: 'b' },
    ];
    expect(() => apply(src, patches)).toThrow(/overlap/i);
  });

  it('hashes before and after', () => {
    const src = 'abc';
    const patches: TextPatch[] = [{ start: 1, end: 2, replacement: 'X', reason: '' }];
    const r = apply(src, patches);
    expect(r.beforeHash).toBe(sha('abc'));
    expect(r.afterHash).toBe(sha('aXc'));
  });

  it('preserves before/after content in the result', () => {
    const src = 'hello';
    const r = apply(src, []);
    expect(r.before).toBe('hello');
    expect(r.after).toBe('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/apply.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement apply.ts**

`spike/src/apply.ts`:
```ts
import { createHash } from 'node:crypto';
import type { ApplyResult, TextPatch } from './types.ts';

export function apply(source: string, patches: TextPatch[]): ApplyResult {
  // Sort ascending by start. Insertions (start === end) at same position are kept in input order.
  const sorted = [...patches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return patches.indexOf(a) - patches.indexOf(b);
  });

  // Validate non-overlap. An insertion (start === end) at boundary between two ranges is OK.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start < prev.end) {
      throw new Error(
        `apply: overlapping patches detected: [${prev.start},${prev.end}) and [${cur.start},${cur.end})`,
      );
    }
  }

  // Apply right-to-left so earlier offsets stay valid.
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

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/apply.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add spike/src/apply.ts spike/tests/apply.test.ts
git commit -m "feat(spike): apply() splices patches and hashes"
```

---

### Task 9: AST equivalence invariant

**Files:**
- Create: `spike/src/invariants/astEquivalence.ts`
- Create: `spike/tests/invariants/astEquivalence.test.ts`

**Why:** This is the core invariant checker. Two TSX strings are "edit-equivalent" if their ASTs differ ONLY in the className/style attribute values of elements named in the edit set. Anything else differing means the patch corrupted the file. Lives in `src/` because `pipeline.ts` calls it as production code, not as a test helper.

- [ ] **Step 1: Write the failing test**

`spike/tests/invariants/astEquivalence.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assertEditEquivalence } from '../../src/invariants/astEquivalence.ts';

describe('assertEditEquivalence', () => {
  it('passes when only className changed on targeted vid', () => {
    const before = `const x = <div data-vid="abc12345" className="foo" />;`;
    const after = `const x = <div data-vid="abc12345" className="bar baz" />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).not.toThrow();
  });

  it('passes when only style changed on targeted vid', () => {
    const before = `const x = <div data-vid="abc12345" />;`;
    const after = `const x = <div data-vid="abc12345" style={{ color: 'red' }} />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).not.toThrow();
  });

  it('passes when className added on targeted vid', () => {
    const before = `const x = <div data-vid="abc12345" />;`;
    const after = `const x = <div data-vid="abc12345" className="x" />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).not.toThrow();
  });

  it('fails when an unrelated attribute changes', () => {
    const before = `const x = <div data-vid="abc12345" id="a" className="foo" />;`;
    const after = `const x = <div data-vid="abc12345" id="b" className="bar" />;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).toThrow(/unrelated/i);
  });

  it('fails when a non-targeted vid is modified', () => {
    const before = `<><div data-vid="aaaa1111" className="x" /><div data-vid="bbbb2222" className="y" /></>`;
    const after = `<><div data-vid="aaaa1111" className="X" /><div data-vid="bbbb2222" className="Y" /></>`;
    expect(() => assertEditEquivalence(before, after, ['aaaa1111'])).toThrow(/non-targeted/i);
  });

  it('fails when structure changes (element added)', () => {
    const before = `const x = <div data-vid="abc12345" />;`;
    const after = `const x = <div data-vid="abc12345"><span /></div>;`;
    expect(() => assertEditEquivalence(before, after, ['abc12345'])).toThrow(/structure/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/invariants/astEquivalence.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement astEquivalence.ts**

`spike/src/invariants/astEquivalence.ts`:
```ts
import ts from 'typescript';

interface JsxNodeSummary {
  vid: string | null;
  tagName: string;
  /** Map of attrName → serialized value (or null for shorthand). Excludes className, style, data-vid. */
  otherAttrs: Map<string, string | null>;
  className: string | null;
  style: string | null;
  children: JsxNodeSummary[];
}

const SKIPPED_ATTRS = new Set(['className', 'style', 'data-vid']);

export function assertEditEquivalence(
  before: string,
  after: string,
  targetedVids: string[],
): void {
  const beforeSf = ts.createSourceFile('before.tsx', before, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const afterSf = ts.createSourceFile('after.tsx', after, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const beforeJsx = collectJsxSummaries(beforeSf);
  const afterJsx = collectJsxSummaries(afterSf);

  if (beforeJsx.length !== afterJsx.length) {
    throw new Error(
      `structure mismatch: before has ${beforeJsx.length} top-level JSX nodes, after has ${afterJsx.length}`,
    );
  }

  const targets = new Set(targetedVids);
  for (let i = 0; i < beforeJsx.length; i++) {
    compareNode(beforeJsx[i]!, afterJsx[i]!, targets, `[${i}]`);
  }
}

function collectJsxSummaries(sf: ts.SourceFile): JsxNodeSummary[] {
  const out: JsxNodeSummary[] = [];
  const visit = (node: ts.Node, parentIsJsx: boolean): void => {
    if (!parentIsJsx && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))) {
      out.push(summarize(node, sf));
      return; // descendants captured inside summarize
    }
    ts.forEachChild(node, (c) => visit(c, false));
  };
  visit(sf, false);
  return out;
}

function summarize(
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  sf: ts.SourceFile,
): JsxNodeSummary {
  if (ts.isJsxFragment(node)) {
    return {
      vid: null,
      tagName: '<>',
      otherAttrs: new Map(),
      className: null,
      style: null,
      children: collectJsxChildren(node.children, sf),
    };
  }
  const opening = ts.isJsxSelfClosingElement(node) ? node : node.openingElement;
  const tagName = opening.tagName.getText(sf);
  let vid: string | null = null;
  let className: string | null = null;
  let style: string | null = null;
  const otherAttrs = new Map<string, string | null>();

  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) {
      // JsxSpreadAttribute: track its raw text under a special key.
      otherAttrs.set(`...spread@${otherAttrs.size}`, attr.getText(sf));
      continue;
    }
    const name = attr.name.getText(sf);
    const valueText = attr.initializer ? attr.initializer.getText(sf) : null;
    if (name === 'data-vid' && attr.initializer && ts.isStringLiteral(attr.initializer)) {
      vid = attr.initializer.text;
      continue;
    }
    if (name === 'className') {
      className = valueText;
      continue;
    }
    if (name === 'style') {
      style = valueText;
      continue;
    }
    if (SKIPPED_ATTRS.has(name)) continue;
    otherAttrs.set(name, valueText);
  }

  const children = ts.isJsxElement(node) ? collectJsxChildren(node.children, sf) : [];
  return { vid, tagName, otherAttrs, className, style, children };
}

function collectJsxChildren(children: ts.NodeArray<ts.JsxChild>, sf: ts.SourceFile): JsxNodeSummary[] {
  const out: JsxNodeSummary[] = [];
  for (const c of children) {
    if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || ts.isJsxFragment(c)) {
      out.push(summarize(c, sf));
    } else if (ts.isJsxExpression(c) && c.expression) {
      // Walk the expression for nested JSX (e.g. `items.map(i => <li />)`).
      const visit = (n: ts.Node): void => {
        if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
          out.push(summarize(n, sf));
          return;
        }
        ts.forEachChild(n, visit);
      };
      visit(c.expression);
    }
    // JsxText is whitespace/text — ignore for equivalence (spec: edits don't change text).
  }
  return out;
}

function compareNode(
  a: JsxNodeSummary,
  b: JsxNodeSummary,
  targets: Set<string>,
  path: string,
): void {
  if (a.tagName !== b.tagName) {
    throw new Error(`structure mismatch at ${path}: tag '${a.tagName}' → '${b.tagName}'`);
  }
  if (a.vid !== b.vid) {
    throw new Error(`vid mismatch at ${path}: '${a.vid}' → '${b.vid}'`);
  }
  if (a.children.length !== b.children.length) {
    throw new Error(
      `structure mismatch at ${path} (${a.tagName}): child count ${a.children.length} → ${b.children.length}`,
    );
  }
  // Compare other attrs (must be identical).
  if (a.otherAttrs.size !== b.otherAttrs.size) {
    throw new Error(`unrelated attribute set changed at ${path} (${a.tagName})`);
  }
  for (const [k, v] of a.otherAttrs) {
    if (b.otherAttrs.get(k) !== v) {
      throw new Error(
        `unrelated attribute '${k}' changed at ${path} (${a.tagName}): ${v} → ${b.otherAttrs.get(k)}`,
      );
    }
  }
  // className/style may only change for targeted vids.
  const isTarget = a.vid !== null && targets.has(a.vid);
  if (!isTarget) {
    if (a.className !== b.className) {
      throw new Error(`non-targeted className changed at ${path} (${a.tagName}#${a.vid})`);
    }
    if (a.style !== b.style) {
      throw new Error(`non-targeted style changed at ${path} (${a.tagName}#${a.vid})`);
    }
  }
  // Recurse.
  for (let i = 0; i < a.children.length; i++) {
    compareNode(a.children[i]!, b.children[i]!, targets, `${path}.children[${i}]`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/invariants/astEquivalence.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add spike/src/invariants/astEquivalence.ts spike/tests/invariants/astEquivalence.test.ts
git commit -m "feat(spike): assertEditEquivalence invariant checker"
```

---

### Task 10: Comment + whitespace preservation invariants

**Files:**
- Create: `spike/src/invariants/commentPreservation.ts`
- Create: `spike/src/invariants/whitespacePreservation.ts`
- Create: `spike/tests/invariants/preservation.test.ts`

- [ ] **Step 1: Write the failing test**

`spike/tests/invariants/preservation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { assertCommentsPreserved } from '../../src/invariants/commentPreservation.ts';
import { assertWhitespacePreservedOutsidePatches } from '../../src/invariants/whitespacePreservation.ts';
import type { TextPatch } from '../../src/types.ts';

describe('assertCommentsPreserved', () => {
  it('passes when comment count and texts match', () => {
    const a = `// hello\nconst x = 1; /* yo */`;
    const b = `// hello\nconst x = 2; /* yo */`;
    expect(() => assertCommentsPreserved(a, b)).not.toThrow();
  });

  it('fails when a comment is removed', () => {
    const a = `// hello\nconst x = 1;`;
    const b = `const x = 1;`;
    expect(() => assertCommentsPreserved(a, b)).toThrow(/comment/i);
  });

  it('fails when comment text changed', () => {
    const a = `// hello\nconst x = 1;`;
    const b = `// world\nconst x = 1;`;
    expect(() => assertCommentsPreserved(a, b)).toThrow(/comment/i);
  });
});

describe('assertWhitespacePreservedOutsidePatches', () => {
  it('passes when only patched ranges differ', () => {
    const before = 'aaa BBB ccc';
    const after = 'aaa XXX ccc';
    const patches: TextPatch[] = [{ start: 4, end: 7, replacement: 'XXX', reason: '' }];
    expect(() => assertWhitespacePreservedOutsidePatches(before, after, patches)).not.toThrow();
  });

  it('fails when content outside patch ranges differs', () => {
    const before = 'aaa BBB ccc';
    const after = 'aXa XXX ccc';
    const patches: TextPatch[] = [{ start: 4, end: 7, replacement: 'XXX', reason: '' }];
    expect(() => assertWhitespacePreservedOutsidePatches(before, after, patches)).toThrow(/outside/i);
  });

  it('handles insertions (start === end)', () => {
    const before = 'abc';
    const after = 'aXbc';
    const patches: TextPatch[] = [{ start: 1, end: 1, replacement: 'X', reason: '' }];
    expect(() => assertWhitespacePreservedOutsidePatches(before, after, patches)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/invariants/preservation.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement commentPreservation.ts**

`spike/src/invariants/commentPreservation.ts`:
```ts
import ts from 'typescript';

interface CommentInfo {
  text: string;
  kind: 'single' | 'multi';
}

export function assertCommentsPreserved(before: string, after: string): void {
  const a = extractComments(before);
  const b = extractComments(after);
  if (a.length !== b.length) {
    throw new Error(`comment count mismatch: before ${a.length}, after ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.text !== b[i]!.text || a[i]!.kind !== b[i]!.kind) {
      throw new Error(
        `comment ${i} mismatch: '${a[i]!.text}' (${a[i]!.kind}) → '${b[i]!.text}' (${b[i]!.kind})`,
      );
    }
  }
}

function extractComments(source: string): CommentInfo[] {
  const sf = ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: CommentInfo[] = [];
  const seen = new Set<number>();

  const collectAt = (pos: number): void => {
    const ranges = ts.getLeadingCommentRanges(source, pos);
    if (!ranges) return;
    for (const r of ranges) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      out.push({
        text: source.slice(r.pos, r.end),
        kind: r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'single' : 'multi',
      });
    }
  };

  const visit = (node: ts.Node): void => {
    collectAt(node.pos);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // EOF trailing comments.
  collectAt(sf.end);
  return out.sort((a, b) => source.indexOf(a.text) - source.indexOf(b.text));
}
```

- [ ] **Step 4: Implement whitespacePreservation.ts**

`spike/src/invariants/whitespacePreservation.ts`:
```ts
import type { TextPatch } from '../types.ts';

/**
 * Assert that everything in `before` outside of patched ranges appears verbatim in `after`,
 * and that everything in `after` outside of (shifted) patched ranges matches `before`.
 */
export function assertWhitespacePreservedOutsidePatches(
  before: string,
  after: string,
  patches: TextPatch[],
): void {
  if (patches.length === 0) {
    if (before !== after) throw new Error('no patches but content differs');
    return;
  }

  const sorted = [...patches].sort((a, b) => a.start - b.start);

  // Build aligned segment list: alternating "context" (must match) and "patched" (replaced).
  let beforeCursor = 0;
  let afterCursor = 0;

  for (const p of sorted) {
    const contextLen = p.start - beforeCursor;
    const beforeContext = before.slice(beforeCursor, p.start);
    const afterContext = after.slice(afterCursor, afterCursor + contextLen);
    if (beforeContext !== afterContext) {
      throw new Error(
        `whitespace/content outside patch differs at before[${beforeCursor},${p.start}) vs after[${afterCursor},${afterCursor + contextLen})`,
      );
    }
    afterCursor += contextLen;
    // Skip the patch in `before`, advance `after` by replacement length.
    beforeCursor = p.end;
    afterCursor += p.replacement.length;
  }

  // Trailing context.
  const beforeTail = before.slice(beforeCursor);
  const afterTail = after.slice(afterCursor);
  if (beforeTail !== afterTail) {
    throw new Error(
      `trailing content differs: before[${beforeCursor}..]='${beforeTail.slice(0, 40)}...' vs after[${afterCursor}..]='${afterTail.slice(0, 40)}...'`,
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/invariants/preservation.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add spike/src/invariants/commentPreservation.ts spike/src/invariants/whitespacePreservation.ts spike/tests/invariants/preservation.test.ts
git commit -m "feat(spike): comment + whitespace preservation invariants"
```

---

### Task 11: Pipeline orchestrator + invariant runner

**Files:**
- Create: `spike/src/pipeline.ts`
- Create: `spike/tests/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

`spike/tests/pipeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runEditPipeline } from '../src/pipeline.ts';

describe('runEditPipeline', () => {
  it('end-to-end: instrument → plan → apply, all invariants hold', () => {
    const src = `// hello\nconst x = <div className="foo">hi</div>;`;
    const { sourceMap, after, patches } = runEditPipeline({
      filePath: 'a.tsx',
      source: src,
      pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'bar' }),
    });
    expect(Object.keys(sourceMap)).toHaveLength(1);
    expect(after).toContain('className="bar"');
    expect(after).toContain('// hello');
    expect(patches.length).toBeGreaterThan(0);
  });

  it('throws when invariants fail (synthetic corruption)', () => {
    expect(() => {
      const src = `<div className="x" />`;
      runEditPipeline({
        filePath: 'a.tsx',
        source: src,
        pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'y' }),
        // Corrupt: replace the entire result to force a mismatch.
        mutateAfter: () => `<span className="y" />`,
      });
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/pipeline.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement pipeline.ts**

`spike/src/pipeline.ts`:
```ts
import { instrument } from './instrument.ts';
import { planEdits } from './planEdits.ts';
import { apply } from './apply.ts';
import type { ElementId, ElementSourceMap, SpikeEdit, TextPatch } from './types.ts';
import ts from 'typescript';
import { assertEditEquivalence } from './invariants/astEquivalence.ts';
import { assertCommentsPreserved } from './invariants/commentPreservation.ts';
import { assertWhitespacePreservedOutsidePatches } from './invariants/whitespacePreservation.ts';

export interface PipelineInput {
  filePath: string;
  source: string;
  pickEdit: (vids: ElementId[], sourceMap: ElementSourceMap) => SpikeEdit | SpikeEdit[];
  /** Test hook: corrupt the `after` content to verify invariant assertions catch it. */
  mutateAfter?: (after: string) => string;
}

export interface PipelineResult {
  instrumented: string;
  sourceMap: ElementSourceMap;
  edits: SpikeEdit[];
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

  // Sanity: result must still parse as TSX.
  const sf = ts.createSourceFile(input.filePath, after, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diags.length > 0) {
    throw new Error(`pipeline: result fails to parse: ${diags.map((d) => d.messageText).join('; ')}`);
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

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/pipeline.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add spike/src/pipeline.ts spike/tests/pipeline.test.ts
git commit -m "feat(spike): pipeline orchestrator with invariant checks"
```

---

### Task 12: Author 10 TSX fixtures

**Files:**
- Create: `spike/tests/__fixtures__/tsx/01-decorators.tsx`
- Create: `spike/tests/__fixtures__/tsx/02-satisfies.tsx`
- Create: `spike/tests/__fixtures__/tsx/03-fragments.tsx`
- Create: `spike/tests/__fixtures__/tsx/04-conditional.tsx`
- Create: `spike/tests/__fixtures__/tsx/05-generics.tsx`
- Create: `spike/tests/__fixtures__/tsx/06-comments.tsx`
- Create: `spike/tests/__fixtures__/tsx/07-type-only-imports.tsx`
- Create: `spike/tests/__fixtures__/tsx/08-multiline-classname.tsx`
- Create: `spike/tests/__fixtures__/tsx/09-mixed-js-ts.tsx`
- Create: `spike/tests/__fixtures__/tsx/10-repeated-elements.tsx`
- Create: `spike/tests/fixtures.test.ts`

Each fixture is hand-crafted to exercise a specific TSX edge case. The test runs the pipeline against each fixture for both className and style edit kinds.

- [ ] **Step 1: Create all 10 fixtures**

`01-decorators.tsx`:
```tsx
function logged(target: unknown, _ctx: unknown) { return target; }

@logged
class Card {
  render() {
    return <div className="card">decorated</div>;
  }
}
```

`02-satisfies.tsx`:
```tsx
const props = { a: 1 } satisfies Record<string, number>;

export function Tag() {
  return <span className="tag" data-x={props.a}>tag</span>;
}
```

`03-fragments.tsx`:
```tsx
export function List() {
  return (
    <>
      <div className="row">a</div>
      <div className="row">b</div>
      <></>
    </>
  );
}
```

`04-conditional.tsx`:
```tsx
export function Toggle({ on }: { on: boolean }) {
  return on ? <button className="on">ON</button> : <button className="off">OFF</button>;
}
```

`05-generics.tsx`:
```tsx
function Box<T extends string>(props: { value: T }) {
  return <div className="box">{props.value}</div>;
}

export function App() {
  return <Box<'a'> value="a" />;
}
```

`06-comments.tsx`:
```tsx
// File-level comment.
/* Multi-line
   block comment. */
export function Header() {
  // Inside fn comment.
  return (
    <header className="header">
      {/* JSX comment */}
      <h1 className="title">Hello</h1>
    </header>
  );
}
```

`07-type-only-imports.tsx`:
```tsx
import type { ReactNode } from 'react';
import { type CSSProperties } from 'react';

export function Card({ children, sx }: { children: ReactNode; sx?: CSSProperties }) {
  return <article className="card" style={sx}>{children}</article>;
}
```

`08-multiline-classname.tsx`:
```tsx
export function Bigly() {
  return (
    <div
      className="
        flex flex-col
        items-center justify-between
        gap-4 p-6
      "
    >
      content
    </div>
  );
}
```

`09-mixed-js-ts.tsx`:
```tsx
// @ts-expect-error — intentional
const untyped: any = {};

export function Mixed() {
  // @ts-ignore
  const v: number = untyped.x;
  return <div className="mixed" data-v={v}>{v}</div>;
}
```

`10-repeated-elements.tsx`:
```tsx
export function Grid() {
  return (
    <ul className="grid">
      <li className="cell">1</li>
      <li className="cell">2</li>
      <li className="cell">3</li>
      <li className="cell">4</li>
    </ul>
  );
}
```

- [ ] **Step 2: Create the fixtures test runner**

`spike/tests/fixtures.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEditPipeline } from '../src/pipeline.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '__fixtures__/tsx');

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .sort();

describe('fixture pipeline', () => {
  for (const file of fixtures) {
    it(`${file} — className edit on first element`, () => {
      const source = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      const result = runEditPipeline({
        filePath: file,
        source,
        pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'spike-edited' }),
      });
      expect(result.after).toContain('className="spike-edited"');
    });

    it(`${file} — style edit on first element`, () => {
      const source = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      const result = runEditPipeline({
        filePath: file,
        source,
        pickEdit: (vids) => ({
          kind: 'style',
          element: vids[0]!,
          newObjectText: "{ color: 'red', padding: 4 }",
        }),
      });
      expect(result.after).toContain("color: 'red'");
    });

    it(`${file} — className edit on every element, sequentially`, () => {
      let source = readFileSync(join(FIXTURE_DIR, file), 'utf8');
      // Re-instrument each pass (vids stable per position so they regenerate).
      let pass = 0;
      while (true) {
        pass++;
        const result = runEditPipeline({
          filePath: file,
          source,
          pickEdit: (vids) => ({
            kind: 'className',
            element: vids[pass % vids.length]!,
            newValue: `pass-${pass}`,
          }),
        });
        source = result.after;
        if (pass > 5) break;
      }
      expect(source).toContain('pass-');
    });
  }
});
```

- [ ] **Step 3: Run all fixture tests**

```bash
npm run test:fixtures
```

Expected: 30 tests pass (10 fixtures × 3 tests each). If any fail, investigate the specific edge case — the failure pinpoints a bug in `instrument` or `planEdits`.

- [ ] **Step 4: Commit**

```bash
git add spike/tests/__fixtures__/ spike/tests/fixtures.test.ts
git commit -m "test(spike): 10 TSX edge-case fixtures + pipeline runner"
```

---

### Task 13: Property-based test (1000 iterations)

**Files:**
- Create: `spike/tests/helpers/tsxGenerator.ts`
- Create: `spike/tests/helpers/randomEdit.ts`
- Create: `spike/tests/property.test.ts`

- [ ] **Step 1: Implement tsxGenerator.ts**

`spike/tests/helpers/tsxGenerator.ts`:
```ts
import fc from 'fast-check';

const TAGS = ['div', 'span', 'section', 'article', 'header', 'main', 'p', 'button', 'a', 'img'];
const CLASS_TOKENS = ['flex', 'block', 'p-4', 'm-2', 'text-red-500', 'bg-white', 'rounded', 'shadow', 'gap-2'];

export interface JsxNodeSpec {
  tag: string;
  className: string | null;
  style: string | null;
  selfClosing: boolean;
  children: (JsxNodeSpec | string)[];
  comment: string | null; // optional leading JSX comment
}

export const jsxNodeArb: fc.Arbitrary<JsxNodeSpec> = fc.letrec((tie) => ({
  node: fc.record({
    tag: fc.constantFrom(...TAGS),
    className: fc.option(
      fc.array(fc.constantFrom(...CLASS_TOKENS), { minLength: 1, maxLength: 4 }).map((a) => a.join(' ')),
    ),
    style: fc.option(fc.constantFrom("{ color: 'red' }", "{ padding: 4 }", "{ margin: '8px' }")),
    selfClosing: fc.boolean(),
    children: fc.array(
      fc.oneof({ maxDepth: 2 }, fc.string({ minLength: 1, maxLength: 4 }).filter((s) => /^[a-z0-9]+$/i.test(s)), tie('node')),
      { minLength: 0, maxLength: 3 },
    ),
    comment: fc.option(fc.constantFrom('hello', 'note', null)),
  }),
})).node as fc.Arbitrary<JsxNodeSpec>;

export function renderJsx(node: JsxNodeSpec, indent = 0): string {
  const ind = '  '.repeat(indent);
  const attrs: string[] = [];
  if (node.className) attrs.push(`className="${node.className}"`);
  if (node.style) attrs.push(`style={${node.style}}`);
  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  const isSelfClosing = node.selfClosing || node.children.length === 0;
  if (isSelfClosing) {
    return `${ind}<${node.tag}${attrStr} />`;
  }
  const childrenStr = node.children
    .map((c) => (typeof c === 'string' ? `${ind}  ${c}` : renderJsx(c, indent + 1)))
    .join('\n');
  return `${ind}<${node.tag}${attrStr}>\n${childrenStr}\n${ind}</${node.tag}>`;
}

export function wrapInModule(jsx: string): string {
  return `// generated\nexport function App() {\n  return (\n${jsx}\n  );\n}\n`;
}
```

- [ ] **Step 2: Implement randomEdit.ts**

`spike/tests/helpers/randomEdit.ts`:
```ts
import fc from 'fast-check';
import type { ElementId, SpikeEdit } from '../../src/types.ts';

export const editArb = (vids: ElementId[]): fc.Arbitrary<SpikeEdit> =>
  fc.oneof(
    fc.record({
      kind: fc.constant('className' as const),
      element: fc.constantFrom(...vids),
      newValue: fc
        .array(fc.constantFrom('flex', 'p-4', 'text-blue-500', 'rounded', 'gap-2'), { minLength: 1, maxLength: 4 })
        .map((a) => a.join(' ')),
    }),
    fc.record({
      kind: fc.constant('style' as const),
      element: fc.constantFrom(...vids),
      newObjectText: fc.constantFrom(
        "{ color: 'blue' }",
        "{ padding: 8, margin: 4 }",
        "{ background: '#fff' }",
      ),
    }),
  );
```

- [ ] **Step 3: Write the failing test**

`spike/tests/property.test.ts`:
```ts
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { jsxNodeArb, renderJsx, wrapInModule } from './helpers/tsxGenerator.ts';
import { editArb } from './helpers/randomEdit.ts';
import { instrument } from '../src/instrument.ts';
import { runEditPipeline } from '../src/pipeline.ts';

describe('property: random TSX × random edits preserve invariants', () => {
  it('1000 iterations clean', () => {
    fc.assert(
      fc.property(jsxNodeArb, (node) => {
        const source = wrapInModule(renderJsx(node));
        const { sourceMap } = instrument(source, 'gen.tsx');
        const vids = Object.keys(sourceMap);
        if (vids.length === 0) return; // generator may produce empty trees occasionally; skip
        return fc.assert(
          fc.property(editArb(vids), (edit) => {
            runEditPipeline({
              filePath: 'gen.tsx',
              source,
              pickEdit: () => edit,
            });
            return true;
          }),
          { numRuns: 5 },
        );
      }),
      { numRuns: 200 }, // 200 outer × 5 inner = 1000 total
    );
  }, 120_000);
});
```

- [ ] **Step 4: Run the property test**

```bash
npm run test:property
```

Expected: pass within ~30-90s. If failures occur, fast-check reports the minimal counter-example. Investigate: usually generator emits something not covered by `instrument` (e.g. attribute ordering edge case) or `planEdits` mishandles a position.

- [ ] **Step 5: Commit**

```bash
git add spike/tests/helpers/tsxGenerator.ts spike/tests/helpers/randomEdit.ts spike/tests/property.test.ts
git commit -m "test(spike): property-based 1000 iterations"
```

---

### Task 14: OSS clone script

**Files:**
- Create: `spike/scripts/clone-oss.ts`

Pinned commits ensure reproducibility. Three projects representing different complexity tiers.

- [ ] **Step 1: Create clone-oss.ts**

`spike/scripts/clone-oss.ts`:
```ts
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OSS_DIR = join(__dirname, '..', 'oss');

interface OssTarget {
  name: string;
  repo: string;
  sha: string;
  /** Glob roots within the repo where TSX files we care about live. */
  tsxRoots: string[];
}

// Pinned to specific SHAs for reproducibility. Update only with explicit re-validation.
const TARGETS: OssTarget[] = [
  {
    name: 'vite-react-ts-template',
    repo: 'https://github.com/vitejs/vite.git',
    sha: '9f5c59f07aefb1756a37bd672c1bd60a4f243412',
    tsxRoots: ['packages/create-vite/template-react-ts/src'],
  },
  {
    name: 'cra-typescript-template',
    repo: 'https://github.com/facebook/create-react-app.git',
    sha: '67b48688081d8ee3562b8ac1bf6ae6d44112745a',
    tsxRoots: ['packages/cra-template-typescript/template/src'],
  },
  {
    name: 'shadcn-ui-components',
    repo: 'https://github.com/shadcn-ui/ui.git',
    sha: 'main', // Note: pin to a real SHA on first run; commit the pinned SHA.
    tsxRoots: ['apps/www/registry/default/ui'],
  },
];

function run(cmd: string, cwd: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function cloneTarget(t: OssTarget): void {
  const dest = join(OSS_DIR, t.name);
  if (existsSync(dest)) {
    console.log(`[skip] ${t.name} already cloned at ${dest}`);
    return;
  }
  mkdirSync(OSS_DIR, { recursive: true });
  run(`git clone --filter=blob:none --no-checkout ${t.repo} ${t.name}`, OSS_DIR);
  run(`git checkout ${t.sha}`, dest);
}

async function main(): Promise<void> {
  for (const t of TARGETS) {
    try {
      cloneTarget(t);
    } catch (err) {
      console.error(`[fail] clone ${t.name}:`, err);
      process.exit(1);
    }
  }
  console.log('\nAll OSS targets ready in', OSS_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { TARGETS };
export type { OssTarget };
```

- [ ] **Step 2: Run the clone**

```bash
npm run clone-oss
```

Expected: 3 directories under `spike/oss/`. If clone fails (network or repo gone), pick alternative pinned-SHA repos and update `TARGETS`.

- [ ] **Step 3: Pin shadcn-ui SHA**

The placeholder `'main'` for shadcn-ui must be replaced with an actual commit SHA for reproducibility. Run:

```bash
cd spike/oss/shadcn-ui-components
git rev-parse HEAD
```

Copy the SHA, then edit `clone-oss.ts` and replace `sha: 'main'` with the real SHA.

- [ ] **Step 4: Commit**

```bash
git add spike/scripts/clone-oss.ts
git commit -m "test(spike): pinned-SHA clone of 3 OSS projects"
```

---

### Task 15: OSS spike test runner

**Files:**
- Create: `spike/tests/oss.test.ts`

- [ ] **Step 1: Write the test**

`spike/tests/oss.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { runEditPipeline } from '../src/pipeline.ts';
import { TARGETS } from '../scripts/clone-oss.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OSS_DIR = join(__dirname, '..', 'oss');

const EDITS_PER_PROJECT = 30;
const SEED = 0xC0FFEE; // deterministic random for reproducibility

class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return x / 0xFFFFFFFF;
  }
  pick<T>(arr: T[]): T { return arr[Math.floor(this.next() * arr.length)]!; }
  pickInt(max: number): number { return Math.floor(this.next() * max); }
}

function listTsxFiles(target: typeof TARGETS[number]): string[] {
  const projectDir = join(OSS_DIR, target.name);
  const all: string[] = [];
  for (const root of target.tsxRoots) {
    const matches = fg.sync(['**/*.tsx'], { cwd: join(projectDir, root), absolute: true });
    all.push(...matches);
  }
  return all;
}

describe('OSS spike', () => {
  for (const target of TARGETS) {
    const projectDir = join(OSS_DIR, target.name);
    it(`${target.name}: ${EDITS_PER_PROJECT} random edits all pass invariants`, () => {
      if (!existsSync(projectDir)) {
        throw new Error(`OSS project not cloned: ${target.name}. Run \`npm run clone-oss\`.`);
      }
      const tsxFiles = listTsxFiles(target);
      expect(tsxFiles.length).toBeGreaterThan(0);

      const rng = new SeededRandom(SEED);
      const failures: { file: string; error: string }[] = [];

      for (let i = 0; i < EDITS_PER_PROJECT; i++) {
        const file = rng.pick(tsxFiles);
        const source = readFileSync(file, 'utf8');
        try {
          // Some files may have no JSX; pick another up to 3 times.
          let attempts = 0;
          while (attempts < 3) {
            try {
              runEditPipeline({
                filePath: file,
                source,
                pickEdit: (vids) => {
                  const vid = vids[rng.pickInt(vids.length)]!;
                  return rng.next() < 0.5
                    ? { kind: 'className', element: vid, newValue: `spike-${i}` }
                    : { kind: 'style', element: vid, newObjectText: "{ color: 'red' }" };
                },
              });
              break; // success
            } catch (e) {
              if ((e as Error).message.includes('no JSX elements found')) {
                attempts++;
                if (attempts < 3) {
                  // Try a different file.
                  const alt = rng.pick(tsxFiles);
                  if (alt !== file) {
                    runEditPipeline({
                      filePath: alt,
                      source: readFileSync(alt, 'utf8'),
                      pickEdit: (vids) => ({ kind: 'className', element: vids[0]!, newValue: 'x' }),
                    });
                    break;
                  }
                }
              } else {
                throw e;
              }
            }
          }
        } catch (e) {
          failures.push({ file, error: (e as Error).message });
        }
      }

      if (failures.length > 0) {
        const summary = failures
          .slice(0, 5)
          .map((f) => `  - ${f.file}: ${f.error.slice(0, 200)}`)
          .join('\n');
        throw new Error(
          `OSS spike FAILED for ${target.name}: ${failures.length}/${EDITS_PER_PROJECT} failures.\nFirst 5:\n${summary}`,
        );
      }
    }, 60_000);
  }
});
```

- [ ] **Step 2: Run the OSS test**

```bash
npm run test:oss
```

Expected: 3 tests pass (one per OSS project), 0 failures across 90 random edits. If failures occur, the error message identifies the file + reason. Fix the underlying bug in `instrument`/`planEdits` and rerun.

- [ ] **Step 3: Commit**

```bash
git add spike/tests/oss.test.ts
git commit -m "test(spike): OSS runner — 30 random edits per project, 3 projects"
```

---

### Task 16: Report generator + go/no-go writeup

**Files:**
- Create: `spike/scripts/report.ts`
- Create: `docs/superpowers/specs/2026-05-09-spike-results.md`

- [ ] **Step 1: Implement report.ts**

`spike/scripts/report.ts`:
```ts
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'SPIKE_RESULTS.json');

interface SuiteResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

const suites: { name: string; command: string }[] = [
  { name: 'unit (instrument/planEdits/apply/vid/pipeline/invariants)', command: 'npx vitest run tests/instrument.test.ts tests/planEdits.test.ts tests/apply.test.ts tests/vid.test.ts tests/pipeline.test.ts tests/invariants/' },
  { name: 'fixtures (10 TSX × 3 ops)', command: 'npx vitest run tests/fixtures.test.ts' },
  { name: 'property (1000 iterations)', command: 'npx vitest run tests/property.test.ts' },
  { name: 'oss (3 projects × 30 edits)', command: 'npx vitest run tests/oss.test.ts' },
];

function runSuite(s: { name: string; command: string }): SuiteResult {
  const start = Date.now();
  try {
    const output = execSync(s.command, { encoding: 'utf8', stdio: 'pipe' });
    return { name: s.name, command: s.command, passed: true, output: output.slice(-2000), durationMs: Date.now() - start };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return {
      name: s.name,
      command: s.command,
      passed: false,
      output: ((err.stdout ?? '') + '\n' + (err.stderr ?? '') + '\n' + err.message).slice(-2000),
      durationMs: Date.now() - start,
    };
  }
}

function main(): void {
  const results = suites.map(runSuite);
  const allPassed = results.every((r) => r.passed);
  const summary = { allPassed, runAt: new Date().toISOString(), results };
  writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`\n=== SPIKE REPORT ===`);
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name}  (${r.durationMs}ms)`);
  }
  console.log(`\nGo/No-Go: ${allPassed ? 'GO' : 'NO-GO'}`);
  if (!allPassed) process.exit(1);
}

main();
```

- [ ] **Step 2: Run the full spike**

```bash
npm run spike:full
```

Expected: ~5 minutes total. Final line prints `Go/No-Go: GO` if all suites pass.

If any suite fails: investigate, fix, re-run. Do not write the GO report until all suites pass.

- [ ] **Step 3: Write the spike results spec**

Create `docs/superpowers/specs/2026-05-09-spike-results.md` (template — fill in actual numbers from the SPIKE_RESULTS.json output):

```markdown
# Phase 0 Spike Results

**Date:** YYYY-MM-DD
**Outcome:** GO / NO-GO

## Summary

Validated text-patch via TS Compiler positions for `className` and `style` targets.

## Numbers

| Suite | Result | Duration |
|---|---|---|
| Unit (instrument/planEdits/apply) | PASS / FAIL | Xs |
| Fixtures (10 TSX × 3 ops = 30) | PASS / FAIL | Xs |
| Property-based (1000 iterations) | PASS / FAIL | Xs |
| OSS (3 projects × 30 edits = 90) | PASS / FAIL | Xs |

**Total:** 30 fixture pipelines + 1000 property pipelines + 90 OSS pipelines = 1120 pipelines exercised.

## Findings

(List edge cases discovered, bugs fixed during the spike, surprises.)

## Limitations

(Note things the spike did NOT cover that Phase 1 must address: CSS Modules, styled-components, ts-only attribute spreads, JSX namespaces, etc.)

## Decision

GO: text-patch approach proceeds to Phase 1 (`packages/code-mods` package).
NO-GO: switch to AST-print approach via ts-morph or similar; rewrite Phase 1 plan.
```

Fill in the template based on the actual run.

- [ ] **Step 4: Commit**

```bash
git add spike/scripts/report.ts docs/superpowers/specs/2026-05-09-spike-results.md
git commit -m "docs(spike): go/no-go report + writeup"
```

---

### Task 17: Mark spec as approved + plan complete

**Files:**
- Modify: `docs/superpowers/specs/2026-05-09-visual-edit-plugin-design.md` (last section)

- [ ] **Step 1: Update approval status in spec**

Change the bottom of the spec from:
```markdown
- [ ] User reviewed this spec
- [ ] User approved to proceed to implementation plan (writing-plans skill)
```

To:
```markdown
- [x] User reviewed this spec
- [x] User approved to proceed to implementation plan (writing-plans skill)
- [x] Phase 0 spike plan written: docs/superpowers/plans/2026-05-09-phase-0-spike.md
- [ ] Phase 0 spike executed (GO/NO-GO recorded in docs/superpowers/specs/2026-05-09-spike-results.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-09-visual-edit-plugin-design.md
git commit -m "docs: mark spec approved, link phase 0 spike plan"
```

---

## Self-Review Checklist (run before handing off to executor)

- [ ] Every step has a code block when code is involved (no "implement the X" without showing how).
- [ ] All file paths are exact (no `path/to/file`).
- [ ] All commands have expected output stated.
- [ ] Type names match across tasks (`SpikeEdit`, `TextPatch`, `ElementSourceMapEntry`, `ElementSourceMap`, `runEditPipeline`).
- [ ] Each task ends with a commit step.
- [ ] No "TBD", "TODO", "fill in", "similar to Task N" placeholders.
- [ ] Spec coverage:
  - Spec §6.1 deliverable "10 synthetic TSX fixtures" → Task 12.
  - Spec §6.1 deliverable "3 real OSS projects, 30 random Edits each" → Tasks 14 + 15.
  - Spec §6.1 deliverable "1000 iterations property-based" → Task 13.
  - Spec §6.1 gate "every fixture and OSS project edit succeeds" → Task 16 (report enforces).
  - Spec §2.6 `instrument`/`planEdits`/`apply`/`commit` → Tasks 4-8 + Task 11. (Spike skips `commit` — file I/O is Phase 1.)
  - Spec §2.6 strategy `tailwind-class` and `inline-style` → Tasks 6, 7. (CSS Modules + styled-components deferred per spec §6.2 scope.)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-phase-0-spike.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Best for the spike because each task is self-contained and the invariant tests catch regressions immediately.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
