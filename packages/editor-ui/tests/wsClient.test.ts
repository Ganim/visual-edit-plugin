// packages/editor-ui/tests/wsClient.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../src/state.js';
import { connect } from '../src/wsClient.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  sent: string[] = [];
  listeners = new Map<string, ((e: { data?: string }) => void)[]>();
  constructor(url: string) { this.url = url; MockWebSocket.instances.push(this); }
  addEventListener(name: string, fn: (e: { data?: string }) => void): void {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name)!.push(fn);
  }
  removeEventListener(): void { /* noop for tests */ }
  send(data: string): void { this.sent.push(data); }
  close(): void { for (const fn of this.listeners.get('close') ?? []) fn({}); }
  // Test helper: simulate inbound message.
  fire(name: string, data?: string): void {
    for (const fn of this.listeners.get(name) ?? []) fn({ data });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  useStore.setState(useStore.getInitialState());
  (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;
});

describe('wsClient', () => {
  it('on open sends a hello with version 1.0 + sessionId', () => {
    connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.fire('open');
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({ kind: 'hello', version: '1.0', sessionId: 's1' });
  });

  it('snapshot message updates the store', () => {
    connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.fire('open');
    ws.fire('message', JSON.stringify({
      kind: 'snapshot', sessionId: 's1', url: 'http://p', status: 'ready',
      filePath: '/p.tsx', sourceText: 'src',
      sourceMap: { abc12345: { vid: 'abc12345', tagName: 'div', nodeStart: 0, nodeEnd: 1, openingTagEnd: 1, classNameAttr: null, styleAttr: null, attrsInsertPos: 1 } },
      editorUrl: 'http://e/__editor/?session=s1',
    }));
    const s = useStore.getState();
    expect(s.filePath).toBe('/p.tsx');
    expect(s.url).toBe('http://p');
    expect(s.status).toBe('ready');
  });

  it('dry-run sets pendingDryRun', () => {
    const c = connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.fire('open');
    ws.fire('message', JSON.stringify({ kind: 'dry-run', requestId: 'r', sessionId: 's1', planId: 'p1', filePath: '/x', patches: [], beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64) }));
    expect(useStore.getState().pendingDryRun?.planId).toBe('p1');
    void c;
  });

  it('commit-ok clears pendingDryRun', () => {
    useStore.setState({ ...useStore.getInitialState(), pendingDryRun: { planId: 'p1', afterHash: 'a'.repeat(64) } });
    connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.fire('open');
    ws.fire('message', JSON.stringify({ kind: 'commit-ok', requestId: 'r', sessionId: 's1', commitId: 'c1' }));
    expect(useStore.getState().pendingDryRun).toBeNull();
  });

  it('file-changed marks snapshot stale', () => {
    connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.fire('open');
    ws.fire('message', JSON.stringify({ kind: 'file-changed', sessionId: 's1', filePath: '/x', sha256: 'a'.repeat(64), dirtySourceMap: true }));
    expect(useStore.getState().staleSnapshot).toBe(true);
  });

  it('error stores the error message', () => {
    connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.fire('open');
    ws.fire('message', JSON.stringify({ kind: 'error', sessionId: 's1', code: 'VE_FOO', message: 'oops' }));
    expect(useStore.getState().lastError).toContain('VE_FOO');
  });

  it('sendEdit emits an edit message', () => {
    const c = connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.fire('open');
    c.sendEdit([{ kind: 'className', element: 'abc12345', newValue: 'p' }]);
    const last = JSON.parse(ws.sent[ws.sent.length - 1]!);
    expect(last.kind).toBe('edit');
    expect(last.edits[0].newValue).toBe('p');
  });

  it('close listener flips status to disconnected', () => {
    connect('ws://x/ws', 's1');
    const ws = MockWebSocket.instances[0]!;
    ws.close();
    expect(useStore.getState().status).toBe('disconnected');
  });
});
