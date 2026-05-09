#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PLUGIN_ROOT, '..', '..');

const projectRoot = resolve(process.argv[2] ?? process.cwd());
const dest = process.argv[3] ?? resolve(projectRoot, '.mcp.json');

const mcpServerCli = resolve(REPO_ROOT, 'packages/mcp-server/dist/cli.js');
const tpl = readFileSync(join(PLUGIN_ROOT, '.mcp.json.template'), 'utf8');
const out = tpl
  .replace('__MCP_SERVER_CLI__', mcpServerCli.replace(/\\/g, '/'))
  .replace('__PROJECT_ROOT__', projectRoot.replace(/\\/g, '/'));

mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, out, 'utf8');
console.log(`wrote ${dest}`);
console.log(`mcp-server cli: ${mcpServerCli}`);
console.log(`project root: ${projectRoot}`);
