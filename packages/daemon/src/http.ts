import { createServer, type Server } from 'node:http';
import {
  OpenPreviewRequest,
  OpenPreviewResponse,
  ClosePreviewRequest,
  StatusResponse,
} from '@visual-edit/protocol';

export interface HttpHandlers {
  openPreview: (req: OpenPreviewRequest) => Promise<OpenPreviewResponse>;
  closePreview: (req: ClosePreviewRequest) => Promise<void>;
  getStatus: () => Promise<StatusResponse>;
}

export function createHttpServer(handlers: HttpHandlers): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    try {
      const body = await readJsonBody(req);
      if (req.method === 'POST' && req.url === '/preview') {
        const parsed = OpenPreviewRequest.parse(body);
        const resp = await handlers.openPreview(parsed);
        send(200, resp);
      } else if (req.method === 'POST' && req.url === '/close') {
        const parsed = ClosePreviewRequest.parse(body);
        await handlers.closePreview(parsed);
        send(204, null);
      } else if (req.method === 'GET' && req.url === '/status') {
        const status = await handlers.getStatus();
        send(200, status);
      } else {
        send(404, { error: 'not found' });
      }
    } catch (err) {
      send(500, { error: (err as Error).message });
    }
  });
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}
