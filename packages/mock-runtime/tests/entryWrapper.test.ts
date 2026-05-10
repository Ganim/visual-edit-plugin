import { describe, it, expect } from 'vitest';
import { buildEntryWrapper } from '../src/entryWrapper.js';

describe('buildEntryWrapper', () => {
  it('emits a React entry that imports the page + config and mounts it wrapped', () => {
    const code = buildEntryWrapper({
      pageImportPath: '../../src/pages/Home.tsx',
      configImportPath: '../../visual-edit.config.ts',
      fakerBindingsImportPath: './faker-bindings.ts',
      userCssImportPath: '../../src/index.css',
      sessionId: 'sess-123',
    });
    expect(code).toContain(`import { createRoot } from 'react-dom/client';`);
    expect(code).toContain(`import Page from '../../src/pages/Home.tsx';`);
    expect(code).toContain(`import config from '../../visual-edit.config.ts';`);
    expect(code).toContain(`import * as mocks from './faker-bindings.ts';`);
    expect(code).toContain(`import '../../src/index.css';`);
    expect(code).toContain(`(globalThis as any).__VE_MOCKS = mocks;`);
    expect(code).toContain(`const wrapped = config.wrapPage(<Page />);`);
    expect(code).toContain(`createRoot(document.getElementById('root')!).render`);
    expect(code).toContain(`sess-123`); // sessionId carried for handshake/debugging
  });

  it('falls back to identity wrapPage when config is null', () => {
    const code = buildEntryWrapper({
      pageImportPath: '../../src/pages/Home.tsx',
      configImportPath: null,
      fakerBindingsImportPath: './faker-bindings.ts',
      userCssImportPath: null,
      sessionId: 'sess-x',
    });
    expect(code).not.toContain(`import config from`);
    expect(code).not.toContain(`src/index.css`);
    expect(code).toContain(`const wrapped = (<Page />);`);
  });

  it('imports handlers and starts MSW before render', () => {
    const code = buildEntryWrapper({
      pageImportPath: './Home.tsx',
      configImportPath: '../visual-edit.config.ts',
      fakerBindingsImportPath: './faker-bindings.ts',
      userCssImportPath: null,
      sessionId: 's1',
    });
    expect(code).toContain("import { setupWorker } from 'msw/browser'");
    expect(code).toContain("import { handlers } from './handlers.js'");
    expect(code).toContain('await __veStartMSW()');
  });
});
