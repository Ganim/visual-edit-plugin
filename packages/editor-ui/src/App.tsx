import { Iframe } from './canvas/Iframe.js';
import { Overlay } from './canvas/Overlay.js';

export function App(): JSX.Element {
  return (
    <div className="flex h-screen">
      <div className="flex-1 relative">
        <Iframe />
        <Overlay />
      </div>
    </div>
  );
}
