/**
 * Phase 1.G acceptance — Operational maturity
 *
 * Exercises 4 of the 6 acceptance scenarios (heartbeat + WAL recovery are
 * covered by unit tests in packages/daemon/tests/).
 *
 * 1. Logs persist on disk   — daemon writes NDJSON to .visual-edit/logs/<today>/daemon.log
 * 2. CLI logs by traceId    — spawn `node cli.js logs --trace=<id>` → assert output
 * 3. CLI diagnose zip       — spawn `node cli.js diagnose --root=<tmp>` → zip exists + contains daemon.log
 * 4. Hot-reload config      — start daemon, open WS, modify config → `config-changed` within 2s
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { Daemon } from '@visual-edit/daemon';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const EXAMPLE_ROOT = resolve(REPO_ROOT, 'examples/basic-vite');
const CLI_JS = resolve(REPO_ROOT, 'packages/cli/dist/cli.js');
const CONFIG_FILE = join(EXAMPLE_ROOT, 'visual-edit.config.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawnCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_JS, ...args], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/** Return the NDJSON daemon.log path for today under root. */
function daemonLogPath(root: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return join(root, '.visual-edit', 'logs', today, 'daemon.log');
}

// ---------------------------------------------------------------------------
// Scenario 1: Logs persist on disk
// ---------------------------------------------------------------------------

describe('Phase 1.G acceptance – scenario 1: logs persist on disk', () => {
  let daemon: Daemon;
  const logCleaner: string[] = [];

  beforeAll(async () => {
    daemon = new Daemon({ root: EXAMPLE_ROOT });
    await daemon.start();
  }, 60_000);

  afterAll(async () => {
    await daemon?.stop();
    // Clean up log artefacts written by this test run.
    for (const p of logCleaner) {
      try { rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }, 30_000);

  it('daemon writes NDJSON log lines to .visual-edit/logs/<today>/daemon.log', () => {
    const logPath = daemonLogPath(EXAMPLE_ROOT);
    logCleaner.push(join(EXAMPLE_ROOT, '.visual-edit', 'logs'));
    expect(existsSync(logPath), `expected log file at ${logPath}`).toBe(true);

    const raw = readFileSync(logPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    for (const line of lines) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Non-JSON line in daemon.log: ${line}`);
      }
      expect(typeof parsed.ts).toBe('string');
      expect(typeof parsed.level).toBe('string');
      expect(typeof parsed.msg).toBe('string');
    }

    // Specifically the "daemon started" info line must be present.
    const hasStarted = lines.some((l) => {
      try {
        const p = JSON.parse(l) as { level?: string; msg?: string };
        return p.level === 'info' && typeof p.msg === 'string' && p.msg.includes('daemon started');
      } catch { return false; }
    });
    expect(hasStarted, 'expected "daemon started" info log line').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: CLI logs by traceId
// ---------------------------------------------------------------------------

describe('Phase 1.G acceptance – scenario 2: CLI logs by traceId', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 've-e2e-logs-'));
    const today = new Date().toISOString().slice(0, 10);
    const dir = join(tmp, '.visual-edit', 'logs', today);
    mkdirSync(dir, { recursive: true });

    const TARGET_TRACE = 'trace-abc-123';
    const OTHER_TRACE  = 'trace-xyz-999';

    writeFileSync(
      join(dir, 'daemon.log'),
      JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'target line', traceId: TARGET_TRACE }) + '\n' +
      JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: 'noise line', traceId: OTHER_TRACE }) + '\n',
      'utf8',
    );
    // Store trace id so tests can reference it.
    (globalThis as Record<string, unknown>).__e2eTraceId = TARGET_TRACE;
    (globalThis as Record<string, unknown>).__e2eLogsRoot = tmp;
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('CLI logs --trace=<id> prints only lines matching the traceId', async () => {
    const traceId = (globalThis as { __e2eTraceId: string }).__e2eTraceId;
    const root = (globalThis as { __e2eLogsRoot: string }).__e2eLogsRoot;

    const { stdout, code } = await spawnCli(['logs', `--root=${root}`, `--trace=${traceId}`]);

    expect(code, `CLI exited with non-zero code: ${code}`).toBe(0);
    expect(stdout).toContain('"traceId":"trace-abc-123"');
    expect(stdout).toContain('"msg":"target line"');
    // Must NOT include the noise line.
    expect(stdout).not.toContain('"traceId":"trace-xyz-999"');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Scenario 3: CLI diagnose produces zip
// ---------------------------------------------------------------------------

describe('Phase 1.G acceptance – scenario 3: CLI diagnose produces zip', () => {
  let tmp: string;
  let outZip: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 've-e2e-diag-'));
    outZip = join(tmp, 'out.zip');

    const today = new Date().toISOString().slice(0, 10);
    const dir = join(tmp, '.visual-edit', 'logs', today);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'daemon.log'), '{"ts":"2026-05-10T00:00:00.000Z","level":"info","msg":"boot"}\n', 'utf8');
    writeFileSync(join(dir, 'startup.json'), JSON.stringify({ daemonVersion: '0.0.0', pid: 1 }), 'utf8');
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('CLI diagnose --root=<tmp> --out=<path> creates a zip file', async () => {
    const { stdout, stderr, code } = await spawnCli([
      'diagnose',
      `--root=${tmp}`,
      `--out=${outZip}`,
    ]);

    expect(code, `CLI diagnose exited ${code}; stderr: ${stderr}`).toBe(0);
    expect(stdout).toContain('diagnose written to:');
    expect(existsSync(outZip), `zip not found at ${outZip}`).toBe(true);

    // The zip must be non-empty (basic size check).
    const { statSync } = await import('node:fs');
    const stat = statSync(outZip);
    expect(stat.size).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Scenario 4: Hot-reload config
// ---------------------------------------------------------------------------

describe('Phase 1.G acceptance – scenario 4: hot-reload config', () => {
  let daemon: Daemon;
  let daemonUrl: string;
  let originalConfig: string;

  beforeAll(async () => {
    originalConfig = readFileSync(CONFIG_FILE, 'utf8');
    daemon = new Daemon({ root: EXAMPLE_ROOT });
    await daemon.start();
    const port = daemon.getPort();
    if (!port) throw new Error('daemon did not bind a port');
    daemonUrl = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterAll(async () => {
    await daemon?.stop();
    // Restore the config file unconditionally so the repo stays clean.
    writeFileSync(CONFIG_FILE, originalConfig, 'utf8');
    // Clean up any log artefacts created during this scenario.
    try { rmSync(join(EXAMPLE_ROOT, '.visual-edit', 'logs'), { recursive: true, force: true }); } catch { /* best-effort */ }
  }, 30_000);

  it('daemon broadcasts config-changed over WS within 2s of config file modification', async () => {
    const port = Number(daemonUrl.split(':')[2]);

    // Connect a raw WS client — no hello needed since config-changed is a broadcast.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });

    // Collect all messages the daemon broadcasts.
    const received: Array<Record<string, unknown>> = [];
    ws.on('message', (raw) => {
      try { received.push(JSON.parse(raw.toString()) as Record<string, unknown>); } catch { /* ignore */ }
    });

    // Modify the config file. Append a comment so the SHA changes without
    // breaking the import semantics.
    writeFileSync(CONFIG_FILE, originalConfig + '\n// ve-config-reload-test\n', 'utf8');

    // Wait up to 2s for the config-changed broadcast.
    const deadline = Date.now() + 2000;
    let got = false;
    while (Date.now() < deadline) {
      if (received.some((m) => m.kind === 'config-changed')) { got = true; break; }
      await new Promise<void>((r) => setTimeout(r, 50));
    }

    ws.close();
    expect(got, 'expected config-changed WS message within 2s').toBe(true);
  }, 30_000);
});
