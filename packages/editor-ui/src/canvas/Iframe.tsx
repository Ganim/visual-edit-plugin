import { useEffect, useRef } from 'react';
import { useStore } from '../state.js';

export function Iframe(): JSX.Element {
  const url = useStore((s) => s.url);
  const setRects = useStore((s) => s.setRects);
  const ref = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; rects?: Record<string, { x: number; y: number; width: number; height: number }> };
      if (data?.type === 've-rects' && data.rects) setRects(data.rects);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setRects]);

  if (!url) return <div className="p-4 text-neutral-400">waiting for snapshot…</div>;
  return (
    <iframe
      ref={ref}
      src={url}
      className="w-full h-full border-0 bg-white"
      title="preview"
    />
  );
}
