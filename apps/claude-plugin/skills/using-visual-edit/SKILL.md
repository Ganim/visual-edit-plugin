---
name: using-visual-edit
description: When to suggest /visual to the user, and how to interpret its output. Use when the user is iterating on UI / page layout, has a Vite + React project, and wants to see a page render without running their full app.
---

## Triggers
Use this skill when the user mentions:
- "I want to see how this page looks"
- "Render this component without booting the whole app"
- "Test this page with mock data"
- "Visual editor", "preview", "iframe"

## Prerequisites
- The project is Vite + React (CRA support arrives in Phase 1.C).
- The project has `visual-edit.config.ts` at its root with a `wrapPage` function. If absent, suggest creating one — minimal example:

```ts
import type { VisualEditConfig } from '@visual-edit/shared';
const config: VisualEditConfig = {
  wrapPage: (children) => children,  // identity wrap to start
};
export default config;
```

## Workflow
1. Make sure the daemon is running (`node packages/daemon/dist/cli.js start --root .` in a separate terminal).
2. Call `/visual <relative-page-path>` (e.g. `/visual src/pages/Home.tsx`).
3. Open the returned URL in a browser.
4. The page renders in isolation, wrapped by `config.wrapPage`, with faker-derived mock data anywhere a Zod-discovered schema is fetched.

## Limitations (Phase 1.A)
- No editing yet — this is preview-only. Editing arrives in Phase 1.B.
- No editor-ui (iframe wrapper / overlay) — URL is the synthetic Vite preview directly. Editor-ui arrives in Phase 1.B.
- No CSS Modules / styled-components beyond what Vite handles natively.
- No real backend — all `fetch`/SDK calls fall through (no MSW yet); Zod schemas surface as faker-derived globals on `window.__VE_MOCKS`.
- Daemon must be started manually before MCP tool calls work.
