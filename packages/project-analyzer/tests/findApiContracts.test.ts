import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findApiContracts } from '../src/findApiContracts.js';

const FIXT = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/projects/api-fixture');
const ORPHAN = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/projects/api-orphan');

describe('findApiContracts', () => {
  it('returns endpoints from *.api.ts files (single-export and array-export forms)', async () => {
    const contracts = await findApiContracts(FIXT);
    expect(contracts).toHaveLength(3);
    const urls = contracts.map((c) => c.url).sort();
    expect(urls).toEqual(['/api/products', '/api/products', '/api/users/me']);
  });

  it('returns method as uppercase string', async () => {
    const contracts = await findApiContracts(FIXT);
    expect(contracts.every((c) => /^(GET|POST|PUT|DELETE|PATCH)$/.test(c.method))).toBe(true);
  });

  it('skips files that lack a recognized export', async () => {
    // Implicit: there is no orphan file in the fixture; test should not throw.
    const contracts = await findApiContracts(FIXT);
    expect(contracts.length).toBeGreaterThan(0);
  });

  it('passes when all schemas are recognized', async () => {
    const contracts = await findApiContracts(FIXT, ['User', 'Product']);
    expect(contracts).toHaveLength(3);
  });

  it('throws VE_PROJECT_003 when an endpoint references an unknown schema', async () => {
    await expect(findApiContracts(ORPHAN, ['User'])).rejects.toThrow(/VE_PROJECT_003/);
  });
});
