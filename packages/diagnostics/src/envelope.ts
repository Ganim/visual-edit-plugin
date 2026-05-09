import { randomBytes } from 'node:crypto';
import type { ErrorCode } from './codes.js';

export type Severity = 'info' | 'warn' | 'error' | 'fatal';
export type Recovery = 'none' | 'automatic-retry' | 'user-action' | 'unrecoverable';
export type Blame = 'user-config' | 'user-code' | 'tool' | 'environment' | 'unknown';

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  severity: Severity;
  recovery: Recovery;
  blame: Blame;
  hint?: string;
  context?: Record<string, unknown>;
  cause?: ErrorEnvelope;
  traceId: string;
}

export interface MakeEnvelopeInput {
  code: ErrorCode;
  message: string;
  severity: Severity;
  recovery: Recovery;
  blame: Blame;
  hint?: string;
  context?: Record<string, unknown>;
  cause?: ErrorEnvelope;
}

export function makeEnvelope(input: MakeEnvelopeInput): ErrorEnvelope {
  return {
    ...input,
    traceId: randomBytes(8).toString('hex'),
  };
}

export class VisualEditError extends Error {
  readonly envelope: ErrorEnvelope;
  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'VisualEditError';
    this.envelope = envelope;
  }
}
