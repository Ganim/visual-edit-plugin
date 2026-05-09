# Visual Edit — Claude Code Plugin

Renders React pages in isolation with mocked data, no app boot required.

## Phase 1.A status: preview-only. No editing yet.

## Install (local development)

1. Build the workspace: `npm run build` from the repo root.
2. Generate the project-level `.mcp.json`:
   ```
   node apps/claude-plugin/scripts/install-mcp.mjs /abs/path/to/your/project
   ```
3. (Optional) Symlink `apps/claude-plugin/` into `~/.claude/plugins/visual-edit/` so the slash command + skill are discoverable.
4. Restart Claude Code.

## Use

In your Vite + React project:

1. Create `visual-edit.config.ts` at the project root (see `using-visual-edit` skill for template).
2. Start the daemon: `node packages/daemon/dist/cli.js start --root .`
3. In Claude Code, run `/visual src/pages/Home.tsx`.
4. Open the returned URL in your browser.
