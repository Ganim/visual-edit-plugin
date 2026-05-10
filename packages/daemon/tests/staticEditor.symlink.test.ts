import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer } from '../src/http.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-sym-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('serveEditor symlink guard', () => {
  it('rejects a symlink inside assetsRoot pointing outside', async () => {
    const assetsRoot = join(tmp, 'editor-dist');
    const secrets = join(tmp, 'secrets');
    mkdirSync(assetsRoot, { recursive: true });
    mkdirSync(secrets, { recursive: true });
    writeFileSync(join(secrets, 'password.txt'), 'shhh', 'utf8');
    writeFileSync(join(assetsRoot, 'index.html'), '<title>ok</title>', 'utf8');

    // Create the symlink. On Windows requires either Developer Mode or admin; if it fails,
    // skip the test gracefully — the behavior we're guarding against is only reachable
    // when symlinks succeed.
    let symlinkOk = true;
    try { symlinkSync(secrets, join(assetsRoot, 'leak'), 'junction'); }
    catch { symlinkOk = false; }
    if (!symlinkOk) return;

    const server = createHttpServer({
      openPreview: async () => ({ url: 'http://x', sessionId: 's', editorUrl: 'http://x' }),
      closePreview: async () => undefined,
      getStatus: async () => ({ daemonVersion: 'x', uptime: 0, activePreviews: 0, workerHealth: {} }),
      rollback: async () => undefined,
      drainAskAI: async () => ({ items: [], leases: {} }),
      resolveAskAI: async () => undefined,
      editorAssetsRoot: assetsRoot,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}/__editor/leak/password.txt`);
    expect(r.status).toBe(404);
    await new Promise<void>((r2) => server.close(() => r2()));
    expect(existsSync(join(assetsRoot, 'leak'))).toBe(true); // sanity: the symlink was created
  });
});
