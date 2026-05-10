import { describe, it, expect } from 'vitest';
import { redactValue, redactContext, SAFE_LOG_FIELDS } from '../src/redaction.js';

describe('redaction', () => {
  it('hashes a string value', () => {
    const r = redactValue('this is some secret content');
    expect(typeof r).toBe('string');
    expect(r as string).toMatch(/^<HASH:[a-f0-9]{8}:\d+:.*>$/);
  });

  it('passes safe-listed fields through', () => {
    const out = redactContext({ pid: 1234, port: 5170, prompt: 'my secret' });
    expect(out.pid).toBe(1234);
    expect(out.port).toBe(5170);
    expect(out.prompt as string).toMatch(/^<HASH:/);
  });

  it('passes numbers and booleans through', () => {
    const out = redactContext({ count: 42, ok: true });
    expect(out.count).toBe(42);
    expect(out.ok).toBe(true);
  });

  it('SAFE_LOG_FIELDS includes the core envelope fields', () => {
    for (const f of ['code', 'severity', 'recovery', 'blame', 'traceId', 'sessionId']) {
      expect(SAFE_LOG_FIELDS.has(f)).toBe(true);
    }
  });
});
