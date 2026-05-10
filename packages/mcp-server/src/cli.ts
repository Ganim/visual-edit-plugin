#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, resolve as pathResolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readDaemonLock as readLock } from '@visual-edit/shared';
import { registerTools } from './tools.js';

const AUTO_SPAWN_FLAG = process.env.MCP_AUTO_SPAWN === '1';
const AUTO_SPAWN_TIMEOUT_MS = 15_000;

function parseRoot(argv: string[]): string {
  const i = argv.indexOf('--root');
  return i >= 0 ? resolve(argv[i + 1] ?? '.') : process.cwd();
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function spawnDaemon(root: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const daemonCli = pathResolve(here, '../../daemon/dist/cli.js');
  // Detached so the daemon survives the mcp-server's exit.
  const child = spawn(process.execPath, [daemonCli, 'start', '--root', root], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  // Poll for lock file with a deadline.
  const deadline = Date.now() + AUTO_SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const lock = await readLock(root);
    if (lock && isProcessAlive(lock.pid)) return;
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(`auto-spawn timed out — daemon did not write a lock for ${root}`);
}

async function discoverDaemonUrl(root: string): Promise<string> {
  // Allow override (e.g. for tests or remote daemons).
  const override = process.env.VE_DAEMON_URL;
  if (override) return override;

  let lock = await readLock(root);
  if (!lock || !isProcessAlive(lock.pid)) {
    if (!AUTO_SPAWN_FLAG) {
      throw new Error(
        `daemon not running for root '${root}'. Either start it manually or run mcp-server with MCP_AUTO_SPAWN=1.\n` +
        `  node packages/daemon/dist/cli.js start --root ${root}`,
      );
    }
    await spawnDaemon(root);
    lock = await readLock(root);
    if (!lock) throw new Error('auto-spawn returned but lock missing');
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
