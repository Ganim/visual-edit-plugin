import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  OpenPreviewRequest,
  OpenPreviewResponse,
  WsHelloMessage,
  WsSnapshotMessage,
  IpcReadyMessage,
} from '../src/index.js';

describe('protocol', () => {
  it('exposes PROTOCOL_VERSION = "1.0"', () => {
    expect(PROTOCOL_VERSION).toBe('1.0');
  });

  it('OpenPreviewRequest accepts valid input', () => {
    const parsed = OpenPreviewRequest.parse({ root: '/p', page: 'src/App.tsx' });
    expect(parsed.root).toBe('/p');
    expect(parsed.page).toBe('src/App.tsx');
  });

  it('OpenPreviewResponse requires url + sessionId', () => {
    const ok = OpenPreviewResponse.parse({ url: 'http://localhost:5180/?s=a', sessionId: 'a' });
    expect(ok.url).toMatch(/^http/);
    expect(() => OpenPreviewResponse.parse({ url: 'x' })).toThrow();
  });

  it('WsHelloMessage carries protocol version', () => {
    const m = WsHelloMessage.parse({
      kind: 'hello',
      version: '1.0',
      sessionId: 's',
    });
    expect(m.kind).toBe('hello');
    expect(m.version).toBe('1.0');
  });

  it('WsSnapshotMessage carries url + status', () => {
    const m = WsSnapshotMessage.parse({
      kind: 'snapshot',
      sessionId: 's',
      url: 'http://localhost:5180/?s=s',
      status: 'ready',
    });
    expect(m.status).toBe('ready');
  });

  it('IpcReadyMessage requires url', () => {
    const ok = IpcReadyMessage.parse({ kind: 'ready', url: 'http://localhost:5180' });
    expect(ok.url).toMatch(/^http/);
  });
});
