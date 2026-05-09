import { join } from 'node:path';
import { access } from 'node:fs/promises';
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

  // Instantiate jiti BEFORE swapping process.env so jiti's own initialization
  // (reading JITI_*, NODE_*, DEBUG, etc.) is not flagged as unsafe.
  const jiti = createJiti(configPath, { interopDefault: true, fsCache: false });

  // Sandbox: replace process.env with a Proxy that records unsafe reads.
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
