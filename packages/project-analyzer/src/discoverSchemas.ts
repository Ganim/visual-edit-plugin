import { createJiti } from 'jiti';
import fg from 'fast-glob';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { MockSchema } from '@visual-edit/shared';

export async function discoverSchemas(root: string): Promise<MockSchema[]> {
  const files = await fg('src/**/*.schema.ts', { cwd: root, absolute: true });
  const out: MockSchema[] = [];

  for (const file of files) {
    const jiti = createJiti(file, { interopDefault: false, fsCache: false });
    let mod: Record<string, unknown>;
    try {
      mod = await jiti.import<Record<string, unknown>>(file);
    } catch {
      continue; // skip files that fail to load
    }

    for (const [name, value] of Object.entries(mod)) {
      if (!isZodSchema(value)) continue;
      const shape = zodToJsonSchema(value, { name }) as Record<string, unknown>;
      // zodToJsonSchema wraps in $ref/definitions when name is set; pull the inner schema.
      const inner = ((shape as { definitions?: Record<string, Record<string, unknown>> }).definitions ?? {})[name];
      out.push({
        name,
        source: 'zod',
        shape: inner ?? shape,
      });
    }
  }
  return out;
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
}
