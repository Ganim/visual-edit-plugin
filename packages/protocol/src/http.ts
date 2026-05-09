import { z } from 'zod';

export const OpenPreviewRequest = z.object({
  root: z.string().min(1),
  page: z.string().min(1),
});
export type OpenPreviewRequest = z.infer<typeof OpenPreviewRequest>;

export const OpenPreviewResponse = z.object({
  url: z.string().url(),
  sessionId: z.string().min(1),
});
export type OpenPreviewResponse = z.infer<typeof OpenPreviewResponse>;

export const ClosePreviewRequest = z.object({
  sessionId: z.string().min(1),
});
export type ClosePreviewRequest = z.infer<typeof ClosePreviewRequest>;

export const StatusResponse = z.object({
  daemonVersion: z.string(),
  uptime: z.number(),
  activePreviews: z.number().int().nonnegative(),
  workerHealth: z.record(z.string(), z.enum(['ok', 'degraded', 'down'])),
});
export type StatusResponse = z.infer<typeof StatusResponse>;
