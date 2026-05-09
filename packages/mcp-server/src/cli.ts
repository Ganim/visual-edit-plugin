#!/usr/bin/env node
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readLock } from '@visual-edit/daemon';
import { registerTools } from './tools.js';

function parseRoot(argv: string[]): string {
  const i = argv.indexOf('--root');
  return i >= 0 ? resolve(argv[i + 1] ?? '.') : process.cwd();
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function discoverDaemonUrl(root: string): Promise<string> {
  // Allow override (e.g. for tests or remote daemons).
  const override = process.env.VE_DAEMON_URL;
  if (override) return override;

  const lock = await readLock(root);
  if (!lock) {
    throw new Error(
      `daemon not running for root '${root}'. Start it with:\n` +
      `  node packages/daemon/dist/cli.js start --root ${root}`,
    );
  }
  if (!isProcessAlive(lock.pid)) {
    const lockPath = resolve(root, '.visual-edit', 'daemon.lock');
    throw new Error(
      `stale daemon lock found (pid ${lock.pid} not alive).\n` +
      `Remove the lock file and restart:\n` +
      `  rm ${lockPath}\n` +
      `  node packages/daemon/dist/cli.js start --root ${root}`,
    );
  }
  return `http://127.0.0.1:${lock.port}`;
}

async function main(): Promise<void> {
  const root = parseRoot(process.argv.slice(2));
  const daemonUrl = await discoverDaemonUrl(root);

  const server = new Server(
    { name: 'visual-edit-mcp-server', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  registerTools(server, daemonUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`mcp-server failed: ${(err as Error).message}\n`);
  process.exit(1);
});
