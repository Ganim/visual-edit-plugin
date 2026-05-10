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
