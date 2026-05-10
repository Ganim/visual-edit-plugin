import { describe, it, expect } from 'vitest';
import { buildMSWHandlers } from '../src/buildMSWHandlers.js';
import type { ApiEndpoint, MockSchema } from '@visual-edit/shared';

const userSchema: MockSchema = {
  name: 'User',
  source: 'zod',
  shape: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } } as never,
};

describe('buildMSWHandlers', () => {
  it('emits a handlers module with imports + per-endpoint handlers', () => {
    const endpoints: ApiEndpoint[] = [{ method: 'GET', url: '/api/users/me', schemaName: 'User' }];
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides: {} });
    expect(code).toContain("import { http, HttpResponse } from 'msw'");
    expect(code).toContain("import { makeUser }");
    expect(code).toContain("http.get('/api/users/me'");
    expect(code).toContain('HttpResponse.json(makeUser())');
  });

  it('uses the configured status when present', () => {
    const endpoints: ApiEndpoint[] = [{ method: 'GET', url: '/api/x', schemaName: 'User', status: 201 }];
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides: {} });
    expect(code).toContain('{ status: 201 }');
  });

  it('emits override values literally for matching url+method', () => {
    const endpoints: ApiEndpoint[] = [{ method: 'GET', url: '/api/users/me', schemaName: 'User' }];
    const overrides = { 'GET /api/users/me': { id: 'fixed-id', name: 'Fixed', email: 'f@x.io' } };
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides });
    expect(code).toContain('"id": "fixed-id"');
  });

  it('handles all 5 HTTP verbs', () => {
    const endpoints: ApiEndpoint[] = [
      { method: 'GET', url: '/g', schemaName: 'User' },
      { method: 'POST', url: '/p', schemaName: 'User' },
      { method: 'PUT', url: '/pu', schemaName: 'User' },
      { method: 'DELETE', url: '/d', schemaName: 'User' },
      { method: 'PATCH', url: '/pa', schemaName: 'User' },
    ];
    const code = buildMSWHandlers({ schemas: [userSchema], endpoints, overrides: {} });
    for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
      expect(code).toContain(`http.${m}(`);
    }
  });
});
