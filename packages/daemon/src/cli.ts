#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Daemon } from './daemon.js';

function resolveEditorAssetsRoot(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, '../../editor-ui/dist'),
      resolve(here, '../../../node_modules/@visual-edit/editor-ui/dist'),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
  } catch {}
  return undefined;
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'start') {
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(args[rootIdx + 1] ?? '.') : process.cwd();
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;
  const editorAssetsRoot = resolveEditorAssetsRoot();
  const editorOpt = editorAssetsRoot !== undefined ? { editorAssetsRoot } : {};

  const daemon = new Daemon(port !== undefined ? { root, port, ...editorOpt } : { root, ...editorOpt });
  daemon.start().catch((err) => {
    process.stderr.write(`daemon failed to start: ${(err as Error).message}\n`);
    process.exit(1);
  });
} else {
  process.stderr.write('usage: visual-edit-daemon start --root <path> [--port <n>]\n');
  process.exit(1);
}
