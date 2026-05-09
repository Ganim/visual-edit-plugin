import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { WsHelloMessage, type WsSnapshotMessage } from '@visual-edit/protocol';
import type { PreviewSession } from '@visual-edit/shared';

export interface WsHandlers {
  getSession: (sessionId: string) => PreviewSession | null;
}

/**
 * Attach a WebSocket server to the daemon HTTP server. Currently has no in-tree consumer
 * (editor-ui is deferred to Phase 1.B), but the snapshot contract is wired so 1.B can
 * consume it without refactoring the daemon.
 */
export function attachWebSocket(http: Server, handlers: WsHandlers): WebSocketServer {
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (raw) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString()); } catch { socket.close(1003, 'invalid json'); return; }
      const hello = WsHelloMessage.safeParse(parsed);
      if (!hello.success) { socket.close(1003, 'expected hello'); return; }

      const session = handlers.getSession(hello.data.sessionId);
      if (!session) { socket.close(1008, 'unknown session'); return; }

      const snapshot: WsSnapshotMessage = {
        kind: 'snapshot',
        sessionId: session.id,
        url: session.url,
        status: session.status,
      };
      socket.send(JSON.stringify(snapshot));
    });
  });
  return wss;
}
