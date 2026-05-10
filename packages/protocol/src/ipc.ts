import { z } from 'zod';

export const IpcStartMessage = z.object({
  kind: z.literal('start'),
  adapterInput: z.unknown(), // typed in adapters package; protocol just transports
});
export type IpcStartMessage = z.infer<typeof IpcStartMessage>;

export const IpcReadyMessage = z.object({
  kind: z.literal('ready'),
  url: z.string().url(),
  /** Absolute path to the ephemeral preview directory, so the daemon can clean it up on stop. */
  ephemeralDir: z.string().optional(),
});
export type IpcReadyMessage = z.infer<typeof IpcReadyMessage>;

export const IpcErrorMessage = z.object({
  kind: z.literal('error'),
  message: z.string(),
  stack: z.string().optional(),
});
export type IpcErrorMessage = z.infer<typeof IpcErrorMessage>;

export const IpcMessage = z.union([IpcStartMessage, IpcReadyMessage, IpcErrorMessage]);
export type IpcMessage = z.infer<typeof IpcMessage>;
