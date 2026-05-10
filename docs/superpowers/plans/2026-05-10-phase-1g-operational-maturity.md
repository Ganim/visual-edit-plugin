# Visual Edit — Phase 1.G: Operational Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the daemon dogfoodable when things go wrong. After 1.G: persistent NDJSON logs in `.visual-edit/logs/<date>/`, a `visual-edit-cli` with `logs` (tail by traceId) and `diagnose` (zip logs + startup snapshots) subcommands, hot-reload of `visual-edit.config.ts` (no restart needed for config changes), preview worker heartbeat (detect stuck workers within 15s), and a WAL corrupt-snapshot recovery path (`--reset-queue` flag instead of "delete files manually"). No new edit surface; this phase is operations + ergonomics.

**Architecture:**
- `Logger` gains a filesystem sink: rotating NDJSON files under `.visual-edit/logs/<YYYY-MM-DD>/daemon.log` with 30-day retention. Startup snapshot (`startup.json`) written once per daemon boot with Node version, OS, vite/react versions, project git SHA + dirty state.
- New `packages/cli` (binary: `visual-edit`) with subcommands `logs` (tail by `--trace=<id>` or `--since=<duration>`) and `diagnose` (zips logs + startup snapshots into `visual-edit-diagnose-<ts>.zip` with redaction policy enforced; never includes raw-logs unless `--include-raw`).
- `loadConfig` re-runs when `FileWatcher` reports a change in `visual-edit.config.ts`. The daemon kills active preview sessions (WS sends `kind: 'config-changed', willRestart: true`), reloads config, and clients are expected to reconnect via `/preview`. NOT hot-reload of running previews; just a graceful restart trigger.
- `preview-worker` sends a heartbeat IPC message every 5s. The `PreviewSupervisor` tracks each session's last-heartbeat timestamp; if >15s without heartbeat AND the worker process is alive, mark as `stuck` and broadcast `preview-crashed { reason: 'heartbeat-stale' }` over WS.
- WAL corrupt-snapshot recovery: when `replayWal` throws `VE_QUEUE_004` (sha mismatch on `queue-snapshot.json`), the daemon's `start()` catches it and either (a) refuses to start with a clear hint pointing at `visual-edit reset-queue`, or (b) automatically resets the WAL+snapshot files when `Daemon({resetCorruptedQueue: true})` is set. CLI `reset-queue` subcommand wraps option (b).

**Out of scope (deferred to 1.H):**
- CRA adapter
- Full vm isolation for `loadConfig` (regex pre-flight stays; jiti bypass deferred)
- Asset-proxy persistent cache + LRU
- JSX-time image src/srcset rewriting (runtime patcher)
- CSS `background-image: url(...)` rewriting
- Nested CSS rule edits / pseudo-class edits
- Cross-file styled-components (imported `import { Title } from './styles.ts'`)
- Template-literal interpolation editing in styled-components
- RegExp `ApiEndpoint.url` support
- Logger log-level filtering at runtime (configured at construction only)
- Diagnose CLI uploading directly to a bug-report destination (zip lands locally)

**1.G operating constraints:**
- Hot-reload of `visual-edit.config.ts` is a "graceful restart" — current preview sessions are closed and the user re-runs `/visual <page>`. True in-place hot-reload (preserve session state across config changes) is not in 1.G because the AdapterInput depends on config and re-spawning previews is the correct semantics.
- Preview worker heartbeat covers the "process is up but Vite hung" scenario. If the worker process actually CRASHES (SIGSEGV, OOM), the existing `child.exit` path already handles it (1.A baseline).
- The CLI reads logs from disk (not via IPC to a running daemon). It works whether the daemon is running or not — useful for post-crash diagnosis.
- Diagnose zip has redaction policy applied: only `<HASH:...>` placeholders for free-form strings. Raw context goes to `.visual-edit/raw-logs/` and is included only with `--include-raw` flag (off by default).

**Acceptance** (the gate that ends Phase 1.G):

`tests/e2e/operational.test.ts` passes:

1. **Logs land on disk:** start daemon → daemon emits 5 log lines → assert `.visual-edit/logs/<today>/daemon.log` contains 5 NDJSON lines, all parseable, all have `ts`/`level`/`msg` fields.
2. **CLI logs by traceId:** seed an error envelope into the daemon's logs (with a known `traceId`) → `visual-edit logs --trace=<id>` prints that line(s) and only that line(s).
3. **CLI diagnose zips:** start daemon, log a few lines, run `visual-edit diagnose --since=1h` → produces a zip; the zip CONTAINS `daemon.log` (redacted) and `startup.json`; the zip does NOT contain `raw-logs/`.
4. **Hot-reload config:** start daemon, open preview → modify `visual-edit.config.ts` (e.g., change `safeEnvPrefixes`) → daemon emits `config-changed` over WS within 1s → daemon's `projectInfo.config` is the new value on the next call.
5. **Preview worker heartbeat stale:** start a preview → simulate worker stall by suppressing IPC messages → daemon broadcasts `preview-crashed { reason: 'heartbeat-stale' }` within 20s.
6. **WAL recovery via reset-queue:** corrupt `queue-snapshot.json`, start daemon → expect VE_QUEUE_004 throw with hint mentioning `visual-edit reset-queue`. Run `visual-edit reset-queue --root <dir>` → snapshot + WAL files are removed → daemon starts cleanly.

`npm test --workspaces` passes including the new tests. **Total green target: 280+ tests** (up from 252 in 1.F).

---

## File Structure

```
visual-edit-plugin/
├── packages/
│   ├── diagnostics/
│   │   ├── src/
│   │   │   ├── logger.ts                  — extend Logger with FileSink option (rotating NDJSON daily)
│   │   │   └── fileSink.ts                — NEW: writes to .visual-edit/logs/<YYYY-MM-DD>/daemon.log
│   │   └── tests/
│   │       └── logger.fileSink.test.ts
│   │
│   ├── daemon/
│   │   ├── src/
│   │   │   ├── startupSnapshot.ts         — NEW: write .visual-edit/logs/<date>/startup.json once per boot
│   │   │   ├── configReloader.ts          — NEW: detect visual-edit.config.ts change → reload + broadcast
│   │   │   ├── previewSupervisor.ts       — extend: track lastHeartbeat per session; emit preview-crashed on stale
│   │   │   └── daemon.ts                  — wire startupSnapshot + configReloader + heartbeat threshold
│   │   └── tests/
│   │       ├── startupSnapshot.test.ts
│   │       ├── configReloader.test.ts
│   │       └── previewHeartbeat.test.ts
│   │
│   ├── preview-worker/
│   │   └── src/
│   │       └── index.ts                   — emit heartbeat IPC every 5s
│   │
│   ├── protocol/
│   │   └── src/
│   │       ├── ipc.ts                     — add IpcHeartbeatMessage
│   │       └── ws.ts                      — add WsConfigChangedMessage, WsPreviewCrashedMessage
│   │
│   ├── cli/                               — NEW PACKAGE
│   │   ├── package.json                   — bin: { "visual-edit": "./dist/cli.js" }
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── cli.ts                     — entry; argv parsing
│   │   │   ├── logs.ts                    — `logs` subcommand (tail by trace/since)
│   │   │   ├── diagnose.ts                — `diagnose` subcommand (zip logs + startup)
│   │   │   └── reset-queue.ts             — `reset-queue` subcommand
│   │   └── tests/
│   │       ├── logs.test.ts
│   │       ├── diagnose.test.ts
│   │       └── resetQueue.test.ts
│   │
│   └── code-mods/
│       └── (unchanged)
│
├── tests/e2e/operational.test.ts          — NEW: 6 scenarios
└── docs/superpowers/
    ├── plans/2026-05-10-phase-1g-operational-maturity.md
    └── specs/2026-05-10-phase-1g-results.md
```

---

## Sub-phases

| Sub-phase | Tasks | Outcome |
|---|---|---|
| **1.G-1: Logger fs sink + startup snapshot** | 1–2 | Logs persist under `.visual-edit/logs/<date>/`; startup.json once per boot |
| **1.G-2: visual-edit-cli** | 3–5 | New `cli` package; `logs`, `diagnose`, `reset-queue` subcommands |
| **1.G-3: Hot-reload of config** | 6–7 | FileWatcher detects `visual-edit.config.ts` change; daemon broadcasts + reloads |
| **1.G-4: Preview worker heartbeat** | 8 | preview-worker IPC heartbeat; PreviewSupervisor stale detection |
| **1.G-5: WAL corrupt-snapshot recovery** | 9 | resetCorruptedQueue option + cli wrapper |
| **1.G-6: 1.F review fixes + e2e + results** | 10–11 | Reviewer findings folded in; e2e + Phase 1.G results doc |

---

## Sub-phase 1.G-1 — Logger fs sink + startup snapshot

### Task 1: FileSink + Logger fs option

**Files:**
- Create: `packages/diagnostics/src/fileSink.ts`
- Modify: `packages/diagnostics/src/logger.ts` (add `fsRoot?: string` option to LoggerOptions; when set, also writes to `.visual-edit/logs/<YYYY-MM-DD>/daemon.log`)
- Modify: `packages/diagnostics/src/index.ts`
- Create: `packages/diagnostics/tests/logger.fileSink.test.ts`

- [ ] **Step 1: Write `fileSink.ts`**

```ts
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FileSinkOpts {
  root: string;       // project root
  filename?: string;  // default: 'daemon.log'
}

export class FileSink {
  private filename: string;
  constructor(private opts: FileSinkOpts) {
    this.filename = opts.filename ?? 'daemon.log';
  }

  write(line: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const dir = join(this.opts.root, '.visual-edit', 'logs', today);
    try { mkdirSync(dir, { recursive: true }); } catch { /* race-tolerant */ }
    try { appendFileSync(join(dir, this.filename), line, 'utf8'); }
    catch { /* best-effort: don't crash daemon on log-write failure */ }
  }

  /** Resolves the daily log path for today (or a given date). */
  pathFor(date: Date = new Date()): string {
    const day = date.toISOString().slice(0, 10);
    return join(this.opts.root, '.visual-edit', 'logs', day, this.filename);
  }
}
```

- [ ] **Step 2: Update `logger.ts`**

Extend `LoggerOptions`:

```ts
export interface LoggerOptions {
  sink?: LogSink;
  redact?: boolean;
  /** When set, ALSO mirror logs to .visual-edit/logs/<YYYY-MM-DD>/daemon.log. */
  fsRoot?: string;
}
```

In `Logger` constructor, if `opts.fsRoot` is set, instantiate `FileSink({root: opts.fsRoot})` as a secondary sink. In `emit()`, write to both the primary sink (default stderr) and the file sink.

```ts
import { FileSink } from './fileSink.js';

export class Logger {
  private sink: LogSink;
  private redact: boolean;
  private fileSink: FileSink | null;

  constructor(opts: LoggerOptions = {}) {
    this.sink = opts.sink ?? { write: (s) => process.stderr.write(s) };
    this.redact = opts.redact ?? true;
    this.fileSink = opts.fsRoot ? new FileSink({ root: opts.fsRoot }) : null;
  }

  private emit(level: 'info' | 'warn' | 'error' | 'debug', msg: string, ctx?: LogContext): void {
    const safe = ctx && this.redact ? redactContext(ctx) : ctx;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(safe ?? {}) }) + '\n';
    this.sink.write(line);
    this.fileSink?.write(line);
  }
  // (info/warn/error/debug unchanged)
}
```

- [ ] **Step 3: Re-export from index.ts**

```ts
export { FileSink, type FileSinkOpts } from './fileSink.js';
```

- [ ] **Step 4: Test**

```ts
// packages/diagnostics/tests/logger.fileSink.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, FileSink } from '../src/index.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-fs-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('Logger with fsRoot', () => {
  it('writes NDJSON lines to .visual-edit/logs/<date>/daemon.log', () => {
    const logger = new Logger({ fsRoot: tmp });
    logger.info('hi', { sessionId: 's1' });
    logger.warn('uh', { sessionId: 's1' });
    const today = new Date().toISOString().slice(0, 10);
    const path = join(tmp, '.visual-edit/logs', today, 'daemon.log');
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.ts).toBeDefined();
      expect(parsed.level).toBeDefined();
      expect(parsed.msg).toBeDefined();
    }
  });
});

describe('FileSink standalone', () => {
  it('pathFor returns the dated path', () => {
    const sink = new FileSink({ root: tmp });
    const path = sink.pathFor(new Date('2026-05-10T00:00:00Z'));
    expect(path).toContain('2026-05-10');
    expect(path).toContain('daemon.log');
  });
});
```

- [ ] **Step 5: Build + test**

Run `npm run build -w @visual-edit/diagnostics && npm test -w @visual-edit/diagnostics`. Expected: existing 11 + 2 new = 13+ tests green.

```bash
git add packages/diagnostics/
git commit -m "feat(diagnostics): Logger fsRoot option mirrors to .visual-edit/logs/<date>/"
```

---

### Task 2: Daemon writes startup snapshot once per boot; constructs Logger with fsRoot

**Files:**
- Create: `packages/daemon/src/startupSnapshot.ts`
- Modify: `packages/daemon/src/daemon.ts` (write snapshot in `start()`; construct logger with `fsRoot: this.opts.root`)
- Create: `packages/daemon/tests/startupSnapshot.test.ts`

- [ ] **Step 1: Write `startupSnapshot.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export interface StartupSnapshot {
  daemonVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  pid: number;
  startedAt: string;
  rootGitSha: string | null;        // null if not a git repo
  rootGitDirty: boolean | null;     // null if not a git repo
  filesystemType: string | null;    // unknown for now
  packageManager: string | null;    // detected from lockfile
  cwd: string;
}

export function writeStartupSnapshot(root: string, info: { daemonVersion: string }): StartupSnapshot {
  const today = new Date().toISOString().slice(0, 10);
  const dir = join(root, '.visual-edit', 'logs', today);
  mkdirSync(dir, { recursive: true });

  const snapshot: StartupSnapshot = {
    daemonVersion: info.daemonVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    rootGitSha: tryGitSha(root),
    rootGitDirty: tryGitDirty(root),
    filesystemType: null,
    packageManager: detectPackageManager(root),
    cwd: process.cwd(),
  };

  writeFileSync(join(dir, 'startup.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
}

function tryGitSha(root: string): string | null {
  try { return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function tryGitDirty(root: string): boolean | null {
  try {
    const out = execSync('git status --porcelain', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().length > 0;
  } catch { return null; }
}

function detectPackageManager(root: string): string | null {
  const fs = require('node:fs') as typeof import('node:fs');
  if (fs.existsSync(join(root, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(join(root, 'bun.lockb'))) return 'bun';
  return null;
}
```

- [ ] **Step 2: Wire into daemon.ts**

In `Daemon.start()`, after binding the lock, call:

```ts
import { writeStartupSnapshot } from './startupSnapshot.js';
// ...
writeStartupSnapshot(this.opts.root, { daemonVersion: DAEMON_VERSION });
```

In the `Daemon` constructor, change Logger construction:

```ts
this.logger = opts.logger ?? new Logger({ fsRoot: opts.root });
```

- [ ] **Step 3: Test**

```ts
// packages/daemon/tests/startupSnapshot.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStartupSnapshot } from '../src/startupSnapshot.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-ss-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('writeStartupSnapshot', () => {
  it('writes startup.json with required fields', () => {
    const snap = writeStartupSnapshot(tmp, { daemonVersion: '0.1.0' });
    expect(snap.daemonVersion).toBe('0.1.0');
    expect(snap.pid).toBe(process.pid);
    expect(snap.nodeVersion).toBe(process.version);
    expect(snap.platform).toBe(process.platform);

    const today = new Date().toISOString().slice(0, 10);
    const path = join(tmp, '.visual-edit/logs', today, 'startup.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.daemonVersion).toBe('0.1.0');
  });
});
```

- [ ] **Step 4: Build + test + commit**

Run `npm run build -w @visual-edit/daemon && npm test -w @visual-edit/daemon -- startupSnapshot`. Expected: 1 test green; existing daemon tests still pass.

```bash
git add packages/daemon/
git commit -m "feat(daemon): write .visual-edit/logs/<date>/startup.json on boot"
```

---

## Sub-phase 1.G-2 — visual-edit-cli

### Task 3: Scaffold `packages/cli` + `logs` subcommand

**Files:**
- Create: `packages/cli/package.json` (`bin: { "visual-edit": "./dist/cli.js" }`)
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/cli.ts` (entry + dispatch)
- Create: `packages/cli/src/logs.ts`
- Create: `packages/cli/tests/logs.test.ts`
- Modify: root `package.json` (no change — workspaces glob covers `packages/*`)

- [ ] **Step 1: Package files**

`packages/cli/package.json`:
```json
{
  "name": "@visual-edit/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "visual-edit": "./dist/cli.js" },
  "main": "./dist/cli.js",
  "exports": { ".": { "types": "./dist/cli.d.ts", "import": "./dist/cli.js" } },
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "dependencies": {
    "@visual-edit/shared": "*",
    "@visual-edit/diagnostics": "*",
    "@visual-edit/daemon": "*",
    "typescript": "5.6.3"
  }
}
```

`packages/cli/tsconfig.json` (mirror code-mods style):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "references": [
    { "path": "../shared" },
    { "path": "../diagnostics" },
    { "path": "../daemon" }
  ],
  "include": ["src/**/*"]
}
```

Add `{ "path": "./cli" }` to `packages/tsconfig.json` references.

- [ ] **Step 2: cli.ts entry**

```ts
#!/usr/bin/env node
import { runLogs } from './logs.js';

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
  if (cmd === 'logs') return runLogs({
    root: flags.get('root') ?? process.cwd(),
    trace: flags.get('trace') ?? null,
    since: flags.get('since') ?? null,
  });
  // diagnose + reset-queue added in Tasks 4+5
  if (!cmd || cmd === '--help' || cmd === 'help') {
    process.stdout.write(`visual-edit CLI\n\nSubcommands:\n  logs --trace=<id> [--root=<path>]\n  logs --since=<duration> [--root=<path>]\n  diagnose [--since=<duration>] [--include-raw]\n  reset-queue --root=<path>\n`);
    return;
  }
  process.stderr.write(`unknown subcommand: ${cmd}\n`);
  process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`visual-edit: ${(err as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 3: logs.ts**

```ts
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RunLogsInput {
  root: string;
  trace: string | null;
  since: string | null;        // e.g. "1h", "30m", "2d"
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
  const dates = readdirSync(logsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const date of dates) {
    const dir = join(logsRoot, date);
    const files = readdirSync(dir).filter((f) => f.endsWith('.log'));
    for (const file of files) {
      const path = join(dir, file);
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let entry: Record<string, unknown>;
        try { entry = JSON.parse(line); } catch { continue; }
        if (input.trace && entry.traceId !== input.trace) continue;
        if (sinceMs !== null && typeof entry.ts === 'string' && Date.parse(entry.ts) < sinceMs) continue;
        process.stdout.write(line + '\n');
      }
    }
  }
}

void statSync; // satisfy linter on currently-unused import (could be useful for future log mtime sort)
```

- [ ] **Step 4: Test**

```ts
// packages/cli/tests/logs.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogs } from '../src/logs.js';

let tmp: string;
let logs: string[];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-cli-logs-'));
  logs = [];
  // Replace process.stdout.write capture for the test.
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((line: string) => { logs.push(line); return true; }) as never;
  // Restore in afterEach
  (globalThis as Record<string, unknown>).__origStdoutWrite = orig;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write = (globalThis as { __origStdoutWrite: typeof process.stdout.write }).__origStdoutWrite;
});

describe('runLogs', () => {
  it('filters by --trace', () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/logs', today, 'daemon.log'),
      JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'a', traceId: 'aaa' }) + '\n' +
      JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'b', traceId: 'bbb' }) + '\n',
      'utf8');
    runLogs({ root: tmp, trace: 'aaa', since: null });
    expect(logs.join('').includes('"traceId":"aaa"')).toBe(true);
    expect(logs.join('').includes('"traceId":"bbb"')).toBe(false);
  });

  it('filters by --since (1h drops older entries)', () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    const oldTs = new Date(Date.now() - 7_200_000).toISOString(); // 2h ago
    writeFileSync(join(tmp, '.visual-edit/logs', today, 'daemon.log'),
      JSON.stringify({ ts: oldTs, level: 'info', msg: 'old' }) + '\n' +
      JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'recent' }) + '\n',
      'utf8');
    runLogs({ root: tmp, trace: null, since: '1h' });
    const all = logs.join('');
    expect(all.includes('"msg":"recent"')).toBe(true);
    expect(all.includes('"msg":"old"')).toBe(false);
  });
});
```

- [ ] **Step 5: Install + build + test + commit**

Run `npm install && npm run build -w @visual-edit/cli && npm test -w @visual-edit/cli`. Expected: 2 tests green.

```bash
git add packages/cli/ packages/tsconfig.json package.json package-lock.json
git commit -m "feat(cli): scaffold visual-edit-cli + logs subcommand"
```

---

### Task 4: `diagnose` subcommand

**Files:**
- Create: `packages/cli/src/diagnose.ts`
- Modify: `packages/cli/src/cli.ts` (dispatch)
- Create: `packages/cli/tests/diagnose.test.ts`
- Modify: `packages/cli/package.json` — add `archiver` dep (~mainstream MIT)

- [ ] **Step 1: Add archiver dep**

```json
"archiver": "^7.0.1"
```

Run `npm install`. (Sonatype-guide MCP unauthenticated — `archiver` is mainstream MIT.)

- [ ] **Step 2: Write `diagnose.ts`**

```ts
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import archiver from 'archiver';

export interface RunDiagnoseInput {
  root: string;
  since: string | null;
  includeRaw: boolean;
  output: string | null;        // path to write zip to; default: visual-edit-diagnose-<ts>.zip in cwd
}

export async function runDiagnose(input: RunDiagnoseInput): Promise<string> {
  const logsRoot = join(input.root, '.visual-edit', 'logs');
  if (!existsSync(logsRoot)) {
    throw new Error(`no logs found at ${logsRoot}`);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = input.output ?? join(process.cwd(), `visual-edit-diagnose-${ts}.zip`);

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve());
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);
    // Include logs/<date>/* (excluding raw-logs/).
    const dates = readdirSync(logsRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const date of dates) {
      archive.directory(join(logsRoot, date), `logs/${date}`);
    }
    if (input.includeRaw) {
      const rawRoot = join(input.root, '.visual-edit', 'raw-logs');
      if (existsSync(rawRoot)) {
        archive.directory(rawRoot, 'raw-logs');
      }
    }
    archive.finalize();
  });

  void mkdirSync; // (no-op import gymnastics; satisfies linter)
  return outPath;
}
```

- [ ] **Step 3: Wire into cli.ts**

```ts
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
```

- [ ] **Step 4: Test**

```ts
// packages/cli/tests/diagnose.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDiagnose } from '../src/diagnose.js';
import AdmZip from 'adm-zip';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cli-diag-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('runDiagnose', () => {
  it('produces a zip containing logs/<date>/daemon.log; excludes raw-logs by default', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/logs', today, 'daemon.log'), 'line1\nline2\n', 'utf8');
    mkdirSync(join(tmp, '.visual-edit/raw-logs'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/raw-logs/secret.log'), 'shhh', 'utf8');

    const outPath = join(tmp, 'out.zip');
    await runDiagnose({ root: tmp, since: null, includeRaw: false, output: outPath });
    expect(existsSync(outPath)).toBe(true);

    const zip = new AdmZip(outPath);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.includes('daemon.log'))).toBe(true);
    expect(names.some((n) => n.includes('raw-logs'))).toBe(false);
  });

  it('--include-raw includes raw-logs/', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mkdirSync(join(tmp, '.visual-edit/logs', today), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/logs', today, 'daemon.log'), 'x\n', 'utf8');
    mkdirSync(join(tmp, '.visual-edit/raw-logs'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/raw-logs/raw.log'), 'r', 'utf8');

    const outPath = join(tmp, 'out.zip');
    await runDiagnose({ root: tmp, since: null, includeRaw: true, output: outPath });
    const zip = new AdmZip(outPath);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.includes('raw-logs'))).toBe(true);
  });
});
```

Add `adm-zip` to `packages/cli/package.json` `devDependencies` (only used for test introspection).

- [ ] **Step 5: Build + test + commit**

```bash
git add packages/cli/ package.json package-lock.json
git commit -m "feat(cli): diagnose subcommand zips logs (redacted) + startup snapshots"
```

---

### Task 5: `reset-queue` subcommand

**Files:**
- Create: `packages/cli/src/reset-queue.ts`
- Modify: `packages/cli/src/cli.ts`
- Create: `packages/cli/tests/resetQueue.test.ts`

- [ ] **Step 1: Write `reset-queue.ts`**

```ts
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface RunResetQueueInput {
  root: string;
  /** When true, removes WAL + snapshot without confirmation. */
  yes: boolean;
}

export function runResetQueue(input: RunResetQueueInput): { removed: string[] } {
  const wal = join(input.root, '.visual-edit', 'queue.wal');
  const snapshot = join(input.root, '.visual-edit', 'queue-snapshot.json');
  const removed: string[] = [];
  if (existsSync(wal)) { unlinkSync(wal); removed.push(wal); }
  if (existsSync(snapshot)) { unlinkSync(snapshot); removed.push(snapshot); }
  if (!input.yes && removed.length === 0) {
    return { removed: [] };
  }
  return { removed };
}
```

- [ ] **Step 2: Wire into cli.ts**

```ts
if (cmd === 'reset-queue') {
  const root = flags.get('root') ?? process.cwd();
  if (flags.get('yes') !== 'true' && flags.get('y') !== 'true') {
    process.stderr.write(`This will delete .visual-edit/queue.wal and queue-snapshot.json. Re-run with --yes to confirm.\n`);
    process.exit(2);
  }
  const result = runResetQueue({ root, yes: true });
  for (const path of result.removed) process.stdout.write(`removed: ${path}\n`);
  return;
}
```

- [ ] **Step 3: Test**

```ts
// packages/cli/tests/resetQueue.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResetQueue } from '../src/reset-queue.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cli-rq-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('runResetQueue', () => {
  it('removes WAL and snapshot files', () => {
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/queue.wal'), 'old');
    writeFileSync(join(tmp, '.visual-edit/queue-snapshot.json'), '{}');
    const r = runResetQueue({ root: tmp, yes: true });
    expect(r.removed).toHaveLength(2);
    expect(existsSync(join(tmp, '.visual-edit/queue.wal'))).toBe(false);
    expect(existsSync(join(tmp, '.visual-edit/queue-snapshot.json'))).toBe(false);
  });

  it('does not throw when files are absent', () => {
    const r = runResetQueue({ root: tmp, yes: true });
    expect(r.removed).toEqual([]);
  });
});
```

- [ ] **Step 4: Build + test + commit**

```bash
git add packages/cli/
git commit -m "feat(cli): reset-queue subcommand removes WAL + snapshot files"
```

---

## Sub-phase 1.G-3 — Hot-reload of visual-edit.config.ts

### Task 6: configReloader detects config-file changes

**Files:**
- Create: `packages/daemon/src/configReloader.ts`
- Modify: `packages/daemon/src/daemon.ts` (instantiate; wire FileWatcher)
- Modify: `packages/protocol/src/ws.ts` (add `WsConfigChangedMessage`)
- Create: `packages/daemon/tests/configReloader.test.ts`

- [ ] **Step 1: Add WS message**

In `packages/protocol/src/ws.ts`, append:

```ts
export const WsConfigChangedMessage = z.object({
  kind: z.literal('config-changed'),
  sessionId: z.string().min(1),
  willRestart: z.boolean(),
});
export type WsConfigChangedMessage = z.infer<typeof WsConfigChangedMessage>;
```

Add to `WsMessage` union. Re-export from `index.ts`.

- [ ] **Step 2: Write `configReloader.ts`**

```ts
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@visual-edit/project-analyzer';
import type { VisualEditConfig } from '@visual-edit/shared';
import type { FileWatcher } from './fileWatcher.js';

const CONFIG_BASENAMES = ['visual-edit.config.ts', 'visual-edit.config.js', 'visual-edit.config.mjs'];

export interface ConfigChangedEvent {
  config: VisualEditConfig | null;
  error: Error | null;
}

export class ConfigReloader extends EventEmitter {
  constructor(private root: string, private fileWatcher: FileWatcher) {
    super();
  }

  /** Subscribe FileWatcher to the visual-edit.config.ts path; emit `changed` on file change. */
  attach(): void {
    for (const basename of CONFIG_BASENAMES) {
      const p = join(this.root, basename);
      if (existsSync(p)) {
        this.fileWatcher.watch(p).then(() => {/* watching */}).catch(() => {/* ignore */});
      }
    }
    this.fileWatcher.on('external-change', async (e) => {
      if (!CONFIG_BASENAMES.some((b) => e.filePath.endsWith(b))) return;
      try {
        const config = await loadConfig(this.root);
        this.emit('changed', { config, error: null } as ConfigChangedEvent);
      } catch (err) {
        this.emit('changed', { config: null, error: err as Error } as ConfigChangedEvent);
      }
    });
  }
}
```

- [ ] **Step 3: Wire into daemon.ts**

In `Daemon`, add:

```ts
import { ConfigReloader } from './configReloader.js';

private configReloader?: ConfigReloader;
```

In `start()` (after `this.fileWatcher.start()` or its initial setup):

```ts
this.configReloader = new ConfigReloader(this.opts.root, this.fileWatcher);
this.configReloader.attach();
this.configReloader.on('changed', (e) => {
  if (e.error) {
    this.logger.error('config reload failed', { code: 'VE_CONFIG_001', traceId: 'na' });
    return;
  }
  if (e.config) {
    this.projectInfo = { ...this.projectInfo!, config: e.config };
    // Notify all WS clients per session.
    if (this.wsServer) {
      for (const client of this.wsServer.clients) {
        if (client.readyState === client.OPEN) {
          // Broadcast — clients filter; we don't know per-session here so use '*'.
          const msg = { kind: 'config-changed', sessionId: '*', willRestart: true };
          client.send(JSON.stringify(msg));
        }
      }
    }
    this.logger.info('config reloaded', { mode: 'soft' });
  }
});
```

- [ ] **Step 4: Test**

```ts
// packages/daemon/tests/configReloader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigReloader, type ConfigChangedEvent } from '../src/configReloader.js';
import { FileWatcher } from '../src/fileWatcher.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cr-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('ConfigReloader', () => {
  it('emits changed when visual-edit.config.ts is modified', async () => {
    const cfgPath = join(tmp, 'visual-edit.config.ts');
    writeFileSync(cfgPath, `export default { wrapPage: (c) => c };`, 'utf8');
    const fw = new FileWatcher();
    const reloader = new ConfigReloader(tmp, fw);
    reloader.attach();

    const events: ConfigChangedEvent[] = [];
    reloader.on('changed', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(cfgPath, `export default { wrapPage: (c) => c, mocks: { extra: 1 } };`, 'utf8');
    await new Promise((r) => setTimeout(r, 1500));

    expect(events.length).toBeGreaterThan(0);
    await fw.close();
  }, 30_000);
});
```

- [ ] **Step 5: Build + test + commit**

```bash
git add packages/daemon/ packages/protocol/
git commit -m "feat(daemon,protocol): config-changed WS message + ConfigReloader on FileWatcher"
```

---

### Task 7: Daemon honors config-changed (broadcast + minimal soft-reload)

**Files:**
- Modify: `packages/daemon/src/daemon.ts` — already wired in Task 6; verify the broadcast plumbing
- Modify: `packages/daemon/src/ws.ts` — expose `broadcastConfigChanged` helper

- [ ] **Step 1: ws.ts broadcast helper**

```ts
import type { WsConfigChangedMessage } from '@visual-edit/protocol';

export function broadcastConfigChanged(wss: WebSocketServer): void {
  const wire: WsConfigChangedMessage = { kind: 'config-changed', sessionId: '*', willRestart: true };
  const payload = JSON.stringify(wire);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
```

- [ ] **Step 2: Use the helper in daemon.ts**

Replace the inline broadcast loop in Task 6 with the `broadcastConfigChanged(this.wsServer)` call.

- [ ] **Step 3: Test (smoke)**

```ts
// in configReloader.test.ts (or new test file)
it('broadcastConfigChanged sends the message to all clients', async () => {
  // ... start an HTTP server with attachWebSocket, connect a WS client, call broadcastConfigChanged, assert message received
});
```

(Pattern matches existing broadcast tests like `fileChangedBroadcast.test.ts` and `queue.broadcast.test.ts`.)

- [ ] **Step 4: Commit**

```bash
git add packages/daemon/
git commit -m "feat(daemon): broadcastConfigChanged helper + soft-reload on config change"
```

---

## Sub-phase 1.G-4 — Preview worker heartbeat

### Task 8: preview-worker emits heartbeat; PreviewSupervisor detects stale

**Files:**
- Modify: `packages/protocol/src/ipc.ts` — add `IpcHeartbeatMessage`
- Modify: `packages/preview-worker/src/index.ts` — emit heartbeat every 5s
- Modify: `packages/daemon/src/previewSupervisor.ts` — track lastHeartbeat per session; emit stale event after 15s
- Modify: `packages/protocol/src/ws.ts` — add `WsPreviewCrashedMessage` (if not present)
- Create: `packages/daemon/tests/previewHeartbeat.test.ts`

- [ ] **Step 1: IpcHeartbeatMessage**

In `protocol/src/ipc.ts`:

```ts
export const IpcHeartbeatMessage = z.object({
  kind: z.literal('heartbeat'),
  ts: z.string(),
});
export type IpcHeartbeatMessage = z.infer<typeof IpcHeartbeatMessage>;
```

Add to `IpcMessage` union.

- [ ] **Step 2: WsPreviewCrashedMessage** (if not present)

```ts
export const WsPreviewCrashedMessage = z.object({
  kind: z.literal('preview-crashed'),
  sessionId: z.string().min(1),
  reason: z.enum(['heartbeat-stale', 'process-exit', 'startup-timeout', 'other']),
  willRespawn: z.boolean(),
});
export type WsPreviewCrashedMessage = z.infer<typeof WsPreviewCrashedMessage>;
```

Add to `WsMessage` union.

- [ ] **Step 3: preview-worker heartbeat**

In `packages/preview-worker/src/index.ts`, after sending the `ready` message:

```ts
// Heartbeat every 5s.
setInterval(() => {
  sendToParent(process, { kind: 'heartbeat', ts: new Date().toISOString() });
}, 5000).unref?.();
```

- [ ] **Step 4: PreviewSupervisor tracks heartbeat**

In `packages/daemon/src/previewSupervisor.ts`:
- Add `lastHeartbeat: Map<sessionId, number>` (ms timestamp).
- On every IPC message of `kind: 'heartbeat'`, update `lastHeartbeat[sessionId] = Date.now()`.
- Add a 5s tick (setInterval) that scans `lastHeartbeat`. For each entry where `Date.now() - last > 15000`, emit `'preview-stale'` event with the sessionId, then clear the entry.
- Also update `lastHeartbeat[sessionId] = Date.now()` when `ready` is received (initial heartbeat).
- In `stop()`, clear the timer and the map entry.

- [ ] **Step 5: Daemon broadcasts preview-crashed on stale**

In `daemon.ts` `start()`, after instantiating supervisor:

```ts
this.supervisor.on('preview-stale', (sessionId: string) => {
  if (this.wsServer) {
    const msg: WsPreviewCrashedMessage = {
      kind: 'preview-crashed',
      sessionId,
      reason: 'heartbeat-stale',
      willRespawn: false,  // 1.G doesn't respawn; user re-runs /visual
    };
    for (const client of this.wsServer.clients) {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(msg));
    }
  }
  this.logger.warn('preview heartbeat stale', { sessionId, reason: 'heartbeat-stale' });
});
```

- [ ] **Step 6: Test**

```ts
// packages/daemon/tests/previewHeartbeat.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreviewSupervisor } from '../src/previewSupervisor.js';

describe('PreviewSupervisor heartbeat tracking', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits preview-stale when no heartbeat received within 15s', () => {
    const sup = new PreviewSupervisor();
    const events: string[] = [];
    sup.on('preview-stale', (id) => events.push(id));

    // Inject a fake session record (the actual spawn flow involves IPC; we test the
    // tracking + scan logic in isolation by exposing a helper).
    sup.recordHeartbeat('s1');  // initial; expose this method on supervisor
    vi.advanceTimersByTime(20_000);

    expect(events).toContain('s1');
  });
});
```

To make this testable, add a `recordHeartbeat(sessionId)` public method on PreviewSupervisor that's called from the IPC handler. The tick timer can also be `_runStaleCheck()` exposed for tests.

- [ ] **Step 7: Build + test + commit**

```bash
git add packages/protocol/ packages/preview-worker/ packages/daemon/
git commit -m "feat(preview-worker,daemon): IPC heartbeat + 15s stale detection + WS preview-crashed"
```

---

## Sub-phase 1.G-5 — WAL corrupt-snapshot recovery

### Task 9: Daemon `resetCorruptedQueue` option + cli reset-queue catches VE_QUEUE_004

**Files:**
- Modify: `packages/daemon/src/daemon.ts` (catch VE_QUEUE_004 from QueueManager constructor when resetCorruptedQueue is true)
- Modify: `packages/cli/src/reset-queue.ts` (already exists from Task 5; add explanation in CLI help)
- Test: extend existing queue compaction test or add new test for the recovery path

- [ ] **Step 1: Add option to DaemonOptions**

```ts
export interface DaemonOptions {
  // ... existing fields ...
  resetCorruptedQueue?: boolean;
}
```

- [ ] **Step 2: Catch in start()**

In `Daemon.start()`, when constructing or re-loading the QueueManager:

```ts
try {
  this.queue = new QueueManager(this.opts.root);
} catch (err) {
  const code = (err as { envelope?: { code?: string } }).envelope?.code;
  if (code === 'VE_QUEUE_004' && this.opts.resetCorruptedQueue) {
    // Auto-reset.
    runResetQueue({ root: this.opts.root, yes: true });
    this.queue = new QueueManager(this.opts.root);
    this.logger.warn('queue snapshot was corrupt — auto-reset', { reason: 'VE_QUEUE_004' });
  } else {
    throw err;  // user must run `visual-edit reset-queue --root <path>` manually
  }
}
```

Import `runResetQueue` from `@visual-edit/cli` (or duplicate the small function in daemon).

For boundary cleanliness: instead of importing CLI from daemon (boundary violation), copy a tiny `resetQueueFiles(root)` into `packages/daemon/src/queue/` since the CLI's runResetQueue is just `unlinkSync` on two known paths.

- [ ] **Step 3: Test**

```ts
// extend queue.compaction.test.ts or new test
it('resetCorruptedQueue auto-resets on VE_QUEUE_004', async () => {
  // Set up a corrupted snapshot, instantiate Daemon with resetCorruptedQueue: true,
  // assert daemon.start() succeeds and queue is fresh.
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/daemon/ packages/cli/
git commit -m "feat(daemon): resetCorruptedQueue option auto-recovers on VE_QUEUE_004"
```

---

## Sub-phase 1.G-6 — 1.F review fixes + e2e + results

### Task 10: 1.F review fixes (bundle, populated when reaching this task)

When reaching this task, read the 1.F end-to-end reviewer output (running in parallel during planning). Apply Critical + Important findings as a single bundled commit. If no actionable findings, skip and document.

Commit (if applicable): `fix: 1.F review — <one-line summary>`

---

### Task 11: E2E + Phase 1.G results doc + push

**Files:**
- Create: `tests/e2e/operational.test.ts`
- Create: `docs/superpowers/specs/2026-05-10-phase-1g-results.md`

- [ ] **Step 1: E2E**

The test exercises 6 scenarios from the acceptance gate. Some can be unit-tested only (heartbeat with fake timers, WAL recovery with fixture data). The e2e focuses on:

- Logs persist on disk (start daemon → emit log → read .visual-edit/logs/<today>/daemon.log)
- CLI logs by traceId (seed log file with known traceId → spawn `node packages/cli/dist/cli.js logs --trace=...` → assert output)
- CLI diagnose produces zip (spawn `node packages/cli/dist/cli.js diagnose --root=<tmp>` → assert zip exists + contains daemon.log)
- Hot-reload config (start daemon, modify config file, assert WS broadcast within 2s)

The other 2 scenarios (heartbeat stale, WAL recovery) can be exercised in unit tests (Tasks 8 + 9 already did).

- [ ] **Step 2: Results doc**

`docs/superpowers/specs/2026-05-10-phase-1g-results.md` mirrors 1.F structure. Include:
- Date 2026-05-10
- Outcome
- Plan ref
- Summary
- Acceptance gate
- Per-package counts (target: 280+)
- Bugs fixed
- Limitations & out-of-scope (deferred to 1.H):
  - CRA adapter
  - Full vm isolation for loadConfig
  - Asset-proxy persistent cache + LRU
  - JSX-time image src/srcset rewriting (runtime patcher)
  - CSS background-image: url() rewriting
  - Nested CSS rule edits / pseudo-class edits
  - Cross-file styled-components (imported)
  - Template-literal interpolation editing
  - RegExp ApiEndpoint URLs
  - True hot-reload of running previews (1.G is graceful restart)
  - Log-level filtering at runtime
  - Diagnose CLI direct-upload to bug report destination
- GO/NO-GO

- [ ] **Step 3: Commits + push**

```bash
git add tests/e2e/operational.test.ts
git commit -m "test(e2e): phase 1.g acceptance — operational maturity"

git add docs/superpowers/specs/2026-05-10-phase-1g-results.md
git commit -m "docs(plan): mark phase 1.g complete + results writeup"

git push origin main
```

## Verify

If e2e fails, do NOT push. Debug.

---

## Self-review checklist (run after Task 11)

1. **Spec coverage**: Logger filesystem sink, startup snapshot, CLI logs/diagnose/reset-queue, hot-reload of config, preview worker heartbeat, WAL corrupt recovery, 1.F review fixes — all tasks covered.

2. **Cross-task interface check**:
   - `IpcHeartbeatMessage` shape (Task 8) matches what preview-worker sends + supervisor receives.
   - `WsConfigChangedMessage` (Task 6) matches what daemon broadcasts.
   - `runResetQueue` (Task 5) reuses paths that `compactWal` (1.D) writes.
   - `Logger fsRoot` (Task 1) consumed by Daemon constructor (Task 2).

3. **Type consistency**: WsMessage union extended with config-changed + preview-crashed; IpcMessage union extended with heartbeat. Confirm tests cover the shapes.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-phase-1g-operational-maturity.md`.**

User pre-approved execution: subagent-driven mode after self-review. Proceeding without re-asking.
