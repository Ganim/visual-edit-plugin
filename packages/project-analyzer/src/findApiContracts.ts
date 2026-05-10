import fg from 'fast-glob';
import { createJiti } from 'jiti';
import type { ApiEndpoint } from '@visual-edit/shared';
import { CODES, VisualEditError, makeEnvelope } from '@visual-edit/diagnostics';

interface RawEndpoint {
  method?: string;
  url?: string;
  schemaName?: string;
  status?: number;
}

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function normalize(raw: RawEndpoint): ApiEndpoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const method = String(raw.method ?? '').toUpperCase();
  const url = raw.url;
  const schemaName = raw.schemaName;
  if (!VALID_METHODS.has(method) || typeof url !== 'string' || typeof schemaName !== 'string') return null;
  const out: ApiEndpoint = { method: method as ApiEndpoint['method'], url, schemaName };
  if (typeof raw.status === 'number') out.status = raw.status;
  return out;
}

export async function findApiContracts(
  root: string,
  availableSchemas?: readonly string[],
): Promise<ApiEndpoint[]> {
  const files = await fg('**/*.api.{ts,js,mjs}', {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.visual-edit/**'],
  });

  const out: ApiEndpoint[] = [];
  for (const file of files) {
    const jiti = createJiti(file, { interopDefault: false, fsCache: false });
    let mod: Record<string, unknown>;
    try {
      mod = await jiti.import<Record<string, unknown>>(file);
    } catch {
      continue; // skip files that fail to load
    }

    const single = mod.endpoint as RawEndpoint | undefined;
    const arr = mod.endpoints as RawEndpoint[] | undefined;

    if (single) {
      const ep = normalize(single);
      if (ep) out.push(ep);
    }
    if (Array.isArray(arr)) {
      for (const raw of arr) {
        const ep = normalize(raw);
        if (ep) out.push(ep);
      }
    }
  }

  if (availableSchemas) {
    const known = new Set(availableSchemas);
    const orphans = out.filter((ep) => !known.has(ep.schemaName));
    if (orphans.length > 0) {
      const list = orphans.map((o) => `${o.method} ${o.url} → ${o.schemaName}`).join('; ');
      throw new VisualEditError(makeEnvelope({
        code: CODES.VE_PROJECT_003_ORPHAN_API,
        message: `[VE_PROJECT_003]: API endpoints reference unknown schemas: ${list}`,
        severity: 'error',
        recovery: 'user-action',
        blame: 'user-config',
        hint: 'Either define the schema (Zod) and rerun discoverSchemas, or remove the endpoint.',
      }));
    }
  }

  return out;
}
