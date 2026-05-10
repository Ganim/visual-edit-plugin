import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AiPromptPanel } from '../src/panels/AiPromptPanel.js';
import { useStore } from '../src/state.js';

describe('AiPromptPanel', () => {
  it('Ask AI button is disabled until a vid is selected and prompt is non-empty', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: null });
    const send = { sendAskAI: vi.fn(() => 'r1') } as never;
    render(<AiPromptPanel client={send} />);
    const btn = screen.getByTestId('ask-ai-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    cleanup();

    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345' });
    render(<AiPromptPanel client={send} />);
    const input = screen.getByTestId('ask-ai-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'make it red' } });
    expect((screen.getByTestId('ask-ai-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Submit calls sendAskAI with selected vid + prompt and stages a pending item', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345' });
    const send = { sendAskAI: vi.fn(() => 'r1') } as never;
    render(<AiPromptPanel client={send} />);
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'do it' } });
    fireEvent.click(screen.getByTestId('ask-ai-btn'));
    expect(send.sendAskAI).toHaveBeenCalledWith('abc12345', 'do it');
  });

  it('renders status badges for queued items', () => {
    useStore.setState({
      ...useStore.getInitialState(),
      askAiItems: {
        a1: { askId: 'a1', element: 'v1', prompt: 'p', enqueuedAt: 't', state: 'pending' },
        a2: { askId: 'a2', element: 'v2', prompt: 'q', enqueuedAt: 't', state: 'resolved', outcome: 'committed', summary: 'ok' },
      },
    });
    const send = { sendAskAI: vi.fn() } as never;
    render(<AiPromptPanel client={send} />);
    expect(screen.getAllByTestId(/^askai-item-/)).toHaveLength(2);
  });
});
