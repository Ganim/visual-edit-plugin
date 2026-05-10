// tests/e2e/realistic-preview.test.ts
// Phase 1.E acceptance gate — realistic preview with MSW + asset-proxy.
//
// Exercises:
//   1. findApiContracts → daemon wires endpoints into AdapterInput
//   2. buildMSWHandlers generates a GET /api/users/me handler backed by makeUser()
//   3. MSW service worker intercepts fetch in the browser
//   4. asset-proxy /__assets/proxy?u=… responds with a placeholder (naturalWidth > 0)
//   5. Zero console errors (MSW quiet mode, Tailwind loaded)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Daemon } from '@visual-edit/daemon';
import { chromium, type Browser } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_ROOT = resolve(__dirname, '../../examples/basic-vite');

let daemon: Daemon;
let daemonUrl: string;
let browser: Browser;

beforeAll(async () => {
  daemon = new Daemon({ root: EXAMPLE_ROOT });
  await daemon.start();
  const port = daemon.getPort();
  if (!port) throw new Error('daemon did not bind a port');
  daemonUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await daemon?.stop();
}, 30_000);

describe('Phase 1.E acceptance: realistic preview (MSW + asset-proxy)', () => {
  it('renders Home.tsx with API mock + proxy images, zero console errors', async () => {
    // 1. Open preview
    const resp = await fetch(`${daemonUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: EXAMPLE_ROOT, page: 'src/pages/Home.tsx' }),
    });
    expect(resp.ok, `POST /preview failed: ${resp.status}`).toBe(true);
    const { url, sessionId } = await resp.json() as { url: string; sessionId: string };
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:51\d\d/);
    expect(sessionId).toMatch(/^[0-9a-f]{8}$/);

    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // 2. Load the preview URL
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

    // 3. h1 starts with "Hello "
    await page.waitForSelector('h1', { timeout: 10_000 });
    const h1Text = await page.textContent('h1');
    expect(h1Text).toMatch(/^Hello /);

    // 4. Every <img> on the page has naturalWidth > 0
    //    - The banner img goes through /__assets/proxy → placeholder SVG (1×1) → naturalWidth = 1
    //    - The avatar img (if rendered) goes through makeUser() faker.image.avatar() URL
    //      which may be an external URL; the proxy returns placeholder regardless → naturalWidth ≥ 1
    const imgNaturalWidths = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).map((img) => ({
        src: img.src,
        naturalWidth: img.naturalWidth,
        complete: img.complete,
      }))
    );

    // There must be at least the banner img
    expect(imgNaturalWidths.length).toBeGreaterThanOrEqual(1);

    for (const img of imgNaturalWidths) {
      expect(
        img.naturalWidth,
        `img with src="${img.src}" has naturalWidth=0 (failed to load)`,
      ).toBeGreaterThan(0);
    }

    // 5. Zero console errors
    expect(consoleErrors, `console errors: ${consoleErrors.join(', ')}`).toEqual([]);

    // Cleanup
    const closeResp = await fetch(`${daemonUrl}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(closeResp.status).toBe(204);
    await page.close();
  }, 90_000);
});
