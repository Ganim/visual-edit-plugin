export type ElementId = string;

export interface ElementSourceMapEntry {
  vid: ElementId;
  tagName: string;
  nodeStart: number;       // start of opening tag (or self-closing)
  nodeEnd: number;         // end of element
  openingTagEnd: number;   // position right before > or /> of opening tag
  classNameAttr: AttrRange | null;
  styleAttr: AttrRange | null;
  attrsInsertPos: number;  // where to inject new attrs (== openingTagEnd, before > or />)
}

export interface AttrRange {
  attrStart: number;       // start of `className=...` token
  attrEnd: number;         // end of value (after closing quote or })
  valueStart: number;      // start of value content (inside quotes or after `={`)
  valueEnd: number;        // end of value content (before closing quote or `}`)
  valueKind: 'string-literal' | 'expression';
}

export type ElementSourceMap = Record<ElementId, ElementSourceMapEntry>;

export type SpikeEdit = ClassNameEdit | StyleEdit;

export interface ClassNameEdit {
  kind: 'className';
  element: ElementId;
  newValue: string;        // replaces className value (becomes "newValue")
}

export interface StyleEdit {
  kind: 'style';
  element: ElementId;
  newObjectText: string;   // e.g. "{ color: 'red', padding: 4 }" — replaces or inserts style={...}
}

export interface TextPatch {
  start: number;
  end: number;
  replacement: string;
  reason: string;
}

export interface InstrumentResult {
  instrumented: string;
  sourceMap: ElementSourceMap;
}

export interface ApplyResult {
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  patches: TextPatch[];
}
