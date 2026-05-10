import type { ProjectInfo, PageEntry, MockSchema, VisualEditConfig, ApiEndpoint } from '@visual-edit/shared';

export interface AdapterInput {
  info: ProjectInfo;
  page: PageEntry;
  config: VisualEditConfig | null;
  schemas: MockSchema[];
  /**
   * API endpoint contracts discovered by `findApiContracts`. Optional — when absent
   * (or empty) the generated `handlers.ts` exports an empty array and MSW startup
   * short-circuits. Full wiring happens when the daemon calls `findApiContracts`
   * before invoking the adapter (Phase 1.E Task 11).
   */
  endpoints?: ApiEndpoint[];
  /**
   * Remote image strategy for the asset-proxy. Defaults to 'placeholder' if absent.
   * Reads from visual-edit.config.ts → assetProxy.remoteImageStrategy when wired
   * by the daemon (Phase 1.F).
   */
  remoteImageStrategy?: 'placeholder' | 'pass-through' | 'cached';
  port: number;
  sessionId: string;
  /** Filtered env vars (already passed through safeEnvPrefixes). */
  env: Record<string, string>;
}

export interface AdapterHandle {
  url: string;
  stop(): Promise<void>;
}

export interface GenerateResult {
  /** Absolute path to the ephemeral directory we created. */
  ephemeralDir: string;
  /** Absolute path to entry.tsx within ephemeralDir. */
  entryPath: string;
  /** Absolute path to vite.config.ts within ephemeralDir. */
  viteConfigPath: string;
  /** Absolute path to index.html within ephemeralDir. */
  indexHtmlPath: string;
}
