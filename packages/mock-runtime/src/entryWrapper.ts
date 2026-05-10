export interface BuildEntryWrapperInput {
  /** Relative path from the ephemeral entry's location to the user's page file. */
  pageImportPath: string;
  /** Relative path to visual-edit.config.ts, or null if the user has none. */
  configImportPath: string | null;
  /** Relative path to the generated faker-bindings.ts (sibling of the entry). */
  fakerBindingsImportPath: string;
  /** Relative path to the user's global CSS (e.g. src/index.css with Tailwind directives), or null. */
  userCssImportPath: string | null;
  sessionId: string;
}

const BRIDGE_SOURCE = `
function __veCollectRects() {
  const out = {};
  for (const el of document.querySelectorAll('[data-vid]')) {
    const r = el.getBoundingClientRect();
    out[el.getAttribute('data-vid')] = { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  window.parent.postMessage({ type: 've-rects', rects: out }, '*');
}
function __veInstallBridge() {
  __veCollectRects();
  const mo = new MutationObserver(() => __veCollectRects());
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-vid', 'class', 'style'] });
  const ro = new ResizeObserver(() => __veCollectRects());
  ro.observe(document.documentElement);
  window.addEventListener('scroll', () => __veCollectRects(), { passive: true });
  window.addEventListener('resize', () => __veCollectRects(), { passive: true });
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 've-rects-request') __veCollectRects();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __veInstallBridge);
else __veInstallBridge();
`;

export function buildEntryWrapper(input: BuildEntryWrapperInput): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated synthetic entry by @visual-edit/mock-runtime — do not edit.`);
  lines.push(`import { createRoot } from 'react-dom/client';`);
  lines.push(`import * as mocks from '${input.fakerBindingsImportPath}';`);
  if (input.userCssImportPath) {
    // Side-effect import — must come before Page so Tailwind utilities resolve.
    lines.push(`import '${input.userCssImportPath}';`);
  }
  lines.push(`import Page from '${input.pageImportPath}';`);
  if (input.configImportPath) {
    lines.push(`import config from '${input.configImportPath}';`);
  }
  lines.push('');
  lines.push(`(globalThis as any).__VE_MOCKS = mocks;`);
  lines.push(`(globalThis as any).__VE_SESSION_ID = '${input.sessionId}';`);
  lines.push('');
  if (input.configImportPath) {
    lines.push(`const wrapped = config.wrapPage(<Page />);`);
  } else {
    lines.push(`const wrapped = (<Page />);`);
  }
  lines.push(`createRoot(document.getElementById('root')!).render(wrapped);`);
  lines.push('');
  lines.push(BRIDGE_SOURCE);
  return lines.join('\n');
}
