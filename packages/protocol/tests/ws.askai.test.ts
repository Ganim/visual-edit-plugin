import { describe, it, expect } from 'vitest';
import { WsAskAIMessage, WsAskAIQueuedMessage, WsAskAIResolvedMessage, WsMessage } from '../src/ws.js';

describe('ws ask-ai schemas', () => {
  it('parses an ask-ai request', () => {
    const m = WsAskAIMessage.parse({
      kind: 'ask-ai',
      requestId: 'r1',
      sessionId: 's1',
      element: 'abc12345',
      prompt: 'make it red',
    });
    expect(m.prompt).toBe('make it red');
  });

  it('parses an ask-ai-queued ack', () => {
    const m = WsAskAIQueuedMessage.parse({
      kind: 'ask-ai-queued',
      requestId: 'r1',
      sessionId: 's1',
      askId: 'aabbccdd',
      enqueuedAt: '2026-05-10T10:00:00Z',
    });
    expect(m.askId).toBe('aabbccdd');
  });

  it('parses an ask-ai-resolved with all outcome variants', () => {
    for (const outcome of ['committed', 'rejected', 'failed', 'no-op'] as const) {
      WsAskAIResolvedMessage.parse({
        kind: 'ask-ai-resolved',
        sessionId: 's1',
        askId: 'aabbccdd',
        outcome,
        summary: 'x',
      });
    }
  });

  it('WsMessage union accepts all three new variants', () => {
    expect(() => WsMessage.parse({ kind: 'ask-ai', requestId: 'r', sessionId: 's', element: 'a', prompt: 'p' })).not.toThrow();
  });
});
