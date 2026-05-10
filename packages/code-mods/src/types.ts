export type ElementId = string;

export interface AttrRange {
  attrStart: number;
  attrEnd: number;
  valueStart: number;
  valueEnd: number;
  valueKind: 'string-literal' | 'expression';
}

export interface ElementSourceMapEntry {
  vid: ElementId;
  tagName: string;
  nodeStart: number;
  nodeEnd: number;
  openingTagEnd: number;
  classNameAttr: AttrRange | null;
  styleAttr: AttrRange | null;
  attrsInsertPos: number;
}

export type ElementSourceMap = Record<ElementId, ElementSourceMapEntry>;

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
