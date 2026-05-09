#!/usr/bin/env node
import { resolve } from 'node:path';
import { Daemon } from './daemon.js';

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'start') {
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(args[rootIdx + 1] ?? '.') : process.cwd();
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;

  const daemon = new Daemon(port !== undefined ? { root, port } : { root });
  daemon.start().catch((err) => {
    process.stderr.write(`daemon failed to start: ${(err as Error).message}\n`);
    process.exit(1);
  });
} else {
  process.stderr.write('usage: visual-edit-daemon start --root <path> [--port <n>]\n');
  process.exit(1);
}
