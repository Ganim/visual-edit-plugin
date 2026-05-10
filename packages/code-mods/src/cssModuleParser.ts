import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

export interface CssRuleRange {
  /** Start of the rule body (immediately after the opening `{`). */
  bodyStart: number;
  /** End of the rule body (immediately before the closing `}`). */
  bodyEnd: number;
  /** Verbatim content currently inside the braces. */
  body: string;
}

const RULE_OPEN_RX = (binding: string) =>
  // Match `.<binding>` followed by optional whitespace and `{`. The negative lookahead
  // rejects nested selectors like `.title:hover` or `.title .child` or `.title,foo`.
  new RegExp(`\\.${escapeRegex(binding)}(?![A-Za-z0-9_-])\\s*\\{`, 'g');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a single flat CSS rule by class binding name. Returns the body range (between
 * the braces). Refuses if:
 * - rule not found (VE_CSSMOD_002)
 * - rule has nested selector / pseudo / media query before the `{` (VE_CSSMOD_001)
 * - rule body itself contains `{` (nested rule like @media or & nesting) (VE_CSSMOD_001)
 *
 * Multiple rules with the same binding: returns the FIRST. Documented as 1.F limitation.
 */
export function findCssRuleRange(source: string, binding: string): CssRuleRange {
  const rx = RULE_OPEN_RX(binding);
  let match: RegExpExecArray | null = null;
  while ((match = rx.exec(source)) !== null) {
    // Check for nested-selector pattern by looking at the snippet leading up to `.binding`.
    // Nested case: ".other .binding {" — we'd see whitespace + ".binding" with another selector before.
    // For 1.F simplicity: only accept the rule if the line is "just" `.binding {` (optional whitespace).
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const lineUpToBinding = source.slice(lineStart, match.index);
    if (lineUpToBinding.trim().length > 0) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CSSMOD_001_NESTED_RULE,
        message: `[VE_CSSMOD_001]: refusing to edit '.${binding}' — nested or compound selector detected on its line`,
        severity: 'error', recovery: 'user-action', blame: 'tool',
        hint: 'Move the rule to its own top-level selector, or use the className edit target.',
      }));
    }
    // Find the matching `}`. Brace-counting handles only flat rules.
    const bodyStart = match.index + match[0]!.length;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0) {
      const ch = source[i]!;
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CSSMOD_001_NESTED_RULE,
        message: `[VE_CSSMOD_001]: '.${binding}' has unbalanced braces`,
        severity: 'error', recovery: 'user-action', blame: 'user-config',
      }));
    }
    const bodyEnd = i - 1; // position OF the closing `}`
    const body = source.slice(bodyStart, bodyEnd);
    // Reject nested-rule body for 1.F.
    if (body.includes('{')) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CSSMOD_001_NESTED_RULE,
        message: `[VE_CSSMOD_001]: '.${binding}' contains nested rules`,
        severity: 'error', recovery: 'user-action', blame: 'tool',
        hint: 'Phase 1.F supports flat CSS Module rules only.',
      }));
    }
    return { bodyStart, bodyEnd, body };
  }
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_CSSMOD_002_RULE_NOT_FOUND,
    message: `[VE_CSSMOD_002]: '.${binding}' not found in CSS Module file`,
    severity: 'error', recovery: 'user-action', blame: 'user-config',
  }));
}
