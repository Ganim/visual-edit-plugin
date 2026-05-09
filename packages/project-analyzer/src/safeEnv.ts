const DEFAULT_SAFE_PREFIXES = ['VITE_', 'PUBLIC_', 'NEXT_PUBLIC_'];

/**
 * Tool / runtime infrastructure env vars that jiti, esbuild, babel, swc, node,
 * and npm read as part of normal compilation. These are never flagged as unsafe
 * (they are not user secrets) and their values pass through.
 */
const TOOL_INFRA_PREFIXES = [
  'JITI_',
  'BABEL_',
  'NODE_',
  'npm_',
  'NPM_',
  'ESBUILD_',
  'SWC_',
  'TS_',
  'VITEST_',
];
const TOOL_INFRA_NAMES = new Set([
  'NODE_ENV',
  'DEBUG',
  'FORCE_COLOR',
  'NO_COLOR',
  'CI',
  'PATH',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'PWD',
  'OLDPWD',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'COLORTERM',
]);

function isToolInfra(prop: string): boolean {
  if (TOOL_INFRA_NAMES.has(prop)) return true;
  return TOOL_INFRA_PREFIXES.some((p) => prop.startsWith(p));
}

export function buildSafeProcessEnv(
  raw: NodeJS.ProcessEnv,
  safePrefixes: readonly string[] = DEFAULT_SAFE_PREFIXES,
): { proxy: NodeJS.ProcessEnv; touchedUnsafe: () => string | null } {
  let unsafe: string | null = null;
  const proxy = new Proxy({} as NodeJS.ProcessEnv, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      // Tool-infrastructure env vars (jiti, babel, node, npm, etc.) pass through
      // unchanged and are never flagged as unsafe.
      if (isToolInfra(prop)) return raw[prop];
      const isSafe = safePrefixes.some((p) => prop.startsWith(p));
      if (!isSafe) {
        if (unsafe === null) unsafe = prop;
        return undefined;
      }
      return raw[prop];
    },
    has(_t, prop) {
      if (typeof prop !== 'string') return false;
      return safePrefixes.some((p) => prop.startsWith(p)) && prop in raw;
    },
    ownKeys() {
      return Object.keys(raw).filter((k) => safePrefixes.some((p) => k.startsWith(p)));
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (!safePrefixes.some((p) => prop.startsWith(p))) return undefined;
      return { configurable: true, enumerable: true, value: raw[prop], writable: false };
    },
  });
  return { proxy, touchedUnsafe: () => unsafe };
}
