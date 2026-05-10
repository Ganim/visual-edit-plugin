import { useStore } from '../state.js';

export function Overlay(): JSX.Element {
  const rects = useStore((s) => s.rects);
  const sourceMap = useStore((s) => s.sourceMap);
  const selectedVid = useStore((s) => s.selectedVid);
  const selectVid = useStore((s) => s.selectVid);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {Object.entries(sourceMap).map(([vid]) => {
        const r = rects[vid];
        if (!r) return null;
        const isSelected = selectedVid === vid;
        return (
          <div
            key={vid}
            data-vid-overlay={vid}
            onClick={(e) => { e.stopPropagation(); selectVid(vid); }}
            className={`absolute pointer-events-auto cursor-pointer ${isSelected ? 'border-2 border-blue-500' : 'border border-blue-300/40 hover:border-blue-400'}`}
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          />
        );
      })}
    </div>
  );
}
