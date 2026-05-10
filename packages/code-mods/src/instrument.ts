import ts from 'typescript';
import { computeVid } from './vid.js';
import type {
  AttrRange,
  CssModuleBinding,
  ElementSourceMap,
  ElementSourceMapEntry,
  InstrumentResult,
  StyledComponentRange,
  TextPatch,
} from './types.js';

const VID_ATTR = 'data-vid';

export function instrument(source: string, filePath: string): InstrumentResult {
  // Pre-pass: collect CSS module imports before pass 1.
  const sf0 = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cssModuleImports = findCssModuleImports(sf0);

  // Pass 1: scan source, decide which elements need new vids, emit patches.
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

  // Pass 2: re-parse instrumented, build sourceMap with positions valid in instrumented.
  const sf2 = ts.createSourceFile(filePath, instrumented, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styledComponents = findStyledComponents(sf2);
  const sourceMap: ElementSourceMap = {};
  const visit2 = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const vid = readExistingVid(node, sf2);
      if (vid) {
        const tagName = node.tagName.getText(sf2);
        const nodeStart = node.getStart(sf2);
        const nodeEnd = node.getEnd();
        const attrsInsertPos = node.attributes.getEnd();
        const classNameAttr = findAttrRange(node, sf2, 'className');
        const cssModuleBinding = classNameAttr
          ? detectCssModuleBinding(node, cssModuleImports, sf2)
          : null;
        const entry: ElementSourceMapEntry = {
          vid,
          tagName,
          nodeStart,
          nodeEnd,
          openingTagEnd: attrsInsertPos,
          classNameAttr,
          styleAttr: findAttrRange(node, sf2, 'style'),
          attrsInsertPos,
          cssModule: cssModuleBinding,
          styledComponent: styledComponents.get(tagName) ?? null,
        };
        sourceMap[vid] = entry;
      }
    }
    ts.forEachChild(node, visit2);
  };
  visit2(sf2);

  return { instrumented, sourceMap };
}

/**
 * Walk top-level statements looking for:
 *   const X = styled.tag`...`   (PropertyAccessExpression tag)
 *   const X = styled(...)`...`  (CallExpression tag whose callee is `styled`)
 * Skip any tagged template that has interpolations (TemplateExpression);
 * only NoSubstitutionTemplateLiteral is supported.
 *
 * Returns a Map from component name → StyledComponentRange (positions of the
 * template literal content — between the backticks, exclusive).
 */
export function findStyledComponents(sf: ts.SourceFile): Map<string, StyledComponentRange> {
  const result = new Map<string, StyledComponentRange>();

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) continue;
    const decl = decls[0]!;
    if (!ts.isIdentifier(decl.name)) continue;
    const init = decl.initializer;
    if (!init || !ts.isTaggedTemplateExpression(init)) continue;

    // Accept tagged templates only if the template is a NoSubstitutionTemplateLiteral
    // (i.e., no interpolations).
    if (!ts.isNoSubstitutionTemplateLiteral(init.template)) continue;

    // Check that the tag is styled.X or styled(...)
    const tag = init.tag;
    const isStyledAccess =
      ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      tag.expression.text === 'styled';
    const isStyledCall =
      ts.isCallExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      tag.expression.text === 'styled';

    if (!isStyledAccess && !isStyledCall) continue;

    const componentName = decl.name.text;
    // The template literal spans from the opening backtick (+1) to the closing backtick (-1).
    const templateStart = init.template.getStart(sf) + 1;
    const templateEnd = init.template.getEnd() - 1;

    result.set(componentName, { componentName, templateStart, templateEnd });
  }

  return result;
}

function findCssModuleImports(sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const importPath = (stmt.moduleSpecifier as ts.StringLiteral).text;
    if (!importPath.endsWith('.module.css')) continue;
    const clause = stmt.importClause;
    if (clause?.name) {  // default import: import styles from '...'
      map.set(clause.name.text, importPath);
    }
  }
  return map;
}

function detectCssModuleBinding(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  cssModuleImports: Map<string, string>,
  sf: ts.SourceFile,
): CssModuleBinding | null {
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.getText(sf) !== 'className') continue;
    if (!attr.initializer || !ts.isJsxExpression(attr.initializer)) return null;
    const expr = attr.initializer.expression;
    if (!expr || !ts.isPropertyAccessExpression(expr)) return null;
    if (!ts.isIdentifier(expr.expression)) return null;
    const importedAs = expr.expression.text;
    const importPath = cssModuleImports.get(importedAs);
    if (!importPath) return null;
    return { importedAs, importPath, binding: expr.name.text };
  }
  return null;
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
    if (!initializer) return null; // shorthand attribute (e.g. `<input disabled />`)
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
  // Apply in descending order of start to keep earlier offsets stable.
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let out = source;
  for (const p of sorted) {
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }
  return out;
}
