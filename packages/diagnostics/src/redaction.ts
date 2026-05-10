import { createHash } from 'node:crypto';

/**
 * Field names that are safe to log verbatim. All other context fields are replaced with
 * <HASH:abc12345:length:summary> placeholders. Add fields here only if they cannot
 * contain user secrets.
 */
export const SAFE_LOG_FIELDS = new Set<string>([
  'ts', 'level', 'msg',
  'code', 'severity', 'recovery', 'blame', 'traceId',  // ErrorEnvelope safe fields
  'hint',                                               // hints are author-written, not user data
  'pid', 'port', 'sessionId', 'commitId', 'planId', 'requestId',
  'filePath',                                           // path is structural, not contents
  'kind', 'state', 'outcome',
  'attempts', 'retries',
  'eventName',
]);

export function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') return value; // Keep numbers/booleans/objects as-is — caller responsibility for nested
  if (value.length === 0) return value;
  const sha = createHash('sha256').update(value).digest('hex').slice(0, 8);
  const summary = value.slice(0, 16).replace(/[^A-Za-z0-9-_]/g, '_');
  return `<HASH:${sha}:${value.length}:${summary}>`;
}

export function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (SAFE_LOG_FIELDS.has(key)) {
      out[key] = value;
    } else {
      out[key] = redactValue(value);
    }
  }
  return out;
}
