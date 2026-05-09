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
