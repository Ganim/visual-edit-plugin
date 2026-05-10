// Public surface — populated by Tasks 2+. Re-exports kept here so consumers always import from
// '@visual-edit/code-mods' and never reach into subpaths.
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
export { planEdits } from './planEdits.js';
export { apply, type ApplyResult } from './apply.js';
export { assertEditEquivalence } from './invariants/astEquivalence.js';
export { assertCommentsPreserved } from './invariants/commentPreservation.js';
export { assertWhitespacePreservedOutsidePatches } from './invariants/whitespacePreservation.js';
export { runEditPipeline, type PipelineInput, type PipelineResult } from './pipeline.js';
export { writeBackup, readBackup, listBackups, type BackupOps } from './backups.js';
export { appendCommit, readCommitLog, findCommit, type CommitLogEntry } from './commitLog.js';
export { commit, type CommitInput, type CommitResult } from './commit.js';
