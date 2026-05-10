import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/state.js';

beforeEach(() => useStore.setState(useStore.getInitialState()));

describe('ask-ai state', () => {
  it('addAskAiItem inserts a pending item', () => {
    useStore.getState().addAskAiItem({ askId: 'a1', element: 'v1', prompt: 'p', enqueuedAt: 't', state: 'pending' });
    expect(useStore.getState().askAiItems['a1']?.state).toBe('pending');
  });

  it('updateAskAiResolved transitions to resolved with outcome', () => {
    useStore.getState().addAskAiItem({ askId: 'a1', element: 'v1', prompt: 'p', enqueuedAt: 't', state: 'pending' });
    useStore.getState().updateAskAiResolved('a1', { outcome: 'committed', summary: 'ok', commitId: 'c1' });
    const it = useStore.getState().askAiItems['a1']!;
    expect(it.state).toBe('resolved');
    expect(it.outcome).toBe('committed');
  });
});
