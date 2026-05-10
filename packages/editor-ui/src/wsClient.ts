import { useStore } from './state.js';
import type { Edit } from '@visual-edit/shared';

export interface WsClient {
  sendEdit: (edits: Edit[]) => string;     // returns requestId
  sendCommit: (planId: string) => string;
  close: () => void;
}

export function connect(url: string, sessionId: string): WsClient {
  const ws = new WebSocket(url);
  let counter = 0;
  const nextId = () => `r${++counter}`;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ kind: 'hello', version: '1.0', sessionId }));
  });

  ws.addEventListener('message', (e) => {
    let msg: { kind: string; [k: string]: unknown };
    try { msg = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
    const s = useStore.getState();
    switch (msg.kind) {
      case 'snapshot':
        s.setSnapshot({
          url: msg['url'] as string,
          filePath: msg['filePath'] as string,
          sourceText: msg['sourceText'] as string,
          sourceMap: msg['sourceMap'] as never,
          sessionId,
        });
        return;
      case 'dry-run':
        s.setDryRun(msg['planId'] as string, msg['afterHash'] as string);
        return;
      case 'commit-ok':
        s.clearDryRun();
        return;
      case 'commit-uncertain':
        s.setError(`commit-uncertain: ${msg['lastError']}`);
        s.clearDryRun();
        return;
      case 'file-changed':
        s.markStale(msg['sha256'] as string);
        return;
      case 'error':
        s.setError(`[${msg['code']}] ${msg['message']}`);
        return;
    }
  });

  ws.addEventListener('close', () => useStore.getState().setStatus('disconnected'));

  return {
    sendEdit: (edits) => {
      const requestId = nextId();
      ws.send(JSON.stringify({ kind: 'edit', requestId, sessionId, edits }));
      return requestId;
    },
    sendCommit: (planId) => {
      const requestId = nextId();
      ws.send(JSON.stringify({ kind: 'commit', requestId, sessionId, planId }));
      return requestId;
    },
    close: () => ws.close(),
  };
}
