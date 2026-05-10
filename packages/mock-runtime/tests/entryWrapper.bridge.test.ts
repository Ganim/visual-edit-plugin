import { describe, it, expect } from 'vitest';
import { buildEntryWrapper } from '../src/entryWrapper.js';

describe('bridge in entryWrapper', () => {
  it('emits a ResizeObserver / mutationObserver block that posts data-vid rects to parent', () => {
    const code = buildEntryWrapper({
      pageImportPath: './Home.tsx',
      configImportPath: '../visual-edit.config.ts',
      fakerBindingsImportPath: './faker-bindings.ts',
      userCssImportPath: null,
      sessionId: 's1',
    });
    expect(code).toContain('window.parent.postMessage');
    expect(code).toContain('data-vid');
    expect(code).toContain('MutationObserver');
    expect(code).toContain('ResizeObserver');
    expect(code).toContain('__veInstallBridge');
  });
});
