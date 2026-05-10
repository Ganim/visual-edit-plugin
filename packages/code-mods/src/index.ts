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
