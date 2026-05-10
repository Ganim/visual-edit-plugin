import { z } from 'zod';

export const OpenPreviewRequest = z.object({
  root: z.string().min(1),
  page: z.string().min(1),
});
export type OpenPreviewRequest = z.infer<typeof OpenPreviewRequest>;

export const OpenPreviewResponse = z.object({
  url: z.string().url(),
  sessionId: z.string().min(1),
  editorUrl: z.string().url(),
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

export const RollbackRequest = z.object({ commitId: z.string().min(1) });
export type RollbackRequest = z.infer<typeof RollbackRequest>;

const AskAIItemShape = z.object({
  askId: z.string(),
  element: z.string(),
  filePath: z.string(),
  prompt: z.string(),
  state: z.enum(['pending', 'leased', 'resolved']),
  enqueuedAt: z.string(),
  leaseId: z.string().optional(),
  leaseExpiresAt: z.string().optional(),
  outcome: z.enum(['committed', 'rejected', 'failed', 'no-op']).optional(),
  summary: z.string().optional(),
  commitId: z.string().optional(),
  resolvedAt: z.string().optional(),
});

export const DrainAskAIRequest = z.object({});
export type DrainAskAIRequest = z.infer<typeof DrainAskAIRequest>;

export const DrainAskAIResponse = z.object({
  items: z.array(AskAIItemShape),
  leases: z.record(z.string(), z.string()),
});
export type DrainAskAIResponse = z.infer<typeof DrainAskAIResponse>;

export const ResolveAskAIRequest = z.object({
  askId: z.string().min(1),
  leaseId: z.string().min(1),
  outcome: z.enum(['committed', 'rejected', 'failed', 'no-op']),
  summary: z.string(),
  commitId: z.string().optional(),
});
export type ResolveAskAIRequest = z.infer<typeof ResolveAskAIRequest>;
