import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/state.js';

beforeEach(() => useStore.setState(useStore.getInitialState()));

describe('editor state', () => {
  it('selectVid sets selectedVid', () => {
    useStore.getState().selectVid('abc12345');
    expect(useStore.getState().selectedVid).toBe('abc12345');
  });

  it('setSnapshot stores sourceText, sourceMap, previewUrl, filePath', () => {
    useStore.getState().setSnapshot({
      url: 'http://x',
      filePath: '/p.tsx',
      sourceText: 'src',
      sourceMap: { abc12345: { vid: 'abc12345', tagName: 'div', nodeStart: 0, nodeEnd: 1, openingTagEnd: 1, classNameAttr: null, styleAttr: null, attrsInsertPos: 1 } },
    });
    expect(useStore.getState().filePath).toBe('/p.tsx');
    expect(Object.keys(useStore.getState().sourceMap)).toContain('abc12345');
  });

  it('setRect stores per-vid rect from bridge messages', () => {
    useStore.getState().setRect('abc12345', { x: 10, y: 20, width: 100, height: 50 });
    expect(useStore.getState().rects['abc12345']).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('markStale sets staleSnapshot=true on file-changed', () => {
    useStore.getState().markStale('a'.repeat(64));
    expect(useStore.getState().staleSnapshot).toBe(true);
  });
});
