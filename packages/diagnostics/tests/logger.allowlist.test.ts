import { describe, it, expect } from 'vitest';
import { Logger } from '../src/logger.js';

describe('Logger allowlist', () => {
  it('redacts unknown context fields by default', () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: { write: (s) => lines.push(s) } });
    logger.info('hi', { prompt: 'leak this' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.prompt as string).toMatch(/^<HASH:/);
  });

  it('passes safe fields through', () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: { write: (s) => lines.push(s) } });
    logger.info('hi', { sessionId: 'abc12345', code: 'VE_FOO' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.sessionId).toBe('abc12345');
    expect(parsed.code).toBe('VE_FOO');
  });

  it('redact: false disables redaction (raw mode)', () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: { write: (s) => lines.push(s) }, redact: false });
    logger.info('hi', { prompt: 'leak this' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.prompt).toBe('leak this');
  });
});
