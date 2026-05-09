import type { ProjectInfo, PageEntry, MockSchema, VisualEditConfig } from '@visual-edit/shared';

export interface AdapterInput {
  info: ProjectInfo;
  page: PageEntry;
  config: VisualEditConfig | null;
  schemas: MockSchema[];
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
