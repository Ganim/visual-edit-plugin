import { z } from 'zod';

export const WsHelloMessage = z.object({
  kind: z.literal('hello'),
  version: z.literal('1.0'),
  sessionId: z.string().min(1),
});
export type WsHelloMessage = z.infer<typeof WsHelloMessage>;

export const WsSnapshotMessage = z.object({
  kind: z.literal('snapshot'),
  sessionId: z.string().min(1),
  url: z.string().url(),
  status: z.enum(['starting', 'ready', 'crashed', 'closed']),
});
export type WsSnapshotMessage = z.infer<typeof WsSnapshotMessage>;

export const WsByeMessage = z.object({
  kind: z.literal('bye'),
  sessionId: z.string().min(1),
});
export type WsByeMessage = z.infer<typeof WsByeMessage>;

export const WsMessage = z.union([WsHelloMessage, WsSnapshotMessage, WsByeMessage]);
export type WsMessage = z.infer<typeof WsMessage>;
