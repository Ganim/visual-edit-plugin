import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';
import type { Edit } from '@visual-edit/shared';
import type { ElementSourceMap, ElementSourceMapEntry, TextPatch } from './types.js';
import { findCssRuleRange } from './cssModuleParser.js';

export interface PlannedFile {
  filePath: string;
  /** Current content of the file that patches were planned against. */
  source: string;
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
  // Track the source content for each file (page file from input.source; external files from readExternalFile).
  const byFileSource = new Map<string, string>();

  const ensureFile = (filePath: string, source?: string): TextPatch[] => {
    if (!byFile.has(filePath)) {
      byFile.set(filePath, []);
      byFileSource.set(filePath, source ?? '');
    }
    return byFile.get(filePath)!;
  };

  for (const edit of input.edits) {
    const entry = input.sourceMap[edit.element];
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
      ensureFile(input.filePath, input.source).push(planClassNameEdit(entry, edit.newValue));
    } else if (edit.kind === 'style') {
      ensureFile(input.filePath, input.source).push(planStyleEdit(entry, edit.newObjectText));
    } else if (edit.kind === 'css-module') {
      if (!entry.cssModule) {
        throw new VisualEditError(makeEnvelope({
          code: CODES.VE_CODEMOD_001_UNKNOWN_VID,
          message: `[VE_CODEMOD_001]: planEdits: element '${edit.element}' has no CSS Module binding`,
          severity: 'error',
          recovery: 'user-action',
          blame: 'tool',
          hint: 'The element must have a className={styles.X} expression bound to a .module.css import.',
        }));
      }
      const absPath = input.resolvePath(entry.cssModule.importPath);
      const cssSource = input.readExternalFile(absPath);
      const range = findCssRuleRange(cssSource, edit.binding);
      ensureFile(absPath, cssSource).push({
        start: range.bodyStart,
        end: range.bodyEnd,
        replacement: ` ${edit.newRuleBody} `,
        reason: `css-module rule update for .${edit.binding} in ${absPath}`,
      });
    } else if (edit.kind === 'styled-prop') {
      // Task 7-8 wires this. For now, refuse — styledComponent is always null after Task 1.
      if (!entry.styledComponent) {
        throw new VisualEditError(makeEnvelope({
          code: CODES.VE_CODEMOD_001_UNKNOWN_VID,
          message: `[VE_CODEMOD_001]: planEdits: element '${edit.element}' has no styled-component binding (styled-prop edit requires Task 7+)`,
          severity: 'error',
          recovery: 'user-action',
          blame: 'tool',
          hint: 'styled-prop edit target is not yet implemented for this element.',
        }));
      }
      // placeholder — Task 7 will implement full styled-prop patch
      throw new Error('planEdits: styled-prop edit not yet implemented');
    } else {
      const _exhaustive: never = edit;
      throw new Error(`planEdits: unsupported edit kind: ${JSON.stringify(_exhaustive)}`);
    }
  }

  return Array.from(byFile.entries()).map(([filePath, patches]) => ({
    filePath,
    source: byFileSource.get(filePath) ?? '',
    patches,
  }));
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
