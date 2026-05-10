import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  WsHelloMessage,
  WsEditMessage,
  WsCommitMessage,
  type WsSnapshotMessage,
  type WsDryRunMessage,
  type WsCommitOkMessage,
  type WsCommitUncertainMessage,
  type WsErrorMessage,
  type WsFileChangedMessage,
} from '@visual-edit/protocol';
import type { PreviewSession } from '@visual-edit/shared';
import type { EditPipeline } from './editPipeline.js';

export interface WsHandlers {
  getSession: (sessionId: string) => PreviewSession | null;
  getPipeline: (sessionId: string) => EditPipeline | null;
  daemonPort: () => number;
}

export function attachWebSocket(http: Server, handlers: WsHandlers): WebSocketServer {
  const wss = new WebSocketServer({ server: http, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    let sessionId: string | null = null;

    socket.on('message', async (raw) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString()); } catch { socket.close(1003, 'invalid json'); return; }

      const obj = parsed as { kind?: string };

      if (obj.kind === 'hello') {
        const hello = WsHelloMessage.safeParse(parsed);
        if (!hello.success) { socket.close(1003, 'expected hello'); return; }
        const session = handlers.getSession(hello.data.sessionId);
        const pipeline = handlers.getPipeline(hello.data.sessionId);
        if (!session || !pipeline) { socket.close(1008, 'unknown session'); return; }
        sessionId = session.id;
        const snap = await pipeline.getSnapshot();
        const editorUrl = `http://127.0.0.1:${handlers.daemonPort()}/__editor/?session=${session.id}`;
        const filePath = pipeline.getFilePath();
        const msg: WsSnapshotMessage = {
          kind: 'snapshot',
          sessionId: session.id,
          url: session.url,
          status: session.status,
          filePath,
          sourceText: snap.sourceText,
          sourceMap: snap.sourceMap,
          editorUrl,
        };
        socket.send(JSON.stringify(msg));
        return;
      }

      if (!sessionId) { socket.close(1008, 'no session'); return; }
      const pipeline = handlers.getPipeline(sessionId);
      if (!pipeline) { socket.close(1008, 'session gone'); return; }

      if (obj.kind === 'edit') {
        const edit = WsEditMessage.safeParse(parsed);
        if (!edit.success) return sendError(socket, sessionId, 'VE_PROTOCOL_002', 'invalid edit message', undefined);
        try {
          const dr = await pipeline.planAndApply(edit.data.edits);
          const reply: WsDryRunMessage = {
            kind: 'dry-run',
            requestId: edit.data.requestId,
            sessionId,
            planId: dr.planId,
            filePath: pipeline.getFilePath(),
            patches: dr.patches,
            beforeHash: dr.beforeHash,
            afterHash: dr.afterHash,
          };
          socket.send(JSON.stringify(reply));
        } catch (err) {
          sendError(socket, sessionId, codeOf(err), (err as Error).message, edit.data.requestId);
        }
        return;
      }

      if (obj.kind === 'commit') {
        const c = WsCommitMessage.safeParse(parsed);
        if (!c.success) return sendError(socket, sessionId, 'VE_PROTOCOL_002', 'invalid commit message', undefined);
        try {
          const result = await pipeline.commit(c.data.planId);
          if (result.status === 'committed') {
            const reply: WsCommitOkMessage = {
              kind: 'commit-ok',
              requestId: c.data.requestId,
              sessionId,
              commitId: result.commitId,
            };
            socket.send(JSON.stringify(reply));
          } else {
            const reply: WsCommitUncertainMessage = {
              kind: 'commit-uncertain',
              requestId: c.data.requestId,
              sessionId,
              lastError: result.lastError ?? 'unknown',
            };
            socket.send(JSON.stringify(reply));
          }
        } catch (err) {
          sendError(socket, sessionId, codeOf(err), (err as Error).message, c.data.requestId);
        }
        return;
      }

      if (obj.kind === 'bye') { socket.close(1000, 'bye'); return; }
    });
  });

  return wss;
}

function sendError(socket: WebSocket, sessionId: string, code: string, message: string, requestId: string | undefined): void {
  const base = { kind: 'error' as const, sessionId, code, message };
  const msg: WsErrorMessage = requestId !== undefined
    ? { ...base, requestId }
    : base;
  socket.send(JSON.stringify(msg));
}

function codeOf(err: unknown): string {
  const m = (err as Error).message ?? '';
  const match = m.match(/VE_[A-Z]+_\d+/);
  return match ? match[0] : 'VE_INTERNAL_999';
}

/**
 * Broadcast a file-changed event to all WS clients connected to the daemon. The clients
 * filter by sessionId on receive.
 */
export function broadcastFileChanged(wss: WebSocketServer, msg: Omit<WsFileChangedMessage, 'kind'>): void {
  const wire: WsFileChangedMessage = { kind: 'file-changed', ...msg };
  const payload = JSON.stringify(wire);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
