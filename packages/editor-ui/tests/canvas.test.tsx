import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Overlay } from '../src/canvas/Overlay.js';
import { useStore } from '../src/state.js';

describe('Overlay', () => {
  it('renders one rect div per known vid', () => {
    useStore.setState({
      ...useStore.getInitialState(),
      sourceMap: { abc12345: { vid: 'abc12345', tagName: 'div', nodeStart: 0, nodeEnd: 1, openingTagEnd: 1, classNameAttr: null, styleAttr: null, attrsInsertPos: 1 } },
      rects: { abc12345: { x: 10, y: 10, width: 100, height: 50 } },
    });
    const { container } = render(<Overlay />);
    expect(container.querySelectorAll('[data-vid-overlay]')).toHaveLength(1);
  });
});
