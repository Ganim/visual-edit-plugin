import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { dispatchStrategy, type RemoteImageStrategy, type CachedAsset } from './strategies.js';

export interface AssetProxyOpts {
  publicDir: string | null;
  remoteImageStrategy: RemoteImageStrategy;
  fontFallback?: 'system' | Record<string, string>;
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

export function createAssetMiddleware(opts: AssetProxyOpts): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const cache = new Map<string, CachedAsset>();

  return (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith('/__assets/')) return next();

    if (url.startsWith('/__assets/proxy?u=')) {
      const encoded = url.slice('/__assets/proxy?u='.length);
      let remote: string;
      try { remote = decodeURIComponent(encoded); }
      catch { res.statusCode = 400; res.end('bad request'); return; }
      dispatchStrategy(opts.remoteImageStrategy, { url: remote, cache })
        .then((r) => {
          res.statusCode = r.status;
          res.setHeader('Content-Type', r.contentType);
          if (typeof r.body === 'string') res.end(r.body);
          else res.end(Buffer.from(r.body));
        })
        .catch((err) => {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain');
          res.end(`asset-proxy: ${(err as Error).message}`);
        });
      return;
    }

    if (url.startsWith('/__assets/local/')) {
      const rel = url.slice('/__assets/local/'.length).split('?')[0]!;
      let decoded: string;
      try { decoded = decodeURIComponent(rel); }
      catch { res.statusCode = 400; res.end('bad request'); return; }
      if (!opts.publicDir || decoded.includes('..')) {
        res.statusCode = 404; res.end('not found'); return;
      }
      const abs = join(opts.publicDir, decoded);
      if (!existsSync(abs)) { res.statusCode = 404; res.end('not found'); return; }
      const ext = extname(abs).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      res.end(readFileSync(abs));
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  };
}
