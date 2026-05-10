#!/usr/bin/env node
import { runLogs } from './logs.js';
import { runDiagnose } from './diagnose.js';

function parseArgs(argv: string[]): { cmd: string | null; flags: Map<string, string> } {
  const cmd = argv[0] ?? null;
  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
    else flags.set(a.slice(2), 'true');
  }
  return { cmd, flags };
}

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd === 'logs')
    return runLogs({
      root: flags.get('root') ?? process.cwd(),
      trace: flags.get('trace') ?? null,
      since: flags.get('since') ?? null,
    });
  if (cmd === 'diagnose') {
    const path = await runDiagnose({
      root: flags.get('root') ?? process.cwd(),
      since: flags.get('since') ?? null,
      includeRaw: flags.get('include-raw') === 'true',
      output: flags.get('out') ?? null,
    });
    process.stdout.write(`diagnose written to: ${path}\n`);
    return;
  }
  // reset-queue added in Task 5
  if (!cmd || cmd === '--help' || cmd === 'help') {
    process.stdout.write(
      `visual-edit CLI\n\nSubcommands:\n  logs --trace=<id> [--root=<path>]\n  logs --since=<duration> [--root=<path>]\n  diagnose [--since=<duration>] [--include-raw]\n  reset-queue --root=<path>\n`,
    );
    return;
  }
  process.stderr.write(`unknown subcommand: ${cmd}\n`);
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`visual-edit: ${(err as Error).message}\n`);
  process.exit(1);
});
