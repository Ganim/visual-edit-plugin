import type { PageEntry } from './project.js';

export interface PreviewSession {
  id: string;
  url: string;
  pageRef: PageEntry;
  startedAt: string;
  status: 'starting' | 'ready' | 'crashed' | 'closed';
}

export interface DaemonStatus {
  daemonVersion: string;
  uptime: number;
  activePreviews: number;
  workerHealth: Record<string, 'ok' | 'degraded' | 'down'>;
  // Phase 1.C will add: queueDepth, walSize.
}
