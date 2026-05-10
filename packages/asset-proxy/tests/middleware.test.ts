import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { createAssetMiddleware } from '../src/middleware.js';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('createAssetMiddleware', () => {
  it('placeholder strategy returns SVG for /__assets/proxy', async () => {
    const mw = createAssetMiddleware({ publicDir: null, remoteImageStrategy: 'placeholder' });
    const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}/__assets/proxy?u=${encodeURIComponent('https://example.com/x.png')}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('svg');
    await new Promise<void>((r2) => server.close(() => r2()));
  });

  it('serves local files from publicDir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 've-mw-'));
    try {
      mkdirSync(join(tmp, 'public'), { recursive: true });
      writeFileSync(join(tmp, 'public', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const mw = createAssetMiddleware({ publicDir: join(tmp, 'public'), remoteImageStrategy: 'placeholder' });
      const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const port = (server.address() as { port: number }).port;
      const r = await fetch(`http://127.0.0.1:${port}/__assets/local/logo.png`);
      expect(r.status).toBe(200);
      await new Promise<void>((r2) => server.close(() => r2()));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  it('rejects path traversal in /__assets/local/', async () => {
    const mw = createAssetMiddleware({ publicDir: '/x', remoteImageStrategy: 'placeholder' });
    const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}/__assets/local/..%2F..%2Fetc%2Fpasswd`);
    expect(r.status).toBe(404);
    await new Promise<void>((r2) => server.close(() => r2()));
  });
});
