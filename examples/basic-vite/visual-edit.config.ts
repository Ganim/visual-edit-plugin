import type { VisualEditConfig } from '@visual-edit/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const config: VisualEditConfig = {
  wrapPage: (children) =>
    createElement(QueryClientProvider, { client: queryClient }, children as never),
};
export default config;
