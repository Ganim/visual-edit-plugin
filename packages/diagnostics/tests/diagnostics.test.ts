import { describe, it, expect } from 'vitest';
import {
  VisualEditError,
  makeEnvelope,
  CODES,
  Logger,
} from '../src/index.js';

describe('diagnostics', () => {
  it('makeEnvelope assigns a traceId and required fields', () => {
    const env = makeEnvelope({
      code: CODES.VE_PROJECT_001_MISSING_CONFIG,
      message: 'config missing',
      severity: 'fatal',
      recovery: 'user-action',
      blame: 'user-config',
    });
    expect(env.traceId).toMatch(/^[0-9a-f]{16}$/);
    expect(env.code).toBe('VE_PROJECT_001');
    expect(env.severity).toBe('fatal');
  });

  it('VisualEditError carries the envelope', () => {
    const err = new VisualEditError(
      makeEnvelope({
        code: CODES.VE_PREVIEW_001_WORKER_TIMEOUT,
        message: 'timeout',
        severity: 'error',
        recovery: 'automatic-retry',
        blame: 'tool',
      }),
    );
    expect(err.envelope.code).toBe('VE_PREVIEW_001');
    expect(err.message).toBe('timeout');
  });

  it('Logger writes NDJSON lines', async () => {
    const lines: string[] = [];
    const logger = new Logger({ write: (s) => lines.push(s) });
    logger.info('hello', { foo: 'bar' });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.foo).toBe('bar');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('Logger.error includes envelope when present', () => {
    const lines: string[] = [];
    const logger = new Logger({ write: (s) => lines.push(s) });
    const env = makeEnvelope({
      code: CODES.VE_INTERNAL_999_ASSERT,
      message: 'invariant violated',
      severity: 'fatal',
      recovery: 'unrecoverable',
      blame: 'tool',
    });
    logger.error('boom', { envelope: env });
    const parsed = JSON.parse(lines[0]!.trim());
    expect(parsed.envelope.code).toBe('VE_INTERNAL_999');
    expect(parsed.envelope.traceId).toBe(env.traceId);
  });
});
