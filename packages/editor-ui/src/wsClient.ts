import { useStore } from './state.js';
import type { AskAiItemUI } from './state.js';
import type { Edit } from '@visual-edit/shared';

export interface WsClient {
  sendEdit: (edits: Edit[]) => string;     // returns requestId
  sendCommit: (planId: string) => string;
  sendAskAI: (element: string, prompt: string) => string;
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
        (window as unknown as { __VE_DEBUG_SOURCEMAP?: typeof msg.sourceMap }).__VE_DEBUG_SOURCEMAP = msg.sourceMap as never;
        s.setSnapshot({
          url: msg['url'] as string,
          filePath: msg['filePath'] as string,
          sourceText: msg['sourceText'] as string,
          sourceMap: msg['sourceMap'] as never,
          sessionId,
        });
        return;
      case 'dry-run':
        s.setDryRun(
          msg['planId'] as string,
          (msg['files'] as Array<{ afterHash: string }>).map((f) => f.afterHash),
        );
        return;
      case 'commit-ok':
        s.clearDryRun();
        return;
      case 'commit-uncertain':
        s.setError(`commit-uncertain: ${msg['lastError']}`);
        s.clearDryRun();
        return;
      case 'ask-ai-queued': {
        const oldKey = `pending:${msg['requestId'] as string}`;
        const cur = useStore.getState().askAiItems[oldKey];
        if (!cur) return; // unmatched ack — ignore
        s.replaceAskAiItem(oldKey, {
          askId: msg['askId'] as string,
          element: cur.element,
          prompt: cur.prompt,
          enqueuedAt: msg['enqueuedAt'] as string,
          state: 'pending',
        });
        return;
      }
      case 'ask-ai-resolved':
        s.updateAskAiResolved(msg['askId'] as string, {
          outcome: msg['outcome'] as AskAiItemUI['outcome'],
          summary: msg['summary'] as string,
          commitId: msg['commitId'] as string | undefined,
        });
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
    sendAskAI: (element, prompt) => {
      const requestId = nextId();
      ws.send(JSON.stringify({ kind: 'ask-ai', requestId, sessionId, element, prompt }));
      return requestId;
    },
    close: () => ws.close(),
  };
}
