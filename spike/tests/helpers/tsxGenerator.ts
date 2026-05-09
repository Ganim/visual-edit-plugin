import fc from 'fast-check';

const TAGS = ['div', 'span', 'section', 'article', 'header', 'main', 'p', 'button', 'a', 'img'];
const CLASS_TOKENS = ['flex', 'block', 'p-4', 'm-2', 'text-red-500', 'bg-white', 'rounded', 'shadow', 'gap-2'];

export interface JsxNodeSpec {
  tag: string;
  className: string | null;
  style: string | null;
  selfClosing: boolean;
  children: (JsxNodeSpec | string)[];
  comment: string | null; // optional leading JSX comment
}

export const jsxNodeArb: fc.Arbitrary<JsxNodeSpec> = fc.letrec((tie) => ({
  node: fc.record({
    tag: fc.constantFrom(...TAGS),
    className: fc.option(
      fc.array(fc.constantFrom(...CLASS_TOKENS), { minLength: 1, maxLength: 4 }).map((a) => a.join(' ')),
    ),
    style: fc.option(fc.constantFrom("{ color: 'red' }", "{ padding: 4 }", "{ margin: '8px' }")),
    selfClosing: fc.boolean(),
    children: fc.array(
      fc.oneof({ maxDepth: 2 }, fc.string({ minLength: 1, maxLength: 4 }).filter((s) => /^[a-z0-9]+$/i.test(s)), tie('node')),
      { minLength: 0, maxLength: 3 },
    ),
    comment: fc.option(fc.constantFrom('hello', 'note', null)),
  }),
})).node as fc.Arbitrary<JsxNodeSpec>;

export function renderJsx(node: JsxNodeSpec, indent = 0): string {
  const ind = '  '.repeat(indent);
  const attrs: string[] = [];
  if (node.className) attrs.push(`className="${node.className}"`);
  if (node.style) attrs.push(`style={${node.style}}`);
  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  const isSelfClosing = node.selfClosing || node.children.length === 0;
  if (isSelfClosing) {
    return `${ind}<${node.tag}${attrStr} />`;
  }
  const childrenStr = node.children
    .map((c) => (typeof c === 'string' ? `${ind}  ${c}` : renderJsx(c, indent + 1)))
    .join('\n');
  return `${ind}<${node.tag}${attrStr}>\n${childrenStr}\n${ind}</${node.tag}>`;
}

export function wrapInModule(jsx: string): string {
  return `// generated\nexport function App() {\n  return (\n${jsx}\n  );\n}\n`;
}
