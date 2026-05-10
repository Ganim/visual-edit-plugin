import { afterEach } from 'vitest';
import { vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import React from 'react';

// Clean up the DOM after every test so renders don't accumulate.
afterEach(() => cleanup());

// Mock react-color's SketchPicker — jsdom has no HTMLCanvasElement.getContext support.
vi.mock('react-color', () => ({
  SketchPicker: ({ color, onChange }: { color: string; onChange: (c: { hex: string }) => void }) =>
    React.createElement('div', { 'data-testid': 'sketch-picker', 'data-color': color },
      React.createElement('button', {
        onClick: () => onChange({ hex: '#ff0000' }),
      }, 'pick')
    ),
}));
