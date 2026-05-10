import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Daemon } from '@visual-edit/daemon';
import { chromium, type Browser, type Page } from 'playwright';
import {
  instrument,
  apply,
  planEdits,
  assertEditEquivalence,
  assertCommentsPreserved,
  assertWhitespacePreservedOutsidePatches,
  readCommitLog,
} from '@visual-edit/code-mods';

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

describe('Phase 1.B acceptance: edit + commit + invariants', () => {
  it('opens preview, selects h1, changes className, commits to disk, invariants hold', async () => {
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
    const { url, sessionId, editorUrl } = await openResp.json() as {
      url: string;
      sessionId: string;
      editorUrl: string;
    };
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:5\d\d\d/);
    expect(editorUrl).toContain(`session=${sessionId}`);

    // 2. Boot editor-ui in a Playwright page. The editor connects to daemonUrl WS
    //    automatically via the URL's session query param.
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

    // 5. Wait for at least one overlay rect to render (bridge has posted rects via postMessage).
    await page.waitForSelector('[data-vid-overlay]', { timeout: 30_000 });

    // 6. Click the overlay corresponding to the h1.
    await page.click(`[data-vid-overlay="${h1Vid}"]`);

    // 7. Type the new className and click Apply.
    await page.fill('[data-testid="classname-input"]', 'text-red-500');
    await page.click('[data-testid="apply-className"]');

    // 8. Wait for the dry-run badge to appear (Zustand pendingDryRun set).
    await page.waitForSelector('text=dry-run ready', { timeout: 10_000 });

    // 9. Press Ctrl+S to commit. Use lowercase 's' since PropertiesPanel checks e.key === 's'.
    await page.bringToFront();
    await page.keyboard.press('Control+s');

    // 10. Wait for the dry-run badge to disappear (commit-ok received, pendingDryRun cleared).
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll('.text-amber-400'))
        .some((el) => el.textContent?.includes('dry-run ready')),
      undefined,
      { timeout: 20_000 },
    );

    // 11. Disk file should now contain text-red-500 in h1's className.
    const after = readFileSync(HOME_TSX, 'utf8');
    expect(after, 'text-red-500 not written to disk').toContain('text-red-500');

    // 12. Re-validate invariants using a fresh instrument of the original file's content.
    //     Note: instrument() normalizes filePath to forward slashes in computeVid so vids
    //     are consistent with the daemon's vids regardless of OS path separator.
    const { instrumented: instrumentedBefore, sourceMap: smBefore } = instrument(originalHome, HOME_TSX);
    const targetVid = Object.entries(smBefore).find(([, e]) => e.tagName === 'h1')?.[0];
    expect(targetVid, 'h1 vid not found in re-instrumented sourceMap').toBeDefined();
    // planEdits now takes a single PlanEditsInput object and returns PlannedFile[].
    const plannedFiles = planEdits({
      filePath: HOME_TSX,
      source: instrumentedBefore,
      sourceMap: smBefore,
      edits: [{ kind: 'className', element: targetVid!, newValue: 'text-red-500' }],
      resolvePath: (importPath) => resolve(dirname(HOME_TSX), importPath),
      readExternalFile: (absPath) => readFileSync(absPath, 'utf8'),
    });
    // Extract the patches for the home file (the only target for a className edit).
    const homePatches = plannedFiles.find((f) => f.filePath === HOME_TSX)?.patches ?? [];
    const expected = apply(instrumentedBefore, homePatches);

    // The on-disk content should match instrumented + edit applied.
    expect(after).toBe(expected.after);
    expect(() => assertEditEquivalence(instrumentedBefore, after, [targetVid!])).not.toThrow();
    expect(() => assertCommentsPreserved(instrumentedBefore, after)).not.toThrow();
    expect(() => assertWhitespacePreservedOutsidePatches(instrumentedBefore, after, homePatches)).not.toThrow();

    // 13. Commit log must have an entry for the user-driven commit.
    const log = readCommitLog(EXAMPLE_ROOT);
    const afterHash = createHash('sha256').update(after).digest('hex');
    const userCommit = log.find((e) => e.kind === 'commit' && e.sha256After === afterHash);
    expect(userCommit, 'user commit entry not found in commit log').toBeDefined();

    // 14. Backup file (content immediately before the user commit) must contain the original
    //     'text-2xl' className — proving the pre-edit snapshot was captured.
    const backupPath = join(EXAMPLE_ROOT, '.visual-edit/backups', `Home.tsx-${userCommit!.commitId}`);
    const backupContent = readFileSync(backupPath, 'utf8');
    expect(backupContent, 'backup does not contain text-2xl').toContain('text-2xl');

    // 15. Editor page must be free of console errors.
    expect(consoleErrors, `editor had console errors: ${consoleErrors.join('; ')}`).toEqual([]);

    // 16. Cleanup.
    const closeResp = await fetch(`${daemonUrl}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    expect(closeResp.status).toBe(204);
    await page.close();
  }, 120_000);
});
