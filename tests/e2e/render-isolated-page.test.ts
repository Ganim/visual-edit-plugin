import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Daemon } from '@visual-edit/daemon';
import { chromium, type Browser } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../examples/basic-vite');

let daemon: Daemon;
let daemonUrl: string;
let browser: Browser;

beforeAll(async () => {
  // No explicit port — let findFreePort pick one in 5170-5179. The test reads
  // back the actual port via daemon.getPort() to avoid colliding with running services.
  daemon = new Daemon({ root: ROOT });
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

describe('Phase 1.A acceptance: render isolated page', () => {
  it('opens Home.tsx, renders with config.wrapPage + faker-derived mocks', async () => {
    const resp = await fetch(`${daemonUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: ROOT, page: 'src/pages/Home.tsx' }),
    });
    expect(resp.ok).toBe(true);
    const { url, sessionId } = await resp.json();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:51\d\d/);
    expect(sessionId).toMatch(/^[0-9a-f]{8}$/);

    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

    // Confirm the mock pipeline delivered bindings to the page (proves discoverSchemas →
    // buildFakerBindings → entry → globalThis chain works end-to-end, not just visually).
    const mockType = await page.evaluate(() => typeof (window as { __VE_MOCKS?: { makeUser?: unknown } }).__VE_MOCKS?.makeUser);
    expect(mockType).toBe('function');

    // The page should render the H1 with "Hello <name>"
    await page.waitForSelector('h1', { timeout: 10_000 });
    const h1 = await page.textContent('h1');
    expect(h1).toMatch(/^Hello /);

    // Email element exists
    const emailText = await page.textContent('p');
    expect(emailText).toMatch(/@/);

    // Tailwind class actually applied (non-default padding) — sanity check that index.css imported.
    const mainPadding = await page.evaluate(() => getComputedStyle(document.querySelector('main')!).padding);
    expect(mainPadding).not.toBe('0px');

    // Console must be clean (no errors)
    expect(consoleErrors).toEqual([]);

    // Cleanup: close preview
    const closeResp = await fetch(`${daemonUrl}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(closeResp.status).toBe(204);
    await page.close();
  });

  it('rejects unknown route with VE_PROJECT_002', async () => {
    const resp = await fetch(`${daemonUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: ROOT, page: 'src/pages/Nonexistent.tsx' }),
    });
    expect(resp.ok).toBe(false);
    const body = await resp.json();
    expect(body.error).toMatch(/VE_PROJECT_002|not found/);
  });
});
