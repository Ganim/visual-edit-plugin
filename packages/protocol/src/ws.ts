import { z } from 'zod';

const HEX_64 = z.string().regex(/^[a-f0-9]{64}$/);
const SHORT_HEX = z.string().regex(/^[a-f0-9]+$/);

export const WsHelloMessage = z.object({
  kind: z.literal('hello'),
  version: z.literal('1.0'),
  sessionId: z.string().min(1),
});
export type WsHelloMessage = z.infer<typeof WsHelloMessage>;

const AttrRangeSchema = z.object({
  attrStart: z.number().int().nonnegative(),
  attrEnd: z.number().int().nonnegative(),
  valueStart: z.number().int().nonnegative(),
  valueEnd: z.number().int().nonnegative(),
  valueKind: z.enum(['string-literal', 'expression']),
}).nullable();

const ElementSourceMapEntrySchema = z.object({
  vid: SHORT_HEX,
  tagName: z.string().min(1),
  nodeStart: z.number().int().nonnegative(),
  nodeEnd: z.number().int().nonnegative(),
  openingTagEnd: z.number().int().nonnegative(),
  classNameAttr: AttrRangeSchema,
  styleAttr: AttrRangeSchema,
  attrsInsertPos: z.number().int().nonnegative(),
});

export const WsSnapshotMessage = z.object({
  kind: z.literal('snapshot'),
  sessionId: z.string().min(1),
  url: z.string().url(),
  status: z.enum(['starting', 'ready', 'crashed', 'closed']),
  filePath: z.string().min(1),
  sourceText: z.string(),
  sourceMap: z.record(SHORT_HEX, ElementSourceMapEntrySchema),
  editorUrl: z.string().url(),
});
export type WsSnapshotMessage = z.infer<typeof WsSnapshotMessage>;

export const WsByeMessage = z.object({
  kind: z.literal('bye'),
  sessionId: z.string().min(1),
});
export type WsByeMessage = z.infer<typeof WsByeMessage>;

const ClassNameEditSchema = z.object({
  kind: z.literal('className'),
  element: SHORT_HEX,
  newValue: z.string(),
});
const StyleEditSchema = z.object({
  kind: z.literal('style'),
  element: SHORT_HEX,
  newObjectText: z.string(),
});
const CssModuleEditSchema = z.object({
  kind: z.literal('css-module'),
  element: SHORT_HEX,
  binding: z.string().min(1),
  newRuleBody: z.string(),
});
const StyledPropEditSchema = z.object({
  kind: z.literal('styled-prop'),
  element: SHORT_HEX,
  newTemplateContent: z.string(),
});
const EditSchema = z.union([ClassNameEditSchema, StyleEditSchema, CssModuleEditSchema, StyledPropEditSchema]);

export const WsEditMessage = z.object({
  kind: z.literal('edit'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  edits: z.array(EditSchema).min(1),
});
export type WsEditMessage = z.infer<typeof WsEditMessage>;

const TextPatchSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  replacement: z.string(),
  reason: z.string(),
});

const DryRunFileSchema = z.object({
  filePath: z.string().min(1),
  patches: z.array(TextPatchSchema),
  beforeHash: HEX_64,
  afterHash: HEX_64,
});

export const WsDryRunMessage = z.object({
  kind: z.literal('dry-run'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  planId: z.string().min(1),
  files: z.array(DryRunFileSchema).min(1),
});
export type WsDryRunMessage = z.infer<typeof WsDryRunMessage>;

export const WsCommitMessage = z.object({
  kind: z.literal('commit'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  planId: z.string().min(1),
});
export type WsCommitMessage = z.infer<typeof WsCommitMessage>;

export const WsCommitOkMessage = z.object({
  kind: z.literal('commit-ok'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  commitId: z.string().min(1),
});
export type WsCommitOkMessage = z.infer<typeof WsCommitOkMessage>;

export const WsCommitUncertainMessage = z.object({
  kind: z.literal('commit-uncertain'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  lastError: z.string(),
});
export type WsCommitUncertainMessage = z.infer<typeof WsCommitUncertainMessage>;

export const WsFileChangedMessage = z.object({
  kind: z.literal('file-changed'),
  sessionId: z.string().min(1),
  filePath: z.string().min(1),
  sha256: HEX_64,
  dirtySourceMap: z.boolean(),
});
export type WsFileChangedMessage = z.infer<typeof WsFileChangedMessage>;

export const WsErrorMessage = z.object({
  kind: z.literal('error'),
  sessionId: z.string().min(1),
  code: z.string().min(1),
  message: z.string(),
  requestId: z.string().optional(),
});
export type WsErrorMessage = z.infer<typeof WsErrorMessage>;

export const WsAskAIMessage = z.object({
  kind: z.literal('ask-ai'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  element: SHORT_HEX,
  prompt: z.string().min(1).max(8192),
});
export type WsAskAIMessage = z.infer<typeof WsAskAIMessage>;

export const WsAskAIQueuedMessage = z.object({
  kind: z.literal('ask-ai-queued'),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  askId: z.string().min(1),
  enqueuedAt: z.string().min(1),
});
export type WsAskAIQueuedMessage = z.infer<typeof WsAskAIQueuedMessage>;

export const WsAskAIResolvedMessage = z.object({
  kind: z.literal('ask-ai-resolved'),
  sessionId: z.string().min(1),
  askId: z.string().min(1),
  outcome: z.enum(['committed', 'rejected', 'failed', 'no-op']),
  summary: z.string(),
  commitId: z.string().optional(),
});
export type WsAskAIResolvedMessage = z.infer<typeof WsAskAIResolvedMessage>;

export const WsConfigChangedMessage = z.object({
  kind: z.literal('config-changed'),
  sessionId: z.string().min(1),
  willRestart: z.boolean(),
});
export type WsConfigChangedMessage = z.infer<typeof WsConfigChangedMessage>;

export const WsPreviewCrashedMessage = z.object({
  kind: z.literal('preview-crashed'),
  sessionId: z.string().min(1),
  reason: z.enum(['heartbeat-stale', 'exit', 'error']),
  willRespawn: z.boolean(),
});
export type WsPreviewCrashedMessage = z.infer<typeof WsPreviewCrashedMessage>;

export const WsMessage = z.union([
  WsHelloMessage,
  WsSnapshotMessage,
  WsByeMessage,
  WsEditMessage,
  WsDryRunMessage,
  WsCommitMessage,
  WsCommitOkMessage,
  WsCommitUncertainMessage,
  WsFileChangedMessage,
  WsErrorMessage,
  WsAskAIMessage,
  WsAskAIQueuedMessage,
  WsAskAIResolvedMessage,
  WsConfigChangedMessage,
  WsPreviewCrashedMessage,
]);
export type WsMessage = z.infer<typeof WsMessage>;

export type ElementSourceMap = z.infer<typeof WsSnapshotMessage>['sourceMap'];
