export type ElementId = string;

export interface AttrRange {
  attrStart: number;
  attrEnd: number;
  valueStart: number;
  valueEnd: number;
  valueKind: 'string-literal' | 'expression';
}

export interface CssModuleBinding {
  importedAs: string;         // e.g. 'styles'
  importPath: string;         // e.g. './Home.module.css'
  binding: string;            // e.g. 'title' (extracted from styles.title)
}

export interface StyledComponentRange {
  componentName: string;      // e.g. 'Title' for `const Title = styled.h1\`...\``
  // Position of the template literal content (between the backticks).
  templateStart: number;
  templateEnd: number;
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
  cssModule: CssModuleBinding | null;           // populated by instrument() pass 2
  styledComponent: StyledComponentRange | null; // populated by instrument() pass 2
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

// Multi-file edit plan: per-file patches + before/after hashes for atomic commit.
export interface MultiFileEditPlan {
  files: Array<{
    filePath: string;
    patches: TextPatch[];
    before: string;
    after: string;
    beforeHash: string;
    afterHash: string;
  }>;
}
