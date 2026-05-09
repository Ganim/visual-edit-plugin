---
description: Open a React page in the visual editor preview
argument-hint: "<page>"
---

You are about to open the page `$ARGUMENTS` in the visual editor.

Steps:
1. Resolve the absolute path of the current project root (use `pwd` if needed).
2. Call the MCP tool `open_page` with `{ root: <pwd>, page: "$ARGUMENTS" }`.
3. The tool returns `{ url, sessionId }`. Show the URL to the user — they should open it directly in their browser to see the rendered page. **In Phase 1.A there is no editor-ui yet — the URL points straight at the synthetic Vite preview.**
4. If the user asks to close, call `close_preview` with the same `sessionId`.

If the tool fails with "daemon not running", tell the user to run in a separate terminal:
```
node packages/daemon/dist/cli.js start --root .
```
Then retry. The MCP server discovers the daemon's actual port by reading `.visual-edit/daemon.lock` — no fixed port assumption.
