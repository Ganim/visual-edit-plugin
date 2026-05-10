import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface RunLogsInput {
  root: string;
  trace: string | null;
  since: string | null; // e.g. "1h", "30m", "2d"
}

const DURATION_RX = /^(\d+)(s|m|h|d)$/;
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseSince(s: string): number | null {
  const m = DURATION_RX.exec(s);
  if (!m) return null;
  return Date.now() - Number(m[1]) * UNIT_MS[m[2]!]!;
}

export function runLogs(input: RunLogsInput): void {
  const logsRoot = join(input.root, '.visual-edit', 'logs');
  if (!existsSync(logsRoot)) {
    process.stderr.write(`no logs found at ${logsRoot}\n`);
    process.exit(1);
  }

  const sinceMs = input.since ? parseSince(input.since) : null;
  if (input.since && sinceMs === null) {
    process.stderr.write(`invalid --since duration: ${input.since}\n`);
    process.exit(2);
  }

  // Walk every dated directory + read daemon.log + worker-*.log; filter.
  const dates = readdirSync(logsRoot)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  for (const date of dates) {
    const dir = join(logsRoot, date);
    const files = readdirSync(dir).filter((f) => f.endsWith('.log'));
    for (const file of files) {
      const path = join(dir, file);
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (input.trace && entry['traceId'] !== input.trace) continue;
        if (
          sinceMs !== null &&
          typeof entry['ts'] === 'string' &&
          Date.parse(entry['ts']) < sinceMs
        )
          continue;
        process.stdout.write(line + '\n');
      }
    }
  }
}
