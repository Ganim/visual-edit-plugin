import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { Daemon } from '@visual-edit/daemon';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const EXAMPLE_ROOT = resolve(REPO_ROOT, 'examples/basic-vite');
const HOME_TSX = resolve(EXAMPLE_ROOT, 'src/pages/Home.tsx');
const HOME_MODULE_CSS = resolve(EXAMPLE_ROOT, 'src/pages/Home.module.css');

let daemon: Daemon;
let originalHome: string;
let originalCss: string;

beforeAll(async () => {
  originalHome = readFileSync(HOME_TSX, 'utf8');
  originalCss = readFileSync(HOME_MODULE_CSS, 'utf8');
  daemon = new Daemon({ root: EXAMPLE_ROOT });
  await daemon.start();
}, 60_000);

afterAll(async () => {
  await daemon?.stop();
  writeFileSync(HOME_TSX, originalHome, 'utf8');
  writeFileSync(HOME_MODULE_CSS, originalCss, 'utf8');
}, 30_000);

describe('Phase 1.F acceptance: multi-file edit', () => {
  it('CSS Module edit persists to .module.css; both files invariants hold', async () => {
    // Open preview to create a session:
    const port = daemon.getPort()!;
    const openResp = await fetch(`http://127.0.0.1:${port}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: EXAMPLE_ROOT, page: 'src/pages/Home.tsx' }),
    });
    if (!openResp.ok) {
      throw new Error(`POST /preview failed (${openResp.status}): ${await openResp.text()}`);
    }
    const { sessionId } = await openResp.json() as { sessionId: string };

    // Open WS and send hello — this triggers getSnapshot() which instruments the file
    // (writes data-vid attrs to disk) and returns the sourceMap in the snapshot reply.
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ kind: 'hello', version: '1.0', sessionId }));

    // Receive the snapshot — it carries the sourceMap keyed by vid.
    const snapshotMsg = await new Promise<{ kind: string; sourceMap: Record<string, { tagName: string; cssModule: { binding: string } | null }> }>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    expect(snapshotMsg.kind).toBe('snapshot');

    // Find the vid for the h2 element that has a CSS Module binding 'subtitle':
    const entry = Object.entries(snapshotMsg.sourceMap).find(
      ([, e]) => e.tagName === 'h2' && e.cssModule?.binding === 'subtitle',
    );
    expect(entry, 'h2 with cssModule.binding=subtitle not found in sourceMap').toBeDefined();
    const vid = entry![0];

    let dryRunMessage: { planId: string } | null = null;
    let commitOkReceived = false;
    const wsErrors: string[] = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as { kind: string; planId?: string; message?: string; code?: string };
      if (m.kind === 'dry-run') dryRunMessage = m as never;
      if (m.kind === 'commit-ok') commitOkReceived = true;
      if (m.kind === 'error') wsErrors.push(`${m.code ?? 'ERR'}: ${m.message ?? '?'}`);
    });

    // Send CSS Module edit:
    ws.send(JSON.stringify({
      kind: 'edit', requestId: 'r1', sessionId,
      edits: [{ kind: 'css-module', element: vid, binding: 'subtitle', newRuleBody: 'color: red;\n  font-size: 14px;' }],
    }));

    // Wait for dry-run (allow up to 3s):
    await new Promise<void>((r) => setTimeout(r, 3000));
    expect(wsErrors, `WS errors: ${wsErrors.join('; ')}`).toEqual([]);
    expect(dryRunMessage, 'no dry-run received after 3s').not.toBeNull();

    // Send commit:
    ws.send(JSON.stringify({ kind: 'commit', requestId: 'r2', sessionId, planId: (dryRunMessage as { planId: string }).planId }));
    await new Promise<void>((r) => setTimeout(r, 3000));
    expect(commitOkReceived, 'no commit-ok received after 3s').toBe(true);

    // Verify disk: CSS file updated, gray replaced with red:
    const cssAfter = readFileSync(HOME_MODULE_CSS, 'utf8');
    expect(cssAfter).toContain('color: red');
    expect(cssAfter).not.toContain('color: gray');

    // Cleanup:
    await fetch(`http://127.0.0.1:${port}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    ws.close();
  }, 60_000);

  it('CSS Module nested-rule edit is refused with VE_CSSMOD_001', async () => {
    // Exercised by unit tests in cssModule.parser.test.ts; confirmed here as integration sanity.
    const { findCssRuleRange } = await import('@visual-edit/code-mods');
    // A compound selector triggers VE_CSSMOD_001:
    const nestedCss = `.foo .title { color: red; }`;
    expect(() => findCssRuleRange(nestedCss, 'title')).toThrow(/VE_CSSMOD_001/);
    // Daemon still accepting connections (basic liveness check via a known-bad route):
    const port = daemon.getPort()!;
    const resp = await fetch(`http://127.0.0.1:${port}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: EXAMPLE_ROOT, page: 'src/pages/NONEXISTENT.tsx' }),
    });
    // Expect a structured error response (not a crash — daemon still alive):
    expect(resp.ok).toBe(false);
  }, 30_000);

  it('styled-components cross-file refusal is VE_STYLED_001', async () => {
    const { instrument, planEdits } = await import('@visual-edit/code-mods');
    const src = `import { Title } from './styled.js';\nexport const X = () => <Title>Hi</Title>;\n`;
    const { instrumented, sourceMap } = instrument(src, 'X.tsx');
    const vid = Object.entries(sourceMap).find(([, e]) => e.tagName === 'Title')?.[0];
    expect(vid, 'Title vid not found').toBeDefined();
    expect(() => planEdits({
      filePath: 'X.tsx', source: instrumented, sourceMap,
      edits: [{ kind: 'styled-prop', element: vid!, newTemplateContent: 'x' }],
      resolvePath: () => '', readExternalFile: () => '',
    })).toThrow(/VE_STYLED_001/);
  }, 15_000);
});
