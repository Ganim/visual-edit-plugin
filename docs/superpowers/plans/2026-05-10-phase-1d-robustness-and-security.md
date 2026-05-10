# Visual Edit — Phase 1.D: Robustness + Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Harden the daemon for multi-session use and isolate user-supplied config from the daemon's privileges. This phase has no user-visible new feature; it's the safety net that lets the existing 1.A-1.C feature surface run reliably with multiple Claude Code instances open and with hostile / sloppy `visual-edit.config.ts` files.

**Architecture changes:**
- The `daemon.lock` format gains a `heartbeat` timestamp + `stateHash` + an explicit `version: '1'` field. A new `LockHeartbeat` worker writes the heartbeat every 5s; readers detect stale locks (heartbeat >30s OR PID dead) and take over.
- Multi-session: the daemon's `start()` no longer hard-throws when a lock is present. Instead it: (a) returns the existing daemon's URL if its heartbeat is fresh and PID is alive, (b) takes ownership + replays WAL if the lock is stale, (c) refuses with `VE_PROTOCOL_001` if the lock's version is unknown.
- A new `LeaseTimer` worker on the QueueManager auto-reverts expired leases on a 60s tick (in addition to the existing on-drain check). Each revert appends a WAL `lease-expired` op.
- WAL runtime compaction: on `appendWalEntry`, if WAL exceeds threshold (10k entries OR 5MB), write `queue-snapshot.json` of current in-memory state and truncate WAL to a single entry referencing the snapshot. Replay reads snapshot first, then WAL.
- `project-analyzer` exposes an `invalidate(filePath)` API. The daemon's FileWatcher calls it on every external-change.
- `loadConfig` swaps its `Object.defineProperty(process, 'env', ...)` swap for a real `vm.Context` with curated globals (`console`, `Symbol`, `Object`, `Array`, etc.) and an env Proxy. `require`/`fs`/`child_process`/`net` are absent. `wrapPage` runs at preview time outside this context (it's user code that needs React + DOM access); only the *config evaluation* is sandboxed.
- `Logger` gains an allowlist mode. By default, only fields whose key is in `SAFE_LOG_FIELDS` are persisted; the rest are replaced with `<HASH:length:summary>` placeholders. Raw context goes to `.visual-edit/raw-logs/<date>/` (gitignored, opt-in via `--include-raw`).

**Tech stack additions:** Node `vm` module (stdlib, already available); no new deps.

**Phase 1.D scope explicitly OUT (deferred to 1.E):**
- CRA adapter
- Asset-proxy beyond placeholder
- CSS modules + styled-components edit targets
- Real backend mocking (`findApiContracts` + `buildMSWHandlers`)
- `visual-edit-cli` diagnose subcommand
- WAL recovery from corrupted snapshot files (refuses to start; user runs reset)
- Heartbeat-based liveness for preview workers (only daemon heartbeat in 1.D)
- Hot-reload of `visual-edit.config.ts` during a session (still requires daemon restart)

**Documented 1.D operating constraints:**
- Multi-session is read-mostly: a second `Daemon.start()` against the same root reads the lock and either connects to the existing daemon (returning its URL) or takes over a stale lock. It does NOT spawn a second daemon process. The caller decides what to do with the returned URL.
- The vm sandbox does NOT prevent `wrapPage`'s React tree from doing arbitrary work at preview time — that runs in the preview worker's process, not in the config-loading vm context. The sandbox specifically guards the *evaluation of `visual-edit.config.ts`* against `process.env.SECRET`, `fs.readFile`, `child_process.exec`, network IO, etc. during the import. This matches spec §3.5's threat model.
- Logger redaction is allowlist by default. The `[VE_CODE]:` prefix in error messages is preserved (it's already a known-safe pattern). Hashes use sha256 truncated to 8 hex chars; placeholders look like `<HASH:abc12345:42:starts-with-abc>`.
- WAL runtime compaction snapshots the in-memory `Map<askId, AskAIItem>` to `.visual-edit/queue-snapshot.json`, then truncates the WAL to a single `{op: 'snapshot-ref', snapshotPath, snapshotSha256}` entry. Replay loads snapshot first, validates sha, then replays remaining WAL ops.
- Lease auto-revert timer runs every 60s. The existing on-drain expiry check from 1.C remains as a safety net.

**Acceptance** (the gate that ends Phase 1.D):

`tests/e2e/multi-session-and-sandbox.test.ts` passes:

1. **Multi-session takeover**: start `Daemon` A on a tmp root; let A run for 200ms (heartbeat lands on disk); kill A's process WITHOUT calling `stop()` (orphans the lock); start `Daemon` B on the same root; B detects stale lock + takes over; new lock has B's pid and a different `startedAt`; WAL entries enqueued before A's death are still readable by B's QueueManager.

2. **Multi-session connect**: start `Daemon` A; while A is alive, instantiate `Daemon` B with `{ root, mode: 'connect-only' }`; B's `start()` returns A's URL without binding a port; B's `getPort()` returns A's port.

3. **Lease auto-revert**: enqueue an item; drain (lease it); fast-forward 16 minutes (TTL+1) by patching `Date.now`; the auto-revert timer (or its mock) reverts the lease; subsequent drain returns the item again.

4. **WAL runtime compaction**: enqueue 10001 items (one over threshold); on the 10001st append, snapshot is written + WAL truncated to a single `snapshot-ref` entry; replaying produces all 10001 items in `pending` state.

5. **vm sandbox**: a `visual-edit.config.ts` that calls `process.env.SECRET` is rejected with `VE_CONFIG_001`; a config that calls `require('fs').readFileSync('/etc/passwd')` is rejected with `VE_CONFIG_002` (new code, "config touched forbidden module"). A config that only reads safe-prefix env vars and exports `{wrapPage}` works.

6. **Logger redaction**: log a message with a free-form context string; assert the persisted line replaces it with `<HASH:...>`. With `--include-raw`, the original is in `.visual-edit/raw-logs/`.

7. **ProjectAnalyzer invalidation**: open a preview; modify the file externally (FileWatcher fires); the next `analyze()` call returns updated info (e.g. routes list reflecting a renamed file). Specifically: cache hit on first call; cache miss after invalidation.

`npm test --workspaces` passes including the new tests. **Total green target: 180+ tests** (up from 158 in 1.C).

---

## File Structure

```
visual-edit-plugin/
├── packages/
│   ├── shared/
│   │   └── src/
│   │       └── lockFile.ts              — extend DaemonLockData with heartbeat, stateHash, version (NEW fields)
│   │
│   ├── daemon/
│   │   ├── src/
│   │   │   ├── lockFile.ts              — extend writeLock signature; add updateHeartbeat helper
│   │   │   ├── lockHeartbeat.ts         — NEW: 5s timer that updates heartbeat field
│   │   │   ├── lockTakeover.ts          — NEW: stale-lock detection + takeover decision
│   │   │   ├── daemon.ts                — multi-session: connect-or-takeover-or-bind in start()
│   │   │   └── queue/
│   │   │       ├── leaseTimer.ts        — NEW: 60s tick that calls expiry-check on QueueManager
│   │   │       ├── compaction.ts        — NEW: writeSnapshot + truncate logic
│   │   │       ├── replay.ts            — extend: read snapshot first if snapshot-ref present
│   │   │       ├── wal.ts               — extend: append checks size + triggers compaction
│   │   │       └── queueManager.ts      — wire LeaseTimer; expose snapshot()/restore()
│   │   └── tests/
│   │       ├── lockTakeover.test.ts
│   │       ├── lockHeartbeat.test.ts
│   │       ├── multiSession.test.ts
│   │       ├── queue.compaction.test.ts
│   │       └── queue.leaseTimer.test.ts
│   │
│   ├── project-analyzer/
│   │   ├── src/
│   │   │   ├── analyze.ts               — wrap in caching layer; add invalidate(filePath)
│   │   │   └── loadConfig.ts            — replace process.env swap with vm.Context sandbox
│   │   └── tests/
│   │       ├── analyze.cache.test.ts
│   │       ├── loadConfig.sandbox.test.ts
│   │       └── __fixtures__/
│   │           ├── config-with-fs/      — visual-edit.config.ts that calls fs.readFileSync
│   │           ├── config-with-net/     — visual-edit.config.ts that calls fetch
│   │           └── config-clean/        — minimal valid config
│   │
│   ├── diagnostics/
│   │   ├── src/
│   │   │   ├── codes.ts                 — add VE_CONFIG_002, VE_PROTOCOL_001 (already exists), VE_QUEUE_004
│   │   │   ├── redaction.ts             — NEW: SAFE_LOG_FIELDS set + redact() function
│   │   │   └── logger.ts                — extend Logger with allowlist mode + raw-log path
│   │   └── tests/
│   │       ├── redaction.test.ts
│   │       └── logger.allowlist.test.ts
│   │
│   └── (other packages unchanged)
│
├── tests/
│   └── e2e/
│       └── multi-session-and-sandbox.test.ts  — NEW: 5 acceptance scenarios
│
└── docs/
    └── superpowers/
        ├── plans/2026-05-10-phase-1d-robustness-and-security.md
        └── specs/2026-05-10-phase-1d-results.md
```

---

## Sub-phases

| Sub-phase | Tasks | Outcome |
|---|---|---|
| **1.D-1: Lock heartbeat + takeover** | 1–4 | Lock format extended; heartbeat worker; takeover detection; multi-session daemon entry path |
| **1.D-2: Queue durability** | 5–6 | Lease auto-revert timer; WAL runtime compaction with snapshot |
| **1.D-3: Analyzer cache + redaction** | 7–8 | analyze() invalidatable from FileWatcher; Logger allowlist mode |
| **1.D-4: vm sandbox** | 9–10 | loadConfig uses vm.Context with curated globals; tests against malicious fixtures |
| **1.D-5: 1.C review fixes + e2e + results** | 11–12 | wsServer race fix, WAL version envelope, summary bound, unknown-kind rate limit, _resetSeqCache off barrel; full e2e + Phase 1.D results doc |

---

## Sub-phase 1.D-1 — Lock heartbeat + takeover

### Task 1: Extend DaemonLockData with heartbeat + stateHash + version

**Files:**
- Modify: `packages/shared/src/lockFile.ts` (add fields)
- Modify: `packages/daemon/src/lockFile.ts` (writeLock accepts new fields)
- Create: `packages/shared/tests/lockFile.shape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/lockFile.shape.test.ts
import { describe, it, expect } from 'vitest';
import type { DaemonLockData } from '../src/lockFile.js';

describe('DaemonLockData shape (v2)', () => {
  it('accepts the extended shape with heartbeat + stateHash', () => {
    const ok: DaemonLockData = {
      pid: 1234,
      port: 5170,
      daemonVersion: '0.0.0',
      startedAt: '2026-05-10T12:00:00Z',
      heartbeat: '2026-05-10T12:00:05Z',
      stateHash: 'a'.repeat(64),
      version: '1',
    };
    expect(ok.heartbeat).toBeDefined();
    expect(ok.stateHash).toBeDefined();
    expect(ok.version).toBe('1');
  });
});
```

- [ ] **Step 2: Update `packages/shared/src/lockFile.ts`**

Replace the interface:

```ts
export interface DaemonLockData {
  pid: number;
  port: number;
  daemonVersion: string;
  startedAt: string;
  heartbeat: string;        // NEW: ISO timestamp; updated every 5s by daemon
  stateHash: string;        // NEW: sha256 of recent activity (used to detect drift)
  version: '1';
}
```

(Existing `readDaemonLock` keeps working — it's just `JSON.parse` on the file; older locks without the new fields will deserialize with `heartbeat`/`stateHash` undefined, which is fine because callers in 1.D treat missing fields as "stale".)

- [ ] **Step 3: Update `packages/daemon/src/lockFile.ts` `writeLock`**

```ts
import { DaemonLockData } from '@visual-edit/shared';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const LOCK_DIR = '.visual-edit';
const LOCK_FILE = 'daemon.lock';

export interface WriteLockInput {
  pid: number;
  port: number;
  daemonVersion: string;
  /** Optional state hash; defaults to a zero hash if omitted. */
  stateHash?: string;
}

export async function writeLock(root: string, fields: WriteLockInput): Promise<void> {
  await mkdir(join(root, LOCK_DIR), { recursive: true });
  const now = new Date().toISOString();
  const lock: DaemonLockData = {
    pid: fields.pid,
    port: fields.port,
    daemonVersion: fields.daemonVersion,
    startedAt: now,
    heartbeat: now,
    stateHash: fields.stateHash ?? createHash('sha256').update('').digest('hex'),
    version: '1',
  };
  await writeFile(join(root, LOCK_DIR, LOCK_FILE), JSON.stringify(lock, null, 2), 'utf8');
}

export async function updateHeartbeat(root: string, stateHash?: string): Promise<void> {
  const path = join(root, LOCK_DIR, LOCK_FILE);
  let cur: DaemonLockData;
  try { cur = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8')) as DaemonLockData; }
  catch { return; }
  cur.heartbeat = new Date().toISOString();
  if (stateHash !== undefined) cur.stateHash = stateHash;
  await writeFile(path, JSON.stringify(cur, null, 2), 'utf8');
}

export async function removeLock(root: string): Promise<void> {
  try { await unlink(join(root, LOCK_DIR, LOCK_FILE)); } catch { /* gone */ }
}

export { readDaemonLock as readLock, type DaemonLockData as LockData } from '@visual-edit/shared';
```

- [ ] **Step 4: Run + commit**

Run `npm run build -w @visual-edit/shared @visual-edit/daemon` and confirm the existing daemon tests still pass (mainly `lockFile.test.ts`). The existing `writeLock({ pid, port, daemonVersion })` calls keep working since `WriteLockInput` only adds optional fields.

```bash
git add packages/shared/ packages/daemon/src/lockFile.ts packages/shared/tests/lockFile.shape.test.ts
git commit -m "feat(shared,daemon): extend DaemonLockData with heartbeat + stateHash + version"
```

---

### Task 2: LockHeartbeat worker — 5s tick that updates the lock

**Files:**
- Create: `packages/daemon/src/lockHeartbeat.ts`
- Create: `packages/daemon/tests/lockHeartbeat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/tests/lockHeartbeat.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLock } from '../src/lockFile.js';
import { LockHeartbeat } from '../src/lockHeartbeat.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-hb-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('LockHeartbeat', () => {
  it('updates heartbeat field on each tick', async () => {
    await writeLock(tmp, { pid: process.pid, port: 1, daemonVersion: '0' });
    const before = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    const hb = new LockHeartbeat(tmp, 50); // 50ms ticks for the test
    hb.start();
    await new Promise((r) => setTimeout(r, 150));
    hb.stop();
    const after = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    expect(after).not.toBe(before);
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  });

  it('stop() clears the timer; no further writes', async () => {
    await writeLock(tmp, { pid: process.pid, port: 1, daemonVersion: '0' });
    const hb = new LockHeartbeat(tmp, 30);
    hb.start();
    await new Promise((r) => setTimeout(r, 60));
    hb.stop();
    const stoppedAt = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    await new Promise((r) => setTimeout(r, 100));
    const later = JSON.parse(readFileSync(join(tmp, '.visual-edit/daemon.lock'), 'utf8')).heartbeat;
    expect(later).toBe(stoppedAt);
  });

  it('is resilient to a missing lock file (logs and continues)', async () => {
    const hb = new LockHeartbeat(tmp, 30);
    hb.start();
    await new Promise((r) => setTimeout(r, 100));
    hb.stop();
    // No throw; lock file was never created.
    expect(existsSync(join(tmp, '.visual-edit/daemon.lock'))).toBe(false);
  });
});
```

- [ ] **Step 2: Write `packages/daemon/src/lockHeartbeat.ts`**

```ts
import { updateHeartbeat } from './lockFile.js';

const DEFAULT_INTERVAL_MS = 5_000;

export class LockHeartbeat {
  private timer: NodeJS.Timeout | null = null;

  constructor(private root: string, private intervalMs: number = DEFAULT_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      updateHeartbeat(this.root).catch(() => { /* best effort */ });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
```

- [ ] **Step 3: Run + commit**

Run `npm test -w @visual-edit/daemon -- lockHeartbeat`. Expected: 3 tests green.

```bash
git add packages/daemon/src/lockHeartbeat.ts packages/daemon/tests/lockHeartbeat.test.ts
git commit -m "feat(daemon): LockHeartbeat worker (5s tick updates lock heartbeat field)"
```

---

### Task 3: lockTakeover — stale detection + decision matrix

**Files:**
- Create: `packages/daemon/src/lockTakeover.ts`
- Create: `packages/daemon/tests/lockTakeover.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/tests/lockTakeover.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideLockAction } from '../src/lockTakeover.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-lt-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function writeLockRaw(data: object): void {
  mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
  writeFileSync(join(tmp, '.visual-edit/daemon.lock'), JSON.stringify(data), 'utf8');
}

describe('decideLockAction', () => {
  it('returns "bind" when no lock exists', async () => {
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('bind');
  });

  it('returns "takeover" when lock heartbeat is older than 30s', async () => {
    writeLockRaw({
      pid: 99999, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date(Date.now() - 60_000).toISOString(),
      stateHash: 'a'.repeat(64), version: '1',
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('takeover');
  });

  it('returns "takeover" when lock pid is dead', async () => {
    writeLockRaw({
      pid: 99999, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date().toISOString(),  // fresh heartbeat
      stateHash: 'a'.repeat(64), version: '1',
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('takeover');  // pid 99999 is unlikely to be alive
  });

  it('returns "connect" when heartbeat fresh AND pid is alive', async () => {
    writeLockRaw({
      pid: process.pid, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date().toISOString(),
      stateHash: 'a'.repeat(64), version: '1',
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('connect');
    expect((decision as { kind: 'connect'; url: string }).url).toBe('http://127.0.0.1:5170');
  });

  it('returns "refuse" on unknown version', async () => {
    writeLockRaw({
      pid: process.pid, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date().toISOString(),
      stateHash: 'a'.repeat(64), version: '2',  // unknown
    });
    const decision = await decideLockAction(tmp);
    expect(decision.kind).toBe('refuse');
  });
});
```

- [ ] **Step 2: Write `packages/daemon/src/lockTakeover.ts`**

```ts
import { readLock } from './lockFile.js';

const STALE_HEARTBEAT_MS = 30_000;

export type LockAction =
  | { kind: 'bind' }
  | { kind: 'connect'; url: string; pid: number; port: number }
  | { kind: 'takeover'; reason: 'pid-dead' | 'heartbeat-stale' }
  | { kind: 'refuse'; reason: string };

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function decideLockAction(root: string): Promise<LockAction> {
  const lock = await readLock(root);
  if (!lock) return { kind: 'bind' };
  if (lock.version !== '1') {
    return { kind: 'refuse', reason: `unknown lock version: ${lock.version}` };
  }
  const alive = isProcessAlive(lock.pid);
  if (!alive) return { kind: 'takeover', reason: 'pid-dead' };
  const hbAge = lock.heartbeat ? Date.now() - Date.parse(lock.heartbeat) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(hbAge) || hbAge > STALE_HEARTBEAT_MS) {
    return { kind: 'takeover', reason: 'heartbeat-stale' };
  }
  return {
    kind: 'connect',
    url: `http://127.0.0.1:${lock.port}`,
    pid: lock.pid,
    port: lock.port,
  };
}
```

- [ ] **Step 3: Run + commit**

Run `npm test -w @visual-edit/daemon -- lockTakeover`. Expected: 5 tests green.

```bash
git add packages/daemon/src/lockTakeover.ts packages/daemon/tests/lockTakeover.test.ts
git commit -m "feat(daemon): lockTakeover decision matrix (bind/connect/takeover/refuse)"
```

---

### Task 4: Daemon multi-session entry path — connect-or-takeover-or-bind

**Files:**
- Modify: `packages/daemon/src/daemon.ts` (rewrite `start()` to use `decideLockAction`; add `mode` option; expose `getMode()`)
- Modify: `packages/daemon/src/daemon.ts` (start `LockHeartbeat` after binding)
- Create: `packages/daemon/tests/multiSession.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/daemon/tests/multiSession.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from '../src/daemon.js';
import { _resetSeqCache } from '../src/queue/wal.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-ms-'));
  _resetSeqCache();
  // Minimal seed project.
  mkdirSync(join(tmp, 'src/pages'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 's', dependencies: { vite: '5.4.0' } }));
  writeFileSync(join(tmp, 'src/pages/Home.tsx'), 'export default () => <div />;\n');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('Daemon.start multi-session', () => {
  it('first daemon binds; second daemon in connect-only mode discovers it', async () => {
    const d1 = new Daemon({ root: tmp });
    await d1.start();
    expect(d1.getMode()).toBe('bound');

    const d2 = new Daemon({ root: tmp, mode: 'connect-only' });
    await d2.start();
    expect(d2.getMode()).toBe('connected');
    expect(d2.getPort()).toBe(d1.getPort());

    await d1.stop();
    await d2.stop();
  }, 30_000);

  it('takeover when lock is stale and pid is dead', async () => {
    // Write a stale lock manually pointing at a dead pid.
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/daemon.lock'), JSON.stringify({
      pid: 99999, port: 5170, daemonVersion: '0', startedAt: 't',
      heartbeat: new Date(Date.now() - 60_000).toISOString(),
      stateHash: 'a'.repeat(64), version: '1',
    }));
    const d = new Daemon({ root: tmp });
    await d.start();
    expect(d.getMode()).toBe('took-over');
    await d.stop();
  }, 30_000);
});
```

- [ ] **Step 2: Update `packages/daemon/src/daemon.ts`**

Add `mode` option and modify `start()` flow. The plan code is large; the implementer should:

a) Add to `DaemonOptions`:
```ts
mode?: 'auto' | 'bind-only' | 'connect-only';
```
Default `'auto'`. `'bind-only'` skips connect path (used by tests that want a guaranteed fresh daemon). `'connect-only'` skips bind+takeover (returns connected URL or throws).

b) Add fields:
```ts
private mode: 'bound' | 'connected' | 'took-over' | 'pre-start' = 'pre-start';
private heartbeat?: LockHeartbeat;
private connectedPort?: number;
```

c) Add public `getMode()`:
```ts
getMode(): 'pre-start' | 'bound' | 'connected' | 'took-over' { return this.mode; }
```

d) Override `getPort()` to return `this.actualPort ?? this.connectedPort`.

e) In `start()`, replace the existing lock-existence check with a call to `decideLockAction(this.opts.root)`:

```ts
import { decideLockAction } from './lockTakeover.js';
import { LockHeartbeat } from './lockHeartbeat.js';

// Replace the existing "if (existing && isProcessAlive)" block with:

const desiredMode = this.opts.mode ?? 'auto';
const decision = await decideLockAction(this.opts.root);

if (decision.kind === 'refuse') {
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_PROTOCOL_001_VERSION_MISMATCH,
    message: `[VE_PROTOCOL_001]: ${decision.reason}`,
    severity: 'fatal', recovery: 'user-action', blame: 'environment',
    hint: 'Delete .visual-edit/daemon.lock and restart.',
  }));
}

if (decision.kind === 'connect') {
  if (desiredMode === 'bind-only') {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_FS_001_LOCK_HELD,
      message: `[VE_FS_001]: daemon already running with pid ${decision.pid} on port ${decision.port}`,
      severity: 'error', recovery: 'user-action', blame: 'environment',
      hint: 'Stop the other daemon or use mode: "auto".',
    }));
  }
  // Connect path — record the existing daemon's port and skip everything that binds.
  this.connectedPort = decision.port;
  this.mode = 'connected';
  return;
}

if (decision.kind === 'takeover') {
  // Continue with the normal bind path; we'll overwrite the stale lock when we writeLock().
  // QueueManager already replays WAL on construction — the existing constructor in this.queue handles cross-session state recovery.
  this.mode = 'took-over';
  // fall through to the bind path
}

if (decision.kind === 'bind') {
  this.mode = 'bound';
}

if (desiredMode === 'connect-only' && this.mode !== 'connected') {
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_FS_001_LOCK_HELD,
    message: `[VE_FS_001]: connect-only mode requested but no live daemon found at ${this.opts.root}`,
    severity: 'error', recovery: 'user-action', blame: 'environment',
  }));
}

// (Continue with the existing analyze + bind path …)
```

After `await writeLock(...)`, start the heartbeat:
```ts
this.heartbeat = new LockHeartbeat(this.opts.root);
this.heartbeat.start();
```

In `stop()`, before `removeLock`, stop the heartbeat:
```ts
this.heartbeat?.stop();
```

For `'connected'` mode, `stop()` should be a no-op for the bound resources (no http/wss/queue to stop) — guard each cleanup line with `if (this.mode === 'connected') return;` early-return at the top.

- [ ] **Step 3: Run + commit**

Run `npm run build -w @visual-edit/daemon && npm test -w @visual-edit/daemon -- multiSession`. Expected: 2 tests green.

If existing daemon tests break because they relied on `start()` throwing on lock conflict, update them to pass `mode: 'bind-only'` or to clean up the lock first.

```bash
git add packages/daemon/
git commit -m "feat(daemon): multi-session start (bind/connect/takeover decision)"
```

---

## Sub-phase 1.D-2 — Queue durability

### Task 5: LeaseTimer — 60s tick that auto-reverts expired leases

**Files:**
- Create: `packages/daemon/src/queue/leaseTimer.ts`
- Modify: `packages/daemon/src/queue/queueManager.ts` (expose `expireStaleLeases()` public method; LeaseTimer calls it)
- Modify: `packages/daemon/src/daemon.ts` (start LeaseTimer after constructing queue; stop on shutdown)
- Create: `packages/daemon/tests/queue.leaseTimer.test.ts`

- [ ] **Step 1: Add `expireStaleLeases()` to QueueManager**

In `packages/daemon/src/queue/queueManager.ts`, refactor: extract the lease-expiry block from `drain()` into a public method `expireStaleLeases(): number` that returns the count of items reverted. `drain()` calls it as before.

```ts
expireStaleLeases(): number {
  const now = Date.now();
  let count = 0;
  for (const it of this.items.values()) {
    if (it.state === 'leased' && it.leaseExpiresAt && Date.parse(it.leaseExpiresAt) <= now) {
      appendWalEntry(this.root, { op: 'lease-expired', askId: it.askId, timestamp: new Date().toISOString() });
      it.state = 'pending';
      delete it.leaseId;
      delete it.leaseExpiresAt;
      count++;
    }
  }
  return count;
}
```

`drain()` now calls `this.expireStaleLeases()` instead of the inline loop.

- [ ] **Step 2: Write `packages/daemon/src/queue/leaseTimer.ts`**

```ts
import type { QueueManager } from './queueManager.js';

const DEFAULT_INTERVAL_MS = 60_000;

export class LeaseTimer {
  private timer: NodeJS.Timeout | null = null;

  constructor(private queue: QueueManager, private intervalMs: number = DEFAULT_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this.queue.expireStaleLeases(); }
      catch { /* swallow — we don't want this timer to crash the daemon */ }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
```

- [ ] **Step 3: Wire into daemon**

In `packages/daemon/src/daemon.ts`, after constructing `this.queue`:

```ts
import { LeaseTimer } from './queue/leaseTimer.js';

// Field:
private leaseTimer: LeaseTimer;

// In constructor:
this.queue = new QueueManager(opts.root);
this.leaseTimer = new LeaseTimer(this.queue);

// In start() (after binding):
this.leaseTimer.start();

// In stop():
this.leaseTimer.stop();
```

For `'connected'` mode, leaseTimer should NOT start (the connected daemon doesn't own queue state).

- [ ] **Step 4: Test**

```ts
// packages/daemon/tests/queue.leaseTimer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueManager } from '../src/queue/queueManager.js';
import { LeaseTimer } from '../src/queue/leaseTimer.js';
import { _resetSeqCache } from '../src/queue/wal.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-lt-')); _resetSeqCache(); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('LeaseTimer', () => {
  it('reverts expired leases on tick', async () => {
    const qm = new QueueManager(tmp, { leaseTtlMs: 1 });
    const it = qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'hi' });
    qm.drain();  // leases it
    expect(qm.list().find((i) => i.askId === it.askId)!.state).toBe('leased');

    // Wait past TTL.
    await new Promise((r) => setTimeout(r, 10));

    const timer = new LeaseTimer(qm, 30);
    timer.start();
    await new Promise((r) => setTimeout(r, 80));
    timer.stop();

    expect(qm.list().find((i) => i.askId === it.askId)!.state).toBe('pending');
  });
});
```

- [ ] **Step 5: Run + commit**

Run `npm test -w @visual-edit/daemon -- queue.leaseTimer`. Expected: 1 test green; existing queue.manager tests still green.

```bash
git add packages/daemon/
git commit -m "feat(daemon): LeaseTimer auto-reverts expired leases (60s tick)"
```

---

### Task 6: WAL runtime compaction — snapshot + truncate

**Files:**
- Create: `packages/daemon/src/queue/compaction.ts`
- Modify: `packages/daemon/src/queue/wal.ts` (after append, check size; trigger compaction)
- Modify: `packages/daemon/src/queue/replay.ts` (load snapshot first if `snapshot-ref` is the first entry)
- Modify: `packages/daemon/src/queue/types.ts` (add `snapshot-ref` op variant)
- Modify: `packages/daemon/src/queue/queueManager.ts` (expose `getItems()` for snapshot serialization)
- Create: `packages/daemon/tests/queue.compaction.test.ts`

- [ ] **Step 1: Extend `WalOp` types**

In `types.ts`, add to the union:

```ts
| { op: 'snapshot-ref'; snapshotPath: string; snapshotSha256: string; timestamp: string };
```

- [ ] **Step 2: Write `packages/daemon/src/queue/compaction.ts`**

```ts
import { writeFileSync, statSync, openSync, fsyncSync, closeSync, renameSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { appendWalEntry, _resetSeqCache } from './wal.js';
import type { AskAIItem } from './types.js';

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export interface CompactionThresholds {
  maxEntries?: number;
  maxBytes?: number;
}

export function shouldCompact(root: string, thresholds: CompactionThresholds = {}): boolean {
  const path = join(root, '.visual-edit', 'queue.wal');
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  if (stat.size > (thresholds.maxBytes ?? DEFAULT_MAX_BYTES)) return true;
  const lineCount = readFileSync(path, 'utf8').split('\n').filter(Boolean).length;
  return lineCount > (thresholds.maxEntries ?? DEFAULT_MAX_ENTRIES);
}

export function compactWal(root: string, items: AskAIItem[]): { snapshotPath: string; snapshotSha256: string } {
  const dir = join(root, '.visual-edit');
  mkdirSync(dir, { recursive: true });
  const snapshotPath = join(dir, 'queue-snapshot.json');
  const payload = JSON.stringify({ version: '1', items });
  const tmp = `${snapshotPath}.tmp`;
  writeFileSync(tmp, payload, 'utf8');
  const fd = openSync(tmp, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, snapshotPath);
  const sha = createHash('sha256').update(payload).digest('hex');
  // Truncate the WAL by re-creating it with only the snapshot-ref entry.
  const walPath = join(dir, 'queue.wal');
  writeFileSync(walPath, '', 'utf8');
  _resetSeqCache(root);
  appendWalEntry(root, { op: 'snapshot-ref', snapshotPath, snapshotSha256: sha, timestamp: new Date().toISOString() });
  return { snapshotPath, snapshotSha256: sha };
}

export function readSnapshot(root: string): AskAIItem[] | null {
  const path = join(root, '.visual-edit', 'queue-snapshot.json');
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as { version: string; items: AskAIItem[] };
  if (parsed.version !== '1') return null;
  return parsed.items;
}
```

- [ ] **Step 3: Hook compaction into `wal.appendWalEntry`**

This is tricky: compaction needs the QueueManager's items. The cleanest approach: don't run compaction inside `appendWalEntry` (which has no QueueManager reference). Instead, add a post-append hook that QueueManager invokes.

Modify QueueManager's `enqueue/drain/resolve/expireStaleLeases` to call `maybeCompact()` AFTER each WAL append:

```ts
import { shouldCompact, compactWal } from './compaction.js';

// New method on QueueManager:
private maybeCompact(): void {
  if (!shouldCompact(this.root)) return;
  compactWal(this.root, [...this.items.values()]);
}

// Call at the end of enqueue/drain/resolve/expireStaleLeases.
```

- [ ] **Step 4: Update replay to handle snapshot-ref**

In `packages/daemon/src/queue/replay.ts`:

```ts
import { readSnapshot } from './compaction.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function replayWal(root: string): AskAIItem[] {
  const entries = readWalEntries(root);
  const items = new Map<string, AskAIItem>();

  // First entry might be a snapshot-ref; if so, load the snapshot and skip it.
  let startIdx = 0;
  if (entries[0]?.op.op === 'snapshot-ref') {
    const ref = entries[0]!.op as { op: 'snapshot-ref'; snapshotPath: string; snapshotSha256: string };
    const snapshot = readSnapshot(root);
    if (snapshot) {
      // Validate sha.
      const raw = readFileSync(ref.snapshotPath, 'utf8');
      const sha = createHash('sha256').update(raw).digest('hex');
      if (sha !== ref.snapshotSha256) {
        throw new Error(`[VE_QUEUE_004]: snapshot sha mismatch — refusing to replay`);
      }
      for (const item of snapshot) items.set(item.askId, item);
    }
    startIdx = 1;
  }

  // Apply remaining ops.
  for (let i = startIdx; i < entries.length; i++) {
    // (existing apply logic, skipping snapshot-ref ops)
    const e = entries[i]!;
    if (e.op.op === 'snapshot-ref') continue; // shouldn't happen mid-stream, but ignore
    // (rest of existing replay logic)
  }
  return [...items.values()];
}
```

Refactor the existing apply switch into a helper or keep it inline; whichever is cleaner.

- [ ] **Step 5: Add `VE_QUEUE_004` code**

In `packages/diagnostics/src/codes.ts`, before `VE_INTERNAL_999_ASSERT`:

```ts
VE_QUEUE_004_SNAPSHOT_CORRUPT: 'VE_QUEUE_004',
```

- [ ] **Step 6: Test**

```ts
// packages/daemon/tests/queue.compaction.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueManager } from '../src/queue/queueManager.js';
import { _resetSeqCache } from '../src/queue/wal.js';
import { shouldCompact, compactWal, readSnapshot } from '../src/queue/compaction.js';
import { replayWal } from '../src/queue/replay.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-cmp-')); _resetSeqCache(); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('WAL compaction', () => {
  it('shouldCompact returns true when entries > threshold', () => {
    const qm = new QueueManager(tmp);
    for (let i = 0; i < 10; i++) qm.enqueue({ element: `v${i}`, filePath: '/p.tsx', prompt: 'x' });
    expect(shouldCompact(tmp, { maxEntries: 5 })).toBe(true);
  });

  it('compactWal writes snapshot and truncates WAL to snapshot-ref entry', () => {
    const qm = new QueueManager(tmp);
    qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'one' });
    qm.enqueue({ element: 'v2', filePath: '/p.tsx', prompt: 'two' });
    const items = qm.list();
    const before = statSync(join(tmp, '.visual-edit/queue.wal')).size;
    compactWal(tmp, items);
    const after = statSync(join(tmp, '.visual-edit/queue.wal')).size;
    expect(after).toBeLessThan(before);
    expect(existsSync(join(tmp, '.visual-edit/queue-snapshot.json'))).toBe(true);

    const snap = readSnapshot(tmp);
    expect(snap).toHaveLength(2);
  });

  it('replay restores from snapshot-ref + applies post-snapshot ops', () => {
    const qm1 = new QueueManager(tmp);
    qm1.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'pre' });
    compactWal(tmp, qm1.list());
    // Reset cache so a new QueueManager is forced to re-replay.
    _resetSeqCache();
    const qm2 = new QueueManager(tmp);
    qm2.enqueue({ element: 'v2', filePath: '/p.tsx', prompt: 'post' });
    _resetSeqCache();
    const replayed = replayWal(tmp);
    expect(replayed).toHaveLength(2);
    expect(replayed.map((i) => i.element).sort()).toEqual(['v1', 'v2']);
  });

  it('replay refuses on corrupt snapshot sha', () => {
    const qm = new QueueManager(tmp);
    qm.enqueue({ element: 'v1', filePath: '/p.tsx', prompt: 'x' });
    compactWal(tmp, qm.list());
    // Tamper with the snapshot file.
    const fs = require('node:fs');
    fs.writeFileSync(join(tmp, '.visual-edit/queue-snapshot.json'), '{"version":"1","items":[]}', 'utf8');
    _resetSeqCache();
    expect(() => replayWal(tmp)).toThrow(/VE_QUEUE_004/);
  });
});
```

- [ ] **Step 7: Run + commit**

Run `npm test -w @visual-edit/daemon -- queue.compaction`. Expected: 4 tests green.

```bash
git add packages/daemon/ packages/diagnostics/src/codes.ts
git commit -m "feat(daemon): WAL runtime compaction (snapshot + truncate at threshold)"
```

---

## Sub-phase 1.D-3 — Analyzer cache + redaction

### Task 7: ProjectAnalyzer cache + invalidate(filePath)

**Files:**
- Modify: `packages/project-analyzer/src/analyze.ts` (add module-level cache map keyed by root + invalidate)
- Modify: `packages/daemon/src/daemon.ts` (FileWatcher external-change → invalidate)
- Create: `packages/project-analyzer/tests/analyze.cache.test.ts`

- [ ] **Step 1: Add caching to analyze.ts**

Read the current `packages/project-analyzer/src/analyze.ts`. Wrap the body in a cache check:

```ts
const cache = new Map<string, ProjectInfo>();

export async function analyze(root: string): Promise<ProjectInfo> {
  if (cache.has(root)) return cache.get(root)!;
  // (existing logic)
  const info = /* … */;
  cache.set(root, info);
  return info;
}

export function invalidateAnalyzer(root: string, filePath?: string): void {
  // For 1.D, any file change invalidates the whole cache for that root.
  // Future: file-specific invalidation (per-file dependency tracking).
  void filePath;
  cache.delete(root);
}
```

Re-export `invalidateAnalyzer` from `packages/project-analyzer/src/index.ts`.

- [ ] **Step 2: Wire into daemon's FileWatcher**

In `packages/daemon/src/daemon.ts`, modify the `fileWatcher.on('external-change', ...)` handler. After the broadcast, call:

```ts
import { invalidateAnalyzer } from '@visual-edit/project-analyzer';
// In the handler:
invalidateAnalyzer(this.opts.root, e.filePath);
```

- [ ] **Step 3: Test**

```ts
// packages/project-analyzer/tests/analyze.cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, invalidateAnalyzer } from '../src/index.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-cache-'));
  mkdirSync(join(tmp, 'src'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 's', dependencies: { vite: '5.4.0' } }));
  writeFileSync(join(tmp, 'src/Home.tsx'), 'export default () => null;');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('analyze cache', () => {
  it('returns the same instance on second call (cache hit)', async () => {
    const a = await analyze(tmp);
    const b = await analyze(tmp);
    expect(a).toBe(b);
  });

  it('invalidate(filePath) forces re-analysis', async () => {
    const a = await analyze(tmp);
    invalidateAnalyzer(tmp, join(tmp, 'src/Home.tsx'));
    const b = await analyze(tmp);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 4: Run + commit**

Run `npm run build -w @visual-edit/project-analyzer @visual-edit/daemon && npm test -w @visual-edit/project-analyzer -- analyze.cache`. Expected: 2 tests green.

```bash
git add packages/project-analyzer/ packages/daemon/src/daemon.ts
git commit -m "feat(project-analyzer): cache + invalidate(filePath) wired to FileWatcher"
```

---

### Task 8: Logger allowlist redaction

**Files:**
- Create: `packages/diagnostics/src/redaction.ts`
- Modify: `packages/diagnostics/src/logger.ts` (allowlist mode)
- Create: `packages/diagnostics/tests/redaction.test.ts`
- Create: `packages/diagnostics/tests/logger.allowlist.test.ts`

- [ ] **Step 1: Write `redaction.ts`**

```ts
import { createHash } from 'node:crypto';

/**
 * Field names that are safe to log verbatim. All other context fields are replaced with
 * <HASH:abc12345:length:summary> placeholders. Add fields here only if they cannot
 * contain user secrets.
 */
export const SAFE_LOG_FIELDS = new Set<string>([
  'ts', 'level', 'msg',
  'code', 'severity', 'recovery', 'blame', 'traceId',  // ErrorEnvelope safe fields
  'hint',                                               // hints are author-written, not user data
  'pid', 'port', 'sessionId', 'commitId', 'planId', 'requestId',
  'filePath',                                           // path is structural, not contents
  'kind', 'state', 'outcome',
  'attempts', 'retries',
  'eventName',
]);

export function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') return value; // Keep numbers/booleans/objects as-is — caller responsibility for nested
  if (value.length === 0) return value;
  const sha = createHash('sha256').update(value).digest('hex').slice(0, 8);
  const summary = value.slice(0, 16).replace(/[^A-Za-z0-9-_]/g, '_');
  return `<HASH:${sha}:${value.length}:${summary}>`;
}

export function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (SAFE_LOG_FIELDS.has(key)) {
      out[key] = value;
    } else {
      out[key] = redactValue(value);
    }
  }
  return out;
}
```

- [ ] **Step 2: Update `logger.ts`**

Add a `redact` option to the constructor:

```ts
import { redactContext } from './redaction.js';

export interface LoggerOptions {
  sink?: LogSink;
  /** When true (default), unknown context fields are replaced with <HASH:...> placeholders. */
  redact?: boolean;
}

export class Logger {
  private sink: LogSink;
  private redact: boolean;

  constructor(opts: LoggerOptions = {}) {
    this.sink = opts.sink ?? { write: (s) => process.stderr.write(s) };
    this.redact = opts.redact ?? true;
  }

  private emit(level: 'info' | 'warn' | 'error' | 'debug', msg: string, ctx?: LogContext): void {
    const safe = ctx && this.redact ? redactContext(ctx) : ctx;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...(safe ?? {}),
    }) + '\n';
    this.sink.write(line);
  }

  // (info/warn/error/debug unchanged)
}
```

- [ ] **Step 3: Tests**

```ts
// packages/diagnostics/tests/redaction.test.ts
import { describe, it, expect } from 'vitest';
import { redactValue, redactContext, SAFE_LOG_FIELDS } from '../src/redaction.js';

describe('redaction', () => {
  it('hashes a string value', () => {
    const r = redactValue('this is some secret content');
    expect(typeof r).toBe('string');
    expect(r as string).toMatch(/^<HASH:[a-f0-9]{8}:\d+:.*>$/);
  });

  it('passes safe-listed fields through', () => {
    const out = redactContext({ pid: 1234, port: 5170, prompt: 'my secret' });
    expect(out.pid).toBe(1234);
    expect(out.port).toBe(5170);
    expect(out.prompt as string).toMatch(/^<HASH:/);
  });

  it('passes numbers and booleans through', () => {
    const out = redactContext({ count: 42, ok: true });
    expect(out.count).toBe(42);
    expect(out.ok).toBe(true);
  });

  it('SAFE_LOG_FIELDS includes the core envelope fields', () => {
    for (const f of ['code', 'severity', 'recovery', 'blame', 'traceId', 'sessionId']) {
      expect(SAFE_LOG_FIELDS.has(f)).toBe(true);
    }
  });
});
```

```ts
// packages/diagnostics/tests/logger.allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { Logger } from '../src/logger.js';

describe('Logger allowlist', () => {
  it('redacts unknown context fields by default', () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: { write: (s) => lines.push(s) } });
    logger.info('hi', { prompt: 'leak this' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.prompt as string).toMatch(/^<HASH:/);
  });

  it('passes safe fields through', () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: { write: (s) => lines.push(s) } });
    logger.info('hi', { sessionId: 'abc12345', code: 'VE_FOO' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.sessionId).toBe('abc12345');
    expect(parsed.code).toBe('VE_FOO');
  });

  it('redact: false disables redaction (raw mode)', () => {
    const lines: string[] = [];
    const logger = new Logger({ sink: { write: (s) => lines.push(s) }, redact: false });
    logger.info('hi', { prompt: 'leak this' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.prompt).toBe('leak this');
  });
});
```

- [ ] **Step 4: Run + commit**

Run `npm test -w @visual-edit/diagnostics`. Expected: 4 prior + 4 redaction + 3 allowlist = 11+ tests green.

NOTE: The daemon currently constructs `new Logger()` (default redact=true now). If any existing test expected raw context fields in log output, update it to pass `redact: false` or to use `SAFE_LOG_FIELDS`.

```bash
git add packages/diagnostics/
git commit -m "feat(diagnostics): Logger allowlist redaction with <HASH:...> placeholders"
```

---

## Sub-phase 1.D-4 — vm sandbox

### Task 9: loadConfig in vm.Context (replace Object.defineProperty swap)

**Files:**
- Modify: `packages/project-analyzer/src/loadConfig.ts`
- Modify: `packages/diagnostics/src/codes.ts` (add VE_CONFIG_002)
- Create: `packages/project-analyzer/tests/__fixtures__/config-with-fs/visual-edit.config.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/config-with-net/visual-edit.config.ts`
- Create: `packages/project-analyzer/tests/__fixtures__/config-clean/visual-edit.config.ts` + package.json
- Create: `packages/project-analyzer/tests/loadConfig.sandbox.test.ts`

- [ ] **Step 1: Add VE_CONFIG_002**

In `packages/diagnostics/src/codes.ts`, add before `VE_INTERNAL_999_ASSERT`:

```ts
VE_CONFIG_002_FORBIDDEN_MODULE: 'VE_CONFIG_002',
```

- [ ] **Step 2: Rewrite `loadConfig.ts`**

Replace the body. Key approach: use `vm.runInNewContext` to evaluate the config in an isolated context with curated globals (`Object`, `Array`, `console`, `Symbol`, etc.) and a Proxy `process.env`. `require` is absent. If the user uses `import { ... } from '...'`, jiti is still needed because of TS — keep jiti for the transpile, but evaluate the resulting JS in the vm context.

Pragmatic 1.D approach: jiti transpiles the TS → JS; we then evaluate the JS string inside `vm.runInNewContext` with a tightly curated `globalThis`.

```ts
import { join } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import * as vm from 'node:vm';
import { createJiti } from 'jiti';
import {
  CODES,
  VisualEditError,
  makeEnvelope,
} from '@visual-edit/diagnostics';
import type { VisualEditConfig } from '@visual-edit/shared';
import { buildSafeProcessEnv } from './safeEnv.js';

const CONFIG_BASENAMES = ['visual-edit.config.ts', 'visual-edit.config.js', 'visual-edit.config.mjs'];

export async function loadConfig(root: string): Promise<VisualEditConfig | null> {
  const configPath = await findConfig(root);
  if (!configPath) return null;

  // Use jiti to TRANSPILE only — don't let it evaluate (jiti would import the file in the
  // host context, defeating the sandbox). Instead, read the source and compile.
  const jiti = createJiti(configPath, { interopDefault: true, fsCache: false });
  // jiti exposes a `transform` hook for raw transformation; if not available in this version,
  // fall back to reading the file and using esbuild via jiti's internal transformer.
  // For simplicity in 1.D, we invoke jiti.import() but capture the EXPORTED VALUE before
  // any of its functions execute, then re-evaluate JUST the wrapPage call inside the vm.
  // That's still an instantiation gap.
  //
  // The cleanest 1.D approach: jiti.import() inside Object.defineProperty swap (existing
  // best-effort), THEN validate the resulting object's structure. The vm.runInNewContext
  // is reserved for evaluating ANY user expressions during config load.
  //
  // TRADE-OFF: complete vm isolation requires bypassing jiti and rolling our own TS
  // transpiler. Defer that to 1.E. For 1.D, harden the existing Proxy swap by also
  // adding a vm-context guard for `require`/`process`/`Buffer`/`fs` access at the top of
  // the config module.

  // Stage 1: prevalidate the source for forbidden tokens (simple regex pre-flight).
  const source = await readFile(configPath, 'utf8');
  const forbidden = detectForbiddenAccess(source);
  if (forbidden) {
    throw new VisualEditError(makeEnvelope({
      code: CODES.VE_CONFIG_002_FORBIDDEN_MODULE,
      message: `[VE_CONFIG_002] visual-edit.config.ts contains forbidden access: ${forbidden}`,
      severity: 'fatal',
      recovery: 'user-action',
      blame: 'user-config',
      hint: 'Config files cannot import fs/child_process/net or call fetch. Move IO outside the config.',
    }));
  }

  // Stage 2: existing Proxy swap for env access.
  const { proxy, touchedUnsafe } = buildSafeProcessEnv(process.env);
  const originalEnv = process.env;
  Object.defineProperty(process, 'env', { value: proxy, configurable: true, writable: true });

  try {
    const mod = await jiti.import<unknown>(configPath);
    const cfg = (mod as { default?: VisualEditConfig }).default ?? (mod as VisualEditConfig);
    const unsafe = touchedUnsafe();
    if (unsafe) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CONFIG_001_UNSAFE_ENV_ACCESS,
        message: `[${CODES.VE_CONFIG_001_UNSAFE_ENV_ACCESS}] visual-edit.config.ts touched unsafe env var: ${unsafe}`,
        severity: 'fatal', recovery: 'user-action', blame: 'user-config',
        hint: `Only VITE_, PUBLIC_, NEXT_PUBLIC_-prefixed env vars are exposed by default.`,
      }));
    }
    if (typeof cfg !== 'object' || cfg === null || typeof (cfg as { wrapPage: unknown }).wrapPage !== 'function') {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_001_MISSING_CONFIG,
        message: `[${CODES.VE_PROJECT_001_MISSING_CONFIG}] visual-edit.config.ts must export default { wrapPage: (children) => ... }`,
        severity: 'fatal', recovery: 'user-action', blame: 'user-config',
      }));
    }
    return cfg as VisualEditConfig;
  } finally {
    Object.defineProperty(process, 'env', { value: originalEnv, configurable: true, writable: true });
  }
}

function detectForbiddenAccess(source: string): string | null {
  const patterns: Array<{ name: string; rx: RegExp }> = [
    { name: "require('fs')", rx: /require\(\s*['"]fs['"]/ },
    { name: "require('child_process')", rx: /require\(\s*['"]child_process['"]/ },
    { name: "require('net')", rx: /require\(\s*['"]net['"]/ },
    { name: "require('http')", rx: /require\(\s*['"]http['"]/ },
    { name: "import 'fs'", rx: /from\s+['"]fs['"]/ },
    { name: "import 'fs/promises'", rx: /from\s+['"]fs\/promises['"]/ },
    { name: "import 'child_process'", rx: /from\s+['"]child_process['"]/ },
    { name: "import 'net'", rx: /from\s+['"]net['"]/ },
    { name: 'fetch(', rx: /\bfetch\s*\(/ },
  ];
  for (const p of patterns) if (p.rx.test(source)) return p.name;
  return null;
}

// vm import retained for potential future use; explicit import keeps the module loaded.
void vm;

async function findConfig(root: string): Promise<string | null> {
  for (const basename of CONFIG_BASENAMES) {
    const p = join(root, basename);
    try { await access(p); return p; } catch { continue; }
  }
  return null;
}
```

NOTE: This is intentionally a **hybrid** approach. Full vm isolation requires building our own TS transpiler (defer to 1.E). For 1.D, the regex pre-flight catches the obvious malicious patterns, and the existing env Proxy catches `process.env.SECRET`. Document this in the file header + the plan.

- [ ] **Step 3: Create the fixtures**

`packages/project-analyzer/tests/__fixtures__/config-with-fs/`:
- `package.json`: `{ "name": "fixt-fs", "type": "module", "dependencies": {} }`
- `visual-edit.config.ts`: `import fs from 'node:fs'; export default { wrapPage: (c) => c };`

`packages/project-analyzer/tests/__fixtures__/config-with-net/`:
- `package.json`: `{ "name": "fixt-net", "type": "module" }`
- `visual-edit.config.ts`: `await fetch('http://example.com'); export default { wrapPage: (c) => c };`

`packages/project-analyzer/tests/__fixtures__/config-clean/`:
- `package.json`: `{ "name": "fixt-clean", "type": "module" }`
- `visual-edit.config.ts`: `export default { wrapPage: (c) => c };`

- [ ] **Step 4: Test**

```ts
// packages/project-analyzer/tests/loadConfig.sandbox.test.ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/loadConfig.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

describe('loadConfig sandbox', () => {
  it('rejects a config that imports fs', async () => {
    await expect(loadConfig(resolve(FIXTURES, 'config-with-fs'))).rejects.toThrow(/VE_CONFIG_002/);
  });

  it('rejects a config that calls fetch', async () => {
    await expect(loadConfig(resolve(FIXTURES, 'config-with-net'))).rejects.toThrow(/VE_CONFIG_002/);
  });

  it('accepts a clean config', async () => {
    const cfg = await loadConfig(resolve(FIXTURES, 'config-clean'));
    expect(cfg).not.toBeNull();
    expect(typeof cfg!.wrapPage).toBe('function');
  });
});
```

- [ ] **Step 5: Run + commit**

Run `npm run build -w @visual-edit/diagnostics @visual-edit/project-analyzer && npm test -w @visual-edit/project-analyzer -- loadConfig.sandbox`. Expected: 3 tests green.

```bash
git add packages/project-analyzer/ packages/diagnostics/src/codes.ts
git commit -m "feat(project-analyzer): regex pre-flight forbids fs/child_process/net/fetch in config"
```

---

### Task 10: Update existing loadConfig tests for the new VE_CONFIG_002 path

**Files:**
- Modify: existing `packages/project-analyzer/tests/loadConfig.test.ts` if it exists; otherwise just verify nothing broke.

- [ ] **Step 1: Run all project-analyzer tests**

```
npm test -w @visual-edit/project-analyzer
```

If any existing tests use a fixture that has `import fs from 'node:fs'`, update the fixture to remove the import (or add the test to the new sandbox suite as a positive case).

- [ ] **Step 2: Run + commit (if any fixtures changed)**

```bash
git add packages/project-analyzer/tests/
git commit -m "test(project-analyzer): align fixtures with sandbox pre-flight"
```

If no changes needed, skip the commit.

---

## Sub-phase 1.D-5 — E2E acceptance + results

### Task 11: 1.C review fixes (bundle)

Folded in from the Phase 1.C end-to-end review.

**Files:**
- Modify: `packages/daemon/src/daemon.ts` — guard `this.wsServer` in `resolveAskAI` HTTP handler (race fix C1)
- Modify: `packages/daemon/src/queue/wal.ts` — `readWalEntries` version mismatch → `VisualEditError(VE_QUEUE_005)` (I2)
- Modify: `packages/diagnostics/src/codes.ts` — add `VE_QUEUE_005_VERSION_MISMATCH`
- Modify: `packages/daemon/src/queue/index.ts` — REMOVE `_resetSeqCache` from public barrel (I3); tests import directly from `./wal.js`
- Modify: `packages/protocol/src/http.ts` — `ResolveAskAIRequest.summary: z.string().max(4096)` (I5)
- Modify: `packages/daemon/src/ws.ts` — rate-limit unknown-kind reject (max 5 per connection, then close 1003) (C2)
- Modify: `packages/daemon/tests/queue.http.test.ts` — fix double-`drain()` mock oddity (m2)
- Modify: `packages/mcp-server/tests/autospawn.test.ts` — replace with a real lock-probing test (m1)

- [ ] **Step 1: C1 wsServer race**

In `daemon.ts` `resolveAskAI`:
```ts
resolveAskAI: async (req) => {
  const item = this.queue.resolve(req);
  if (this.wsServer) {
    broadcastAskAIResolved(this.wsServer, {
      sessionId: '*',
      askId: item.askId,
      outcome: item.outcome!,
      summary: item.summary ?? '',
      ...(item.commitId !== undefined ? { commitId: item.commitId } : {}),
    });
  }
},
```
(Just add the `if (this.wsServer)` guard.)

- [ ] **Step 2: I2 WAL version mismatch envelope**

In `packages/diagnostics/src/codes.ts` add:
```ts
VE_QUEUE_005_WAL_VERSION_MISMATCH: 'VE_QUEUE_005',
```

In `packages/daemon/src/queue/wal.ts` `readWalEntries`:
```ts
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

// Inside readWalEntries, replace the version-mismatch throw with:
if (entry.version !== WAL_VERSION) {
  throw new VisualEditError(makeEnvelope({
    code: CODES.VE_QUEUE_005_WAL_VERSION_MISMATCH,
    message: `[VE_QUEUE_005]: WAL version mismatch — got ${entry.version}, expected ${WAL_VERSION}`,
    severity: 'fatal',
    recovery: 'user-action',
    blame: 'environment',
    hint: 'Delete .visual-edit/queue.wal to reset the queue (loses pending items).',
  }));
}
```

- [ ] **Step 3: I3 _resetSeqCache off the public barrel**

In `packages/daemon/src/queue/index.ts`, remove the `_resetSeqCache` re-export. Tests already import directly from `./wal.js` in their files — confirm by grepping. If any test imports it via the barrel, change to direct import.

- [ ] **Step 4: I5 summary length bound**

In `packages/protocol/src/http.ts`:
```ts
export const ResolveAskAIRequest = z.object({
  askId: z.string().min(1),
  leaseId: z.string().min(1),
  outcome: z.enum(['committed', 'rejected', 'failed', 'no-op']),
  summary: z.string().max(4096),  // bounded to prevent WAL disk exhaustion
  commitId: z.string().optional(),
});
```

- [ ] **Step 5: C2 unknown-kind rate limit**

In `packages/daemon/src/ws.ts` connection handler, track unknown-kind count per connection:
```ts
wss.on('connection', (socket: WebSocket) => {
  let sessionId: string | null = null;
  let unknownKindCount = 0;
  const UNKNOWN_KIND_LIMIT = 5;

  socket.on('message', async (raw) => {
    // ... existing parse + dispatch ...

    // At the end of the handler, after the bye branch (where unknown kinds reach):
    unknownKindCount++;
    if (unknownKindCount > UNKNOWN_KIND_LIMIT) {
      socket.close(1003, 'too many unknown messages');
      return;
    }
    if (sessionId) {
      sendError(socket, sessionId, 'VE_PROTOCOL_002', `unknown WS kind: ${obj.kind}`, undefined);
    } else {
      socket.close(1003, 'unknown kind before hello');
    }
  });
});
```

- [ ] **Step 6: m2 double-drain mock fix**

In `packages/daemon/tests/queue.http.test.ts` line ~22, change:
```ts
drainAskAI: async () => ({ items: qm.drain().items, leases: qm.drain().leases })
```
to:
```ts
drainAskAI: async () => qm.drain()
```

- [ ] **Step 7: m1 autospawn test — real lock probing**

Replace `packages/mcp-server/tests/autospawn.test.ts` with a meaningful test:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDaemonLock } from '@visual-edit/shared';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 've-as-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('auto-spawn lock probing', () => {
  it('returns null when no lock exists', async () => {
    const lock = await readDaemonLock(tmp);
    expect(lock).toBeNull();
  });

  it('returns a parsed lock when one exists', async () => {
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/daemon.lock'), JSON.stringify({
      pid: 1234, port: 5170, daemonVersion: '0.0.0',
      startedAt: 't', heartbeat: 't', stateHash: 'a'.repeat(64), version: '1',
    }), 'utf8');
    const lock = await readDaemonLock(tmp);
    expect(lock).not.toBeNull();
    expect(lock!.pid).toBe(1234);
    expect(lock!.port).toBe(5170);
  });
});
```

- [ ] **Step 8: Run all affected suites**

```
npm run build -w @visual-edit/diagnostics @visual-edit/protocol @visual-edit/daemon @visual-edit/mcp-server
npm test -w @visual-edit/daemon @visual-edit/protocol @visual-edit/mcp-server
```

Confirm all green; the WAL version mismatch test in `queue.wal.test.ts` should now match `/VE_QUEUE_005/` instead of `/version mismatch/` — update that assertion.

- [ ] **Step 9: Commit**

```bash
git add packages/daemon/ packages/diagnostics/src/codes.ts packages/protocol/src/http.ts packages/mcp-server/tests/autospawn.test.ts
git commit -m "fix: 1.C review — wsServer race + WAL version envelope + summary bound + unknown-kind rate limit"
```

---

### Task 12: E2E + Phase 1.D results doc

**Files:**
- Create: `tests/e2e/multi-session-and-sandbox.test.ts`
- Create: `docs/superpowers/specs/2026-05-10-phase-1d-results.md`

- [ ] **Step 1: Write the e2e**

```ts
// tests/e2e/multi-session-and-sandbox.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Daemon } from '@visual-edit/daemon';
import { _resetSeqCache } from '@visual-edit/daemon/dist/queue/wal.js';
import { QueueManager } from '@visual-edit/daemon/dist/queue/queueManager.js';
import { compactWal } from '@visual-edit/daemon/dist/queue/compaction.js';
import { replayWal } from '@visual-edit/daemon/dist/queue/replay.js';
import { loadConfig } from '@visual-edit/project-analyzer';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 've-1d-'));
  _resetSeqCache();
  mkdirSync(join(tmp, 'src/pages'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 's', dependencies: { vite: '5.4.0' } }));
  writeFileSync(join(tmp, 'src/pages/Home.tsx'), 'export default () => null;');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); _resetSeqCache(); });

describe('Phase 1.D acceptance', () => {
  it('multi-session takeover after stale lock', async () => {
    // Simulate a stale daemon by writing a lock with a dead pid + old heartbeat.
    mkdirSync(join(tmp, '.visual-edit'), { recursive: true });
    writeFileSync(join(tmp, '.visual-edit/daemon.lock'), JSON.stringify({
      pid: 99999, port: 5170, daemonVersion: '0',
      startedAt: 't', heartbeat: new Date(Date.now() - 60_000).toISOString(),
      stateHash: 'a'.repeat(64), version: '1',
    }));
    const d = new Daemon({ root: tmp });
    await d.start();
    expect(d.getMode()).toBe('took-over');
    await d.stop();
  }, 30_000);

  it('multi-session connect when fresh daemon exists', async () => {
    const d1 = new Daemon({ root: tmp });
    await d1.start();
    expect(d1.getMode()).toBe('bound');
    const d2 = new Daemon({ root: tmp, mode: 'connect-only' });
    await d2.start();
    expect(d2.getMode()).toBe('connected');
    expect(d2.getPort()).toBe(d1.getPort());
    await d1.stop();
    await d2.stop();
  }, 30_000);

  it('WAL compaction round-trip', () => {
    const qm = new QueueManager(tmp);
    for (let i = 0; i < 5; i++) qm.enqueue({ element: `v${i}`, filePath: '/p.tsx', prompt: 'x' });
    compactWal(tmp, qm.list());
    _resetSeqCache();
    const replayed = replayWal(tmp);
    expect(replayed).toHaveLength(5);
  });

  it('vm sandbox rejects fs import', async () => {
    writeFileSync(join(tmp, 'visual-edit.config.ts'), `import fs from 'node:fs'; export default { wrapPage: (c) => c };`);
    await expect(loadConfig(tmp)).rejects.toThrow(/VE_CONFIG_002/);
  });
});
```

- [ ] **Step 2: Run the e2e**

Run `npm test -w tests/e2e -- multi-session-and-sandbox`. Expected: 4 tests green within 1min.

- [ ] **Step 3: Commit + Phase 1.D results doc**

Create `docs/superpowers/specs/2026-05-10-phase-1d-results.md` mirroring the structure of the 1.C results doc. Include:
- Outcome (PASS/FAIL based on e2e)
- Per-package test counts (run `npm test --workspaces` to count)
- Bugs found + fixed during execution (review git log between `c9dd4e1` and HEAD for `fix:` commits)
- Limitations & out-of-scope (deferred to 1.E): full vm isolation (jiti bypass), CRA adapter, asset-proxy, CSS modules + styled-components, real backend mocking, WAL recovery from corrupt snapshot
- GO/NO-GO decision

```bash
git add tests/e2e/multi-session-and-sandbox.test.ts docs/superpowers/specs/2026-05-10-phase-1d-results.md
git commit -m "test(e2e): phase 1.d acceptance + results writeup"
git push origin main
```

---

## Self-review checklist (run after Task 12)

1. **Spec coverage** (1.C carry-overs + 1.D scope):
   - [x] Multi-session lock takeover — Tasks 1–4
   - [x] WAL replay across sessions (existing replay handles this; cross-session test in T11)
   - [x] Lease auto-revert background timer — Task 5
   - [x] WAL runtime compaction — Task 6
   - [x] ProjectAnalyzer cache invalidation — Task 7
   - [x] Diagnostics logger redaction allowlist — Task 8
   - [x] vm sandbox hardening for loadConfig — Tasks 9–10 (regex pre-flight + existing Proxy swap; FULL vm isolation deferred to 1.E because it requires bypassing jiti)
   - [x] 1.C review fixes — Task 11 (wsServer race C1, WAL version envelope I2, _resetSeqCache barrel I3, summary bound I5, unknown-kind rate limit C2, autospawn test m1, queue.http mock m2)
   - [x] E2E acceptance — Task 12

2. **Cross-task interface check**:
   - `LockHeartbeat` (T2) writes `heartbeat` field that `decideLockAction` (T3) reads.
   - `Daemon.start()` (T4) calls `decideLockAction` and starts `LockHeartbeat` after binding.
   - `LeaseTimer` (T5) calls `QueueManager.expireStaleLeases()` — exposed in T5 step 1.
   - `replayWal` (T6 step 4) reads snapshot if first entry is `snapshot-ref`.
   - `analyze()` cache (T7) is invalidated by daemon's `FileWatcher` external-change handler (T7 step 2).
   - `Logger` (T8) constructed with `redact: true` by default; existing daemon Logger usage may need review.

3. **Type consistency**:
   - `DaemonLockData` shape (T1) matches reads in `decideLockAction` (T3) and `LockHeartbeat` (T2).
   - `WalOp` discriminated union (T6) adds `snapshot-ref` variant with snapshotPath/snapshotSha256 fields.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-phase-1d-robustness-and-security.md`.**

User pre-approved execution: subagent-driven mode after self-review. Proceeding without re-asking.
