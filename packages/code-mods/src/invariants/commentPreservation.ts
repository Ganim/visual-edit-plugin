import ts from 'typescript';

interface CommentInfo {
  text: string;
  kind: 'single' | 'multi';
}

export function assertCommentsPreserved(before: string, after: string): void {
  const a = extractComments(before);
  const b = extractComments(after);
  if (a.length !== b.length) {
    throw new Error(`comment count mismatch: before ${a.length}, after ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.text !== b[i]!.text || a[i]!.kind !== b[i]!.kind) {
      throw new Error(
        `comment ${i} mismatch: '${a[i]!.text}' (${a[i]!.kind}) → '${b[i]!.text}' (${b[i]!.kind})`,
      );
    }
  }
}

function extractComments(source: string): CommentInfo[] {
  const sf = ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: CommentInfo[] = [];
  const seen = new Set<number>();

  const collectAt = (pos: number): void => {
    const ranges = ts.getLeadingCommentRanges(source, pos);
    if (!ranges) return;
    for (const r of ranges) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      out.push({
        text: source.slice(r.pos, r.end),
        kind: r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'single' : 'multi',
      });
    }
  };

  const visit = (node: ts.Node): void => {
    collectAt(node.pos);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // EOF trailing comments.
  collectAt(sf.end);
  return out.sort((a, b) => source.indexOf(a.text) - source.indexOf(b.text));
}
