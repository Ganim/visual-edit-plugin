import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PropertiesPanel } from '../src/panels/PropertiesPanel.js';
import { useStore } from '../src/state.js';

describe('PropertiesPanel', () => {
  it('renders className input only when an element is selected', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: null });
    const send = { sendEdit: vi.fn(() => 'r1'), sendCommit: vi.fn(() => 'r2'), close: vi.fn() };
    render(<PropertiesPanel client={send} />);
    expect(screen.queryByTestId('classname-input')).toBeNull();

    cleanup();
    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345' });
    render(<PropertiesPanel client={send} />);
    expect(screen.queryByTestId('classname-input')).not.toBeNull();
  });

  it('Apply button sends an edit message with current className', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345' });
    const send = { sendEdit: vi.fn(() => 'r1'), sendCommit: vi.fn(() => 'r2'), close: vi.fn() };
    render(<PropertiesPanel client={send} />);
    const input = screen.getByTestId('classname-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'text-red-500' } });
    fireEvent.click(screen.getByTestId('apply-className'));
    expect(send.sendEdit).toHaveBeenCalledWith([{ kind: 'className', element: 'abc12345', newValue: 'text-red-500' }]);
  });

  it('Ctrl+S triggers commit when there is a pending dry-run', () => {
    useStore.setState({ ...useStore.getInitialState(), selectedVid: 'abc12345', pendingDryRun: { planId: 'p1', afterHash: 'a'.repeat(64) } });
    const send = { sendEdit: vi.fn(() => 'r1'), sendCommit: vi.fn(() => 'r2'), close: vi.fn() };
    render(<PropertiesPanel client={send} />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(send.sendCommit).toHaveBeenCalledWith('p1');
  });
});
