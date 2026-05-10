import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep, extname } from 'node:path';
import {
  OpenPreviewRequest,
  OpenPreviewResponse,
  ClosePreviewRequest,
  StatusResponse,
  RollbackRequest,
} from '@visual-edit/protocol';

export interface HttpHandlers {
  openPreview: (req: OpenPreviewRequest) => Promise<OpenPreviewResponse>;
  closePreview: (req: ClosePreviewRequest) => Promise<void>;
  getStatus: () => Promise<StatusResponse>;
  rollback: (req: RollbackRequest) => Promise<void>;
  /** Absolute path to a directory containing editor-ui's static build (index.html etc.). */
  editorAssetsRoot?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createHttpServer(handlers: HttpHandlers): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    try {
      // Static editor route — handle BEFORE JSON body parsing.
      if (req.method === 'GET' && req.url?.startsWith('/__editor/')) {
        return await serveEditor(req.url, handlers.editorAssetsRoot, res);
      }
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
      } else if (req.method === 'POST' && req.url === '/rollback') {
        const parsed = RollbackRequest.parse(body);
        await handlers.rollback(parsed);
        send(204, null);
      } else {
        send(404, { error: 'not found' });
      }
    } catch (err) {
      send(500, { error: (err as Error).message });
    }
  });
}

async function serveEditor(
  reqUrl: string,
  assetsRoot: string | undefined,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (!assetsRoot) { res.statusCode = 404; res.end('editor not configured'); return; }
  // Strip query string + leading /__editor/. Decode percent-escapes BEFORE normalizing so
  // an attacker sending `..%2F..%2Fetc%2Fpasswd` cannot bypass the `..` guard.
  let decoded: string;
  try { decoded = decodeURIComponent(reqUrl.split('?')[0]!); }
  catch { res.statusCode = 400; res.end('bad request'); return; }
  const stripped = decoded.replace(/^\/__editor\//, '');
  const safeRel = normalize(stripped).replace(/^(\.\.[\/\\])+/g, '');
  if (safeRel.includes('..')) { res.statusCode = 404; res.end('not found'); return; }
  let target = safeRel === '' ? 'index.html' : safeRel;
  let abs = join(assetsRoot, target);
  // Make sure abs is still under assetsRoot (defensive).
  const normRoot = normalize(assetsRoot) + sep;
  if (!(normalize(abs) + sep).startsWith(normRoot) && normalize(abs) !== normalize(assetsRoot)) {
    res.statusCode = 404; res.end('not found'); return;
  }
  if (!existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
  if (statSync(abs).isDirectory()) abs = join(abs, 'index.html');
  if (!existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
  const content = await readFile(abs);
  const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', mime);
  res.end(content);
}

async function readJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}
