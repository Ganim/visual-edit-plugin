import type { ElementSourceMap, ElementSourceMapEntry, SpikeEdit, TextPatch } from './types.ts';

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
  entry: ElementSourceMapEntry,
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
  entry: ElementSourceMapEntry,
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
