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
    } else if (edit.kind === 'css-module' || edit.kind === 'styled-prop') {
      // CSS Module and styled-prop edits are handled by the multi-file pipeline (Task 4+).
      // planEdits only handles single-file edits; throw a clear error for now.
      throw new Error(`planEdits: edit kind '${edit.kind}' requires multi-file pipeline — use planMultiFileEdits`);
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
