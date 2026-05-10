import { create } from 'zustand';
import type { ElementSourceMap } from '@visual-edit/protocol';

export interface Rect { x: number; y: number; width: number; height: number; }

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
}));
