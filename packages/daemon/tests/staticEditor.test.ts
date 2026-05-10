import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as http from 'node:http';
import { createHttpServer } from '../src/http.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-static-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('GET /__editor/*', () => {
  it('serves editor-ui static assets from configured directory', async () => {
    const assetsRoot = join(tmp, 'editor-dist');
    mkdirSync(assetsRoot, { recursive: true });
    writeFileSync(join(assetsRoot, 'index.html'), '<!doctype html><title>editor</title>', 'utf8');
    writeFileSync(join(assetsRoot, 'main.js'), 'console.log("hi")', 'utf8');

    const server = createHttpServer({
      openPreview: async () => ({ url: 'http://x', sessionId: 's', editorUrl: 'http://x/__editor/?session=s' }),
      closePreview: async () => undefined,
      getStatus: async () => ({ daemonVersion: 'x', uptime: 0, activePreviews: 0, workerHealth: {} }),
      editorAssetsRoot: assetsRoot,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const indexResp = await fetch(`http://127.0.0.1:${port}/__editor/`);
    expect(indexResp.status).toBe(200);
    expect(await indexResp.text()).toContain('editor');

    const jsResp = await fetch(`http://127.0.0.1:${port}/__editor/main.js`);
    expect(jsResp.status).toBe(200);
    expect(await jsResp.text()).toBe('console.log("hi")');

    const missingResp = await fetch(`http://127.0.0.1:${port}/__editor/no-such.js`);
    expect(missingResp.status).toBe(404);

    // Path traversal guard — must send the raw path (fetch normalizes ../ client-side, so we
    // use a low-level http request that puts the literal traversal sequence on the wire).
    const traversalStatus = await new Promise<number>((res) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'GET', path: '/__editor/..%2F..%2Fetc%2Fpasswd' },
        (r) => res(r.statusCode ?? 0),
      );
      req.end();
    });
    expect(traversalStatus).toBe(404);

    await new Promise<void>((r) => server.close(() => r()));
  });
});
