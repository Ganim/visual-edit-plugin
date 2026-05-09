import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSchemas } from '../src/discoverSchemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '__fixtures__/projects/vite-tailwind');

describe('discoverSchemas', () => {
  it('finds Zod schemas exported from *.schema.ts files', async () => {
    const schemas = await discoverSchemas(FIXTURE);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe('User');
    expect(schemas[0]!.source).toBe('zod');
  });

  it('extracts a usable shape from the schema', async () => {
    const schemas = await discoverSchemas(FIXTURE);
    const user = schemas[0]!;
    const props = user.shape.properties as Record<string, { type?: string }>;
    expect(props['id']!.type).toBe('string');
    expect(props['age']!.type).toBe('integer');
    expect(props['email']!.type).toBe('string');
  });
});
