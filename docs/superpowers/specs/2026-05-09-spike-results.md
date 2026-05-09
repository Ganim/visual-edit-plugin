# Phase 0 Spike Results

**Date:** 2026-05-09
**Outcome:** GO

## Summary

Validated the text-patch approach for `className` and `style` JSX attribute edits, using TypeScript Compiler API positions as the source of truth. The pipeline composes four stages:

1. **`instrument`** — parses TSX, injects deterministic `data-vid` attributes on every JSX element, and emits a `sourceMap` (`vid → { tagName, attrs[], openTagEnd, … }`) for downstream lookup.
2. **`planEdits`** — given an edit operation (`{ kind: 'className' | 'style', element: vid, newValue }`), walks the sourceMap to compute exact insertion / replacement spans against the *original* source.
3. **`apply`** — splices patches into the original source by descending offset, then computes a content hash for change tracking.
4. **invariants** — three orthogonal post-conditions enforced on every edited file:
   - **AST equivalence** — original AST minus the patched attribute equals patched AST minus the patched attribute (proves no collateral structural damage).
   - **Comment preservation** — every original comment text appears in the output.
   - **Whitespace preservation outside patches** — bytes outside the edited spans are byte-identical (no incidental reformatting).

The spike exercised this pipeline on hand-crafted fixtures, randomly generated inputs, and three real OSS codebases.

## Numbers

| Suite                                                            | Result | Duration |
| ---------------------------------------------------------------- | ------ | -------- |
| Unit (instrument / planEdits / apply / vid / pipeline / invariants) | PASS   | 2.4 s    |
| Fixtures (10 TSX × 3 ops = 30)                                   | PASS   | 2.4 s    |
| Property-based (1000 iterations)                                 | PASS   | 2.6 s    |
| OSS (3 projects × 30 edits = 90)                                 | PASS   | 2.6 s    |

`npm run spike:full` end-to-end (clone-oss + full vitest run + report runner): clones cached, vitest run 1.87 s, four scoped report sub-runs ≈10 s. Full report wall-clock from cold cache during development was ~5 min (dominated by OSS clones).

**Total pipelines exercised:** 30 fixture + 1000 property + 90 OSS = **1120**.

## Test counts

| File                                        | Tests |
| ------------------------------------------- | ----- |
| tests/smoke.test.ts                         | 1     |
| tests/vid.test.ts                           | 3     |
| tests/instrument.test.ts                    | 10    |
| tests/planEdits.test.ts                     | 6     |
| tests/apply.test.ts                         | 6     |
| tests/pipeline.test.ts                      | 2     |
| tests/invariants/astEquivalence.test.ts     | 8     |
| tests/invariants/preservation.test.ts       | 6     |
| tests/fixtures.test.ts                      | 30    |
| tests/property.test.ts                      | 1     |
| tests/oss.test.ts                           | 3     |

**Total: 76 tests across 11 files.**

## OSS targets

All targets cloned at pinned SHAs for reproducibility (see `spike/scripts/clone-oss.ts`). TSX file counts are scoped to the configured `tsxRoots`, not the whole repo.

- **vite-react-ts-template** @ `cf0ff4154b26cffbf18541ade1a50818842731d3` — 2 TSX files (`packages/create-vite/template-react-ts/src`)
- **cra-typescript-template** @ `67b48688081d8ee3562b8ac1bf6ae6d44112745a` — 3 TSX files (`packages/cra-template-typescript/template/src`)
- **shadcn-ui-components** @ `b8608d0976b32e26136e182445f69e6eb8e6cb74` — 56 TSX files (`apps/v4/registry/new-york-v4/ui`)

Each project receives 30 randomly generated edits from a seeded xorshift32 RNG (seed `0xC0FFEE`) so the run is bit-for-bit reproducible. Each edit randomly picks a TSX file, a JSX element vid in that file, and an op (`className` vs `style`). All 90 edits passed all three invariants.

Two of the three original plan SHAs were no longer reachable upstream (vite reorganized; shadcn-ui restructured `apps/www → apps/v4`). The clone script comments document the substitutions and the new tsxRoot paths.

## Findings

The spike's most valuable output is the bugs it forced us to find. Each was caught by a green-then-red sequence (a fixture or property iteration that the previous task's logic claimed to handle, but didn't).

### Bug 1: stale offsets after re-instrumentation

**Symptom:** Running the pipeline twice in a row on the same source produced incorrect patch positions on the second pass.

**Root cause:** `instrument()` was reusing the original source's positions for the sourceMap on a re-instrumented file, but the injected `data-vid` attributes had shifted every JSX position downstream. Subsequent `planEdits` computed splice offsets against the post-instrumentation text using pre-instrumentation positions.

**Fix (`e9b21b0`):** Rebuild the sourceMap from the *instrumented* source on every run; repopulate vids on re-instrumentation rather than short-circuiting. Idempotency tests in `instrument.test.ts` now lock this in.

### Bug 2: re-instrumentation emptied the sourceMap

**Symptom:** Same commit (`e9b21b0`). The "already instrumented, skip" fast-path was returning the original source unchanged but with an empty `sourceMap`, so downstream `planEdits` failed with "no element matching vid" on any second pass.

**Fix:** When the file is already instrumented, *still* re-walk the AST to populate the sourceMap; only skip the rewrite step.

### Bug 3: `astEquivalence` false-positive on JSX nested in attribute initializers

**Symptom:** A patch that mutated the `className` of an outer element would *also* incidentally mutate JSX inside an attribute expression like `icon={<svg className="..." />}` — and `astEquivalence` cleared it, because the comparator was only stripping the top-level patched attribute, not recursing into JSX children of attribute expressions.

**Root cause (`b430fd6`):** The "strip patched attr from both trees, then deep-equal" comparator did not descend into `JsxExpression` children when those children themselves contained `JsxElement` nodes. So divergence inside an attribute initializer was invisible to the invariant.

**Fix:** `assertEditEquivalence` now recurses into JSX expression containers when comparing structures. Regression test added in `tests/invariants/astEquivalence.test.ts` (commit `19e3541`).

### Bug 4 (build-side): tsc tried to compile fixture TSX as project sources

**Symptom (`fe7626a`):** `tsc --noEmit` failed on `tests/__fixtures__/*.tsx` because they intentionally contain malformed / edge-case JSX that's only used as raw input to the pipeline.

**Fix:** Exclude `tests/__fixtures__` from the project's `include`. The fixtures are read with `fs.readFileSync` and parsed by our instrumented TS compiler invocation, never by the project's tsc pass.

## Limitations

The spike intentionally constrained scope to validate the core hypothesis. Phase 1 (`packages/code-mods`) must address:

- **CSS Modules** — `className={styles.foo}` lookups: the spike treats `className` as a string-attribute target only.
- **`styled-components` / `emotion`** — tagged-template style values are out of scope; the `style` op only handles object literals (`{ color: 'red' }`-style).
- **Attribute spreads** — `<Foo {...rest} className="…" />` is handled (we patch the literal attribute), but `<Foo {...{ className: x }} />` is not.
- **JSX namespaces** (`<svg:circle />`-style) — the vid generator and sourceMap don't model namespace prefixes specifically; basic SVG works because TS treats it as a regular `JsxElement`, but `xmlns:foo` attribute manipulation wasn't exercised.
- **TS-only attribute syntax** — `as const`, `satisfies`, generic JSX (`<Foo<T> />`) on attribute values were not stress-tested.
- **Non-JSX `.tsx`** — files with no JSX elements throw "no JSX elements found" by design; the OSS runner re-rolls up to 3 times. Phase 1 should make this a typed result, not an exception.
- **Multi-file refactors** — every spike op is single-file. Imports / cross-module renames are out of scope.
- **Persistence of vids** — vids are recomputed from scratch on every `instrument` call. Phase 1 needs a stable, file-content-derived (not position-derived) vid scheme if vids will outlive a single edit session.
- **Source maps for compiled output** — only operates on raw `.tsx`. Bundler / transformer source maps are not consumed.

## Decision

**GO.** The text-patch + TS-positions + invariant-checked-pipeline approach is sound across 1120 randomized and curated edits with zero invariant violations. The four bugs uncovered during the spike were all specific-to-the-spike implementation issues (re-instrumentation idempotency, comparator recursion), not architectural blockers.

Proceed to Phase 1: extract `spike/src/*` into `packages/code-mods` with stable public APIs, add the limitations above as explicitly tracked work items, and design a vid scheme that survives across edit sessions.
