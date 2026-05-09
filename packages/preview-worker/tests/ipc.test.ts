import { describe, it, expect } from 'vitest';
import { sendToParent } from '../src/ipc.js';
import { IpcReadyMessage, IpcErrorMessage } from '@visual-edit/protocol';

describe('preview-worker ipc', () => {
  it('sendToParent serializes IpcReadyMessage', () => {
    const captured: unknown[] = [];
    const fakeProcess = { send: (msg: unknown) => { captured.push(msg); return true; } };
    sendToParent(fakeProcess as unknown as NodeJS.Process, {
      kind: 'ready',
      url: 'http://localhost:5180',
    });
    expect(captured).toHaveLength(1);
    const parsed = IpcReadyMessage.parse(captured[0]);
    expect(parsed.url).toBe('http://localhost:5180');
  });

  it('sendToParent serializes IpcErrorMessage', () => {
    const captured: unknown[] = [];
    const fakeProcess = { send: (msg: unknown) => { captured.push(msg); return true; } };
    sendToParent(fakeProcess as unknown as NodeJS.Process, {
      kind: 'error',
      message: 'boom',
      stack: 'Error: boom\n  at ...',
    });
    const parsed = IpcErrorMessage.parse(captured[0]);
    expect(parsed.message).toBe('boom');
  });

  it('throws when process.send is unavailable', () => {
    const fakeProcess = {} as NodeJS.Process;
    expect(() => sendToParent(fakeProcess, { kind: 'ready', url: 'http://x' })).toThrow(/no IPC channel/i);
  });
});
