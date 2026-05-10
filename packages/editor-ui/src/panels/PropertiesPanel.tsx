import { useEffect, useState } from 'react';
import { SketchPicker } from 'react-color';
import { useStore } from '../state.js';
import type { WsClient } from '../wsClient.js';

interface Props { client: Pick<WsClient, 'sendEdit' | 'sendCommit'>; }

export function PropertiesPanel({ client }: Props): JSX.Element {
  const selectedVid = useStore((s) => s.selectedVid);
  const sourceMap = useStore((s) => s.sourceMap);
  const sourceText = useStore((s) => s.sourceText);
  const pendingDryRun = useStore((s) => s.pendingDryRun);

  const [className, setClassName] = useState('');
  const [color, setColor] = useState<string>('#000000');
  const [padding, setPadding] = useState<{ t: number; r: number; b: number; l: number }>({ t: 0, r: 0, b: 0, l: 0 });

  // Initialize panel from current source whenever selection changes.
  useEffect(() => {
    if (!selectedVid) return;
    const entry = sourceMap[selectedVid];
    if (!entry) return;
    if (entry.classNameAttr && entry.classNameAttr.valueKind === 'string-literal') {
      setClassName(sourceText.slice(entry.classNameAttr.valueStart, entry.classNameAttr.valueEnd));
    } else {
      setClassName('');
    }
  }, [selectedVid, sourceMap, sourceText]);

  // Ctrl+S → commit if there's a dry-run.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (pendingDryRun) client.sendCommit(pendingDryRun.planId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDryRun, client]);

  if (!selectedVid) {
    return <aside className="w-72 p-4 border-l border-neutral-700 text-sm text-neutral-400">Select an element</aside>;
  }

  const sendClassNameEdit = () => client.sendEdit([{ kind: 'className', element: selectedVid, newValue: className }]);
  const sendStyleEdit = () => {
    const obj = `{ color: '${color}', paddingTop: ${padding.t}, paddingRight: ${padding.r}, paddingBottom: ${padding.b}, paddingLeft: ${padding.l} }`;
    client.sendEdit([{ kind: 'style', element: selectedVid, newObjectText: obj }]);
  };

  return (
    <aside className="w-72 p-4 border-l border-neutral-700 text-sm space-y-4 bg-neutral-900 text-neutral-100">
      <div>
        <div className="font-semibold mb-1">className</div>
        <input
          data-testid="classname-input"
          className="w-full px-2 py-1 bg-neutral-800 border border-neutral-700 rounded"
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendClassNameEdit()}
        />
        <button
          data-testid="apply-className"
          className="mt-2 w-full px-2 py-1 bg-blue-600 rounded"
          onClick={sendClassNameEdit}
        >
          Apply (Enter)
        </button>
      </div>

      <div>
        <div className="font-semibold mb-1">color</div>
        <SketchPicker color={color} onChange={(c) => setColor(c.hex)} disableAlpha presetColors={[]} />
      </div>

      <div>
        <div className="font-semibold mb-1">padding (T/R/B/L)</div>
        <div className="grid grid-cols-4 gap-1">
          {(['t', 'r', 'b', 'l'] as const).map((k) => (
            <input
              key={k}
              type="number"
              className="px-1 py-1 bg-neutral-800 border border-neutral-700 rounded"
              value={padding[k]}
              onChange={(e) => setPadding({ ...padding, [k]: Number(e.target.value) })}
            />
          ))}
        </div>
        <button
          data-testid="apply-style"
          className="mt-2 w-full px-2 py-1 bg-blue-600 rounded"
          onClick={sendStyleEdit}
        >
          Apply style
        </button>
      </div>

      {pendingDryRun && (
        <div className="text-xs text-amber-400">dry-run ready (Ctrl+S to commit)</div>
      )}
    </aside>
  );
}
