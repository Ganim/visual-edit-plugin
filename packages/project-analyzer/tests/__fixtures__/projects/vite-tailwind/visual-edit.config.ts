import type { VisualEditConfig } from '@visual-edit/shared';

const config: VisualEditConfig = {
  wrapPage: (children) => children,
  safeEnvPrefixes: ['VITE_', 'PUBLIC_'],
};
export default config;
