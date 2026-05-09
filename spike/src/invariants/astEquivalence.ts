import ts from 'typescript';

interface JsxNodeSummary {
  vid: string | null;
  tagName: string;
  /** Map of attrName → serialized value (or null for shorthand). Excludes className, style, data-vid. */
  otherAttrs: Map<string, string | null>;
  className: string | null;
  style: string | null;
  children: JsxNodeSummary[];
}

const SKIPPED_ATTRS = new Set(['className', 'style', 'data-vid']);

export function assertEditEquivalence(
  before: string,
  after: string,
  targetedVids: string[],
): void {
  const beforeSf = ts.createSourceFile('before.tsx', before, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const afterSf = ts.createSourceFile('after.tsx', after, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const beforeJsx = collectJsxSummaries(beforeSf);
  const afterJsx = collectJsxSummaries(afterSf);

  if (beforeJsx.length !== afterJsx.length) {
    throw new Error(
      `structure mismatch: before has ${beforeJsx.length} top-level JSX nodes, after has ${afterJsx.length}`,
    );
  }

  const targets = new Set(targetedVids);
  for (let i = 0; i < beforeJsx.length; i++) {
    compareNode(beforeJsx[i]!, afterJsx[i]!, targets, `[${i}]`);
  }
}

function collectJsxSummaries(sf: ts.SourceFile): JsxNodeSummary[] {
  const out: JsxNodeSummary[] = [];
  const visit = (node: ts.Node, parentIsJsx: boolean): void => {
    if (!parentIsJsx && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))) {
      out.push(summarize(node, sf));
      return; // descendants captured inside summarize
    }
    ts.forEachChild(node, (c) => visit(c, false));
  };
  visit(sf, false);
  return out;
}

function summarize(
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  sf: ts.SourceFile,
): JsxNodeSummary {
  if (ts.isJsxFragment(node)) {
    return {
      vid: null,
      tagName: '<>',
      otherAttrs: new Map(),
      className: null,
      style: null,
      children: collectJsxChildren(node.children, sf),
    };
  }
  const opening = ts.isJsxSelfClosingElement(node) ? node : node.openingElement;
  const tagName = opening.tagName.getText(sf);
  let vid: string | null = null;
  let className: string | null = null;
  let style: string | null = null;
  const otherAttrs = new Map<string, string | null>();

  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) {
      // JsxSpreadAttribute: track its raw text under a special key.
      otherAttrs.set(`...spread@${otherAttrs.size}`, attr.getText(sf));
      continue;
    }
    const name = attr.name.getText(sf);
    const valueText = attr.initializer ? attr.initializer.getText(sf) : null;
    if (name === 'data-vid' && attr.initializer && ts.isStringLiteral(attr.initializer)) {
      vid = attr.initializer.text;
      continue;
    }
    if (name === 'className') {
      className = valueText;
      continue;
    }
    if (name === 'style') {
      style = valueText;
      continue;
    }
    if (SKIPPED_ATTRS.has(name)) continue;
    otherAttrs.set(name, valueText);
  }

  const children = ts.isJsxElement(node) ? collectJsxChildren(node.children, sf) : [];
  return { vid, tagName, otherAttrs, className, style, children };
}

function collectJsxChildren(children: ts.NodeArray<ts.JsxChild>, sf: ts.SourceFile): JsxNodeSummary[] {
  const out: JsxNodeSummary[] = [];
  for (const c of children) {
    if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || ts.isJsxFragment(c)) {
      out.push(summarize(c, sf));
    } else if (ts.isJsxExpression(c) && c.expression) {
      // Walk the expression for nested JSX (e.g. `items.map(i => <li />)`).
      const visit = (n: ts.Node): void => {
        if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
          out.push(summarize(n, sf));
          return;
        }
        ts.forEachChild(n, visit);
      };
      visit(c.expression);
    }
    // JsxText is whitespace/text — ignore for equivalence (spec: edits don't change text).
  }
  return out;
}

function compareNode(
  a: JsxNodeSummary,
  b: JsxNodeSummary,
  targets: Set<string>,
  path: string,
): void {
  if (a.tagName !== b.tagName) {
    throw new Error(`structure mismatch at ${path}: tag '${a.tagName}' → '${b.tagName}'`);
  }
  if (a.vid !== b.vid) {
    throw new Error(`vid mismatch at ${path}: '${a.vid}' → '${b.vid}'`);
  }
  if (a.children.length !== b.children.length) {
    throw new Error(
      `structure mismatch at ${path} (${a.tagName}): child count ${a.children.length} → ${b.children.length}`,
    );
  }
  // Compare other attrs (must be identical).
  if (a.otherAttrs.size !== b.otherAttrs.size) {
    throw new Error(`unrelated attribute set changed at ${path} (${a.tagName})`);
  }
  for (const [k, v] of a.otherAttrs) {
    if (b.otherAttrs.get(k) !== v) {
      throw new Error(
        `unrelated attribute '${k}' changed at ${path} (${a.tagName}): ${v} → ${b.otherAttrs.get(k)}`,
      );
    }
  }
  // className/style may only change for targeted vids.
  const isTarget = a.vid !== null && targets.has(a.vid);
  if (!isTarget) {
    if (a.className !== b.className) {
      throw new Error(`non-targeted className changed at ${path} (${a.tagName}#${a.vid})`);
    }
    if (a.style !== b.style) {
      throw new Error(`non-targeted style changed at ${path} (${a.tagName}#${a.vid})`);
    }
  }
  // Recurse.
  for (let i = 0; i < a.children.length; i++) {
    compareNode(a.children[i]!, b.children[i]!, targets, `${path}.children[${i}]`);
  }
}
