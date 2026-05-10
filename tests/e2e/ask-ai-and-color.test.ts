// tests/e2e/ask-ai-and-color.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { Daemon } from '@visual-edit/daemon';
import { chromium, type Browser, type Page } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const EXAMPLE_ROOT = resolve(REPO_ROOT, 'examples/basic-vite');
const HOME_TSX = resolve(EXAMPLE_ROOT, 'src/pages/Home.tsx');
// Editor-ui static build — served by the daemon at /__editor/.
const EDITOR_ASSETS_ROOT = resolve(REPO_ROOT, 'packages/editor-ui/dist');

let daemon: Daemon;
let daemonUrl: string;
let browser: Browser;
let originalHome: string;

beforeAll(async () => {
  originalHome = readFileSync(HOME_TSX, 'utf8');
  daemon = new Daemon({ root: EXAMPLE_ROOT, editorAssetsRoot: EDITOR_ASSETS_ROOT });
  await daemon.start();
  const port = daemon.getPort();
  if (!port) throw new Error('daemon did not bind a port');
  daemonUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await daemon?.stop();
  // Restore original file so the test is rerunnable locally.
  writeFileSync(HOME_TSX, originalHome, 'utf8');
}, 30_000);

describe('Phase 1.C acceptance: ask-ai cycle + color edit', () => {
  it('enqueues an ask-ai item via the editor; drain+resolve via HTTP; editor reflects committed status; color edit writes to disk', async () => {
    // 1. Open preview via daemon HTTP API.
    const openResp = await fetch(`${daemonUrl}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: EXAMPLE_ROOT, page: 'src/pages/Home.tsx' }),
    });
    if (!openResp.ok) {
      const body = await openResp.text();
      throw new Error(`POST /preview failed (${openResp.status}): ${body}`);
    }
    const { sessionId, editorUrl } = await openResp.json() as { url: string; sessionId: string; editorUrl: string };

    // 2. Boot editor-ui in a Playwright page.
    const page: Page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(editorUrl, { waitUntil: 'load', timeout: 30_000 });

    // 3. Wait for snapshot to arrive: __VE_DEBUG_SOURCEMAP populated by wsClient.ts.
    await page.waitForFunction(() => {
      const w = window as unknown as { __VE_DEBUG_SOURCEMAP?: Record<string, { tagName: string }> };
      return !!(w.__VE_DEBUG_SOURCEMAP && Object.keys(w.__VE_DEBUG_SOURCEMAP).length > 0);
    }, undefined, { timeout: 30_000 });

    // 4. Find the h1's vid from the exposed sourceMap.
    const h1Vid = await page.evaluate(() => {
      const w = window as unknown as { __VE_DEBUG_SOURCEMAP?: Record<string, { tagName: string }> };
      const sm = w.__VE_DEBUG_SOURCEMAP!;
      return Object.entries(sm).find(([, e]) => e.tagName === 'h1')?.[0] ?? null;
    });
    expect(h1Vid, 'h1 vid not found in sourceMap').not.toBeNull();

    // 5. Wait for overlay to render.
    await page.waitForSelector('[data-vid-overlay]', { timeout: 30_000 });

    // 6. Click the h1 overlay to select it.
    await page.click(`[data-vid-overlay="${h1Vid}"]`);

    // 7. Type prompt and click Ask AI button.
    await page.fill('[data-testid="ask-ai-input"]', 'make it red');
    await page.click('[data-testid="ask-ai-btn"]');

    // 8. Wait for the editor to receive 'ask-ai-queued' ack and expose a real askId via __VE_DEBUG_ASK_AI.
    //    The hook is a Zustand subscriber in App.tsx that mirrors askAiItems to window.__VE_DEBUG_ASK_AI.
    //    We wait until at least one entry with a non-optimistic key (no 'pending:' prefix) appears.
    const askIdHandle = await page.waitForFunction(() => {
      const items = Object.keys(
        (window as unknown as { __VE_DEBUG_ASK_AI?: Record<string, unknown> }).__VE_DEBUG_ASK_AI ?? {},
      );
      const realIds = items.filter((id) => !id.startsWith('pending:'));
      return realIds[0] ?? null;
    }, undefined, { timeout: 15_000 });

    const askIdValue = await askIdHandle.jsonValue() as string;
    expect(typeof askIdValue).toBe('string');
    expect(askIdValue.startsWith('pending:')).toBe(false);

    // 9. Drain via HTTP /drain-ask-ai.
    const drainResp = await fetch(`${daemonUrl}/drain-ask-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(drainResp.ok, `drain failed: ${drainResp.status}`).toBe(true);
    const drainBody = await drainResp.json() as { items: { askId: string }[]; leases: Record<string, string> };
    expect(drainBody.items.length).toBeGreaterThanOrEqual(1);
    const drainedItem = drainBody.items.find((i) => i.askId === askIdValue);
    expect(drainedItem, `ask-ai item ${askIdValue} not found in drain response`).toBeDefined();
    const leaseId = drainBody.leases[drainedItem!.askId];
    expect(leaseId, 'leaseId missing from drain response').toBeTruthy();

    // 10. Resolve as committed.
    const resolveResp = await fetch(`${daemonUrl}/resolve-ask-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        askId: askIdValue,
        leaseId,
        outcome: 'committed',
        summary: 'made h1 red',
        commitId: 'fake-c1',
      }),
    });
    expect(resolveResp.status, `resolve failed: ${resolveResp.status}`).toBe(204);

    // 11. Wait for the editor UI to render the committed status badge.
    //     The AiPromptPanel renders <li data-testid="askai-item-<askId>"> with outcome text.
    const committedSelector = `[data-testid="askai-item-${askIdValue}"]`;
    await page.waitForSelector(committedSelector, { timeout: 10_000 });
    const itemText = await page.textContent(committedSelector);
    expect(itemText, 'committed status not shown in UI').toContain('committed');

    // --- Color edit smoke ---
    // 12. Click Apply style with the default color picker value (#000000).
    //     This triggers a dry-run.
    await page.click('[data-testid="apply-style"]');
    await page.waitForSelector('text=dry-run ready', { timeout: 10_000 });

    // 13. Ctrl+S to commit. Use lowercase 's' — PropertiesPanel checks e.key === 's'.
    await page.bringToFront();
    await page.keyboard.press('Control+s');

    // 14. Wait for dry-run badge to disappear (commit-ok received).
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll('.text-amber-400'))
        .some((el) => el.textContent?.includes('dry-run ready')),
      undefined,
      { timeout: 20_000 },
    );

    // 15. Verify Home.tsx on disk has a style attribute with a color value.
    const after = readFileSync(HOME_TSX, 'utf8');
    expect(after, 'style attribute not written to disk').toContain('style={');
    expect(after, 'color not found in style attribute').toMatch(/color:\s*'#[0-9a-fA-F]{6}'/);

    // 16. No console errors in editor page.
    expect(consoleErrors, `editor had console errors: ${consoleErrors.join('; ')}`).toEqual([]);

    // 17. Cleanup.
    const closeResp = await fetch(`${daemonUrl}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(closeResp.status).toBe(204);
    await page.close();
  }, 120_000);
});
