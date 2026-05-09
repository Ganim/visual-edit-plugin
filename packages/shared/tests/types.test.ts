import { describe, it, expectTypeOf } from 'vitest';
import type {
  ElementId,
  ProjectRoot,
  RouteSpec,
  ProjectInfo,
  PageEntry,
  VisualEditConfig,
  MockSchema,
  ApiEndpoint,
  PreviewSession,
  DaemonStatus,
} from '../src/index.js';

describe('shared types', () => {
  it('ProjectInfo has the spec fields', () => {
    const info: ProjectInfo = {
      root: '/x' as ProjectRoot,
      framework: 'vite',
      reactVersion: '18.2.0',
      packageManager: 'npm',
      styling: ['tailwind'],
      tsconfigPaths: { '@/*': ['./src/*'] },
      workspaces: null,
      publicDir: 'public',
      envFiles: ['.env'],
      routes: [],
      config: null,
    };
    expectTypeOf(info.framework).toEqualTypeOf<'vite' | 'cra' | 'unknown'>();
  });

  it('PreviewSession.status is exhaustive', () => {
    const ok: PreviewSession['status'] = 'ready';
    const _ok2: PreviewSession['status'] = 'starting';
    const _ok3: PreviewSession['status'] = 'crashed';
    const _ok4: PreviewSession['status'] = 'closed';
    expectTypeOf(ok).toEqualTypeOf<'starting' | 'ready' | 'crashed' | 'closed'>();
  });
});
