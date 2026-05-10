import ts from 'typescript';
import { computeVid } from './vid.js';
import type {
  AttrRange,
  ElementSourceMap,
  ElementSourceMapEntry,
  InstrumentResult,
  TextPatch,
} from './types.js';

const VID_ATTR = 'data-vid';

export function instrument(source: string, filePath: string): InstrumentResult {
  const sf1 = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const patches: TextPatch[] = [];
  const visit1 = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const existingVid = readExistingVid(node, sf1);
      if (!existingVid) {
        const tagName = node.tagName.getText(sf1);
        const newVid = computeVid({
          filePath,
          start: node.getStart(sf1),
          end: node.getEnd(),
          tagName,
        });
        const insertPos = node.attributes.getEnd();
        const prevChar = source[insertPos - 1];
        const needsLeadingSpace = prevChar !== ' ' && prevChar !== '\n' && prevChar !== '\t';
        const insertion = `${needsLeadingSpace ? ' ' : ''}${VID_ATTR}="${newVid}"`;
        patches.push({
          start: insertPos,
          end: insertPos,
          replacement: insertion,
          reason: `inject ${VID_ATTR} for ${tagName}`,
        });
      }
    }
    ts.forEachChild(node, visit1);
  };
  visit1(sf1);

  const instrumented = applyPatchesToString(source, patches);

  const sf2 = ts.createSourceFile(filePath, instrumented, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sourceMap: ElementSourceMap = {};
  const visit2 = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const vid = readExistingVid(node, sf2);
      if (vid) {
        const tagName = node.tagName.getText(sf2);
        const nodeStart = node.getStart(sf2);
        const nodeEnd = node.getEnd();
        const attrsInsertPos = node.attributes.getEnd();
        const entry: ElementSourceMapEntry = {
          vid,
          tagName,
          nodeStart,
          nodeEnd,
          openingTagEnd: attrsInsertPos,
          classNameAttr: findAttrRange(node, sf2, 'className'),
          styleAttr: findAttrRange(node, sf2, 'style'),
          attrsInsertPos,
        };
        sourceMap[vid] = entry;
      }
    }
    ts.forEachChild(node, visit2);
  };
  visit2(sf2);

  return { instrumented, sourceMap };
}

function readExistingVid(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sf: ts.SourceFile,
): string | null {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.getText(sf) !== VID_ATTR) continue;
    if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
      return attr.initializer.text;
    }
  }
  return null;
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
    if (!initializer) return null;
    if (ts.isStringLiteral(initializer)) {
      return {
        attrStart: attr.getStart(sf),
        attrEnd: initializer.getEnd(),
        valueStart: initializer.getStart(sf) + 1,
        valueEnd: initializer.getEnd() - 1,
        valueKind: 'string-literal',
      };
    }
    if (ts.isJsxExpression(initializer)) {
      return {
        attrStart: attr.getStart(sf),
        attrEnd: initializer.getEnd(),
        valueStart: initializer.getStart(sf) + 1,
        valueEnd: initializer.getEnd() - 1,
        valueKind: 'expression',
      };
    }
    return null;
  }
  return null;
}

function applyPatchesToString(source: string, patches: TextPatch[]): string {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let out = source;
  for (const p of sorted) {
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }
  return out;
}
