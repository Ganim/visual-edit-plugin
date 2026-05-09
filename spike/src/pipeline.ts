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
