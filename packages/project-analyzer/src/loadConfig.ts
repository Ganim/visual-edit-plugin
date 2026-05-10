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

// vm import retained for potential future use in 1.E full sandbox.
void vm;

const CONFIG_BASENAMES = ['visual-edit.config.ts', 'visual-edit.config.js', 'visual-edit.config.mjs'];

/**
 * Regex pre-flight that detects forbidden module access patterns in config source.
 * This is a pragmatic 1.D approach — a regex scan of the raw TS source BEFORE jiti
 * loads it. Full vm.Context isolation (where jiti is bypassed entirely) is deferred
 * to Phase 1.E.
 *
 * Catches:
 *   - require('fs'), require('child_process'), require('net'), require('http')
 *   - import ... from 'fs', 'fs/promises', 'node:fs', 'node:fs/promises'
 *   - import ... from 'child_process', 'node:child_process'
 *   - import ... from 'net', 'node:net'
 *   - bare fetch( calls
 */
function detectForbiddenAccess(source: string): string | null {
  const patterns: Array<{ name: string; rx: RegExp }> = [
    { name: "require('fs')",            rx: /require\(\s*['"](?:node:)?fs['"]/ },
    { name: "require('child_process')", rx: /require\(\s*['"](?:node:)?child_process['"]/ },
    { name: "require('net')",           rx: /require\(\s*['"](?:node:)?net['"]/ },
    { name: "require('http')",          rx: /require\(\s*['"](?:node:)?http['"]/ },
    { name: "import 'fs'",             rx: /from\s+['"](?:node:)?fs['"]/ },
    { name: "import 'fs/promises'",    rx: /from\s+['"](?:node:)?fs\/promises['"]/ },
    { name: "import 'child_process'",  rx: /from\s+['"](?:node:)?child_process['"]/ },
    { name: "import 'net'",            rx: /from\s+['"](?:node:)?net['"]/ },
    { name: 'fetch(',                  rx: /\bfetch\s*\(/ },
  ];
  for (const p of patterns) {
    if (p.rx.test(source)) return p.name;
  }
  return null;
}

export async function loadConfig(root: string): Promise<VisualEditConfig | null> {
  const configPath = await findConfig(root);
  if (!configPath) return null;

  // Stage 1: regex pre-flight — reject configs that reference forbidden modules.
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

  // Stage 2: instantiate jiti BEFORE swapping process.env so jiti's own initialization
  // (reading JITI_*, NODE_*, DEBUG, etc.) is not flagged as unsafe.
  const jiti = createJiti(configPath, { interopDefault: true, fsCache: false });

  // Stage 3: Proxy swap for process.env — catches unsafe env var reads at import time.
  const { proxy, touchedUnsafe } = buildSafeProcessEnv(process.env);
  const originalEnv = process.env;
  // Node disallows direct assignment in some contexts; mutate keys instead.
  // We use Object.defineProperty on `process` to swap env temporarily.
  Object.defineProperty(process, 'env', { value: proxy, configurable: true, writable: true });

  try {
    const mod = await jiti.import<unknown>(configPath);
    const cfg = (mod as { default?: VisualEditConfig }).default ?? (mod as VisualEditConfig);

    const unsafe = touchedUnsafe();
    if (unsafe) {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_CONFIG_001_UNSAFE_ENV_ACCESS,
        message: `[${CODES.VE_CONFIG_001_UNSAFE_ENV_ACCESS}] visual-edit.config.ts touched unsafe env var: ${unsafe}`,
        severity: 'fatal',
        recovery: 'user-action',
        blame: 'user-config',
        hint: `Only VITE_, PUBLIC_, NEXT_PUBLIC_-prefixed env vars are exposed by default. Move secret reads outside the config.`,
      }));
    }

    if (typeof cfg !== 'object' || cfg === null || typeof (cfg as { wrapPage: unknown }).wrapPage !== 'function') {
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_001_MISSING_CONFIG,
        message: `[${CODES.VE_PROJECT_001_MISSING_CONFIG}] visual-edit.config.ts must export default { wrapPage: (children) => ... }`,
        severity: 'fatal',
        recovery: 'user-action',
        blame: 'user-config',
      }));
    }

    return cfg as VisualEditConfig;
  } finally {
    Object.defineProperty(process, 'env', { value: originalEnv, configurable: true, writable: true });
  }
}

async function findConfig(root: string): Promise<string | null> {
  for (const basename of CONFIG_BASENAMES) {
    const p = join(root, basename);
    try {
      await access(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}
