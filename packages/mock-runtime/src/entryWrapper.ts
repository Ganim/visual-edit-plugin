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
  return lines.join('\n');
}
