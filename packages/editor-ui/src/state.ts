import { create } from 'zustand';
import type { ElementSourceMap } from '@visual-edit/protocol';

export interface Rect { x: number; y: number; width: number; height: number; }

export interface AskAiItemUI {
  askId: string;
  element: string;
  prompt: string;
  enqueuedAt: string;
  state: 'pending' | 'leased' | 'resolved';
  outcome?: 'committed' | 'rejected' | 'failed' | 'no-op';
  summary?: string;
  commitId?: string;
}

export interface EditorState {
  // Connection
  status: 'connecting' | 'ready' | 'stale' | 'disconnected';
  sessionId: string | null;
  // Snapshot
  url: string | null;
  filePath: string | null;
  sourceText: string;
  sourceMap: ElementSourceMap;
  // Selection + bridge
  selectedVid: string | null;
  rects: Record<string, Rect>;
  // Edits
  pendingDryRun: { planId: string; afterHash: string } | null;
  staleSnapshot: boolean;
  lastError: string | null;
  // Ask-AI
  askAiItems: Record<string, AskAiItemUI>;
  // Mutators
  setSnapshot: (s: { url: string; filePath: string; sourceText: string; sourceMap: ElementSourceMap; sessionId?: string }) => void;
  selectVid: (vid: string | null) => void;
  setRect: (vid: string, rect: Rect) => void;
  setRects: (rects: Record<string, Rect>) => void;
  setDryRun: (planId: string, afterHash: string) => void;
  clearDryRun: () => void;
  markStale: (sha256: string) => void;
  setError: (msg: string) => void;
  setStatus: (s: EditorState['status']) => void;
  addAskAiItem: (item: AskAiItemUI) => void;
  replaceAskAiItem: (oldKey: string, newItem: AskAiItemUI) => void;
  updateAskAiResolved: (askId: string, fields: { outcome: AskAiItemUI['outcome']; summary?: string; commitId?: string }) => void;
}

export const useStore = create<EditorState>()((set) => ({
  status: 'connecting',
  sessionId: null,
  url: null,
  filePath: null,
  sourceText: '',
  sourceMap: {},
  selectedVid: null,
  rects: {},
  pendingDryRun: null,
  staleSnapshot: false,
  lastError: null,
  askAiItems: {},
  setSnapshot: (s) => set({
    url: s.url,
    filePath: s.filePath,
    sourceText: s.sourceText,
    sourceMap: s.sourceMap,
    status: 'ready',
    staleSnapshot: false,
    ...(s.sessionId !== undefined ? { sessionId: s.sessionId } : {}),
  }),
  selectVid: (vid) => set({ selectedVid: vid }),
  setRect: (vid, rect) => set((st) => ({ rects: { ...st.rects, [vid]: rect } })),
  setRects: (rects) => set({ rects }),
  setDryRun: (planId, afterHash) => set({ pendingDryRun: { planId, afterHash } }),
  clearDryRun: () => set({ pendingDryRun: null }),
  markStale: (_sha256) => set({ staleSnapshot: true, status: 'stale' }),
  setError: (msg) => set({ lastError: msg }),
  setStatus: (status) => set({ status }),
  addAskAiItem: (item) => set((s) => ({ askAiItems: { ...s.askAiItems, [item.askId]: item } })),
  replaceAskAiItem: (oldKey, newItem) => set((s) => {
    const next = { ...s.askAiItems };
    delete next[oldKey];
    next[newItem.askId] = newItem;
    return { askAiItems: next };
  }),
  updateAskAiResolved: (askId, fields) => set((s) => {
    const cur = s.askAiItems[askId];
    if (!cur) return s;
    const updated: AskAiItemUI = { ...cur, state: 'resolved' as const };
    if (fields.outcome !== undefined) updated.outcome = fields.outcome;
    if (fields.summary !== undefined) updated.summary = fields.summary;
    if (fields.commitId !== undefined) updated.commitId = fields.commitId;
    return { askAiItems: { ...s.askAiItems, [askId]: updated } };
  }),
}));
