import type { ReactNode } from 'react';
import { type CSSProperties } from 'react';

export function Card({ children, sx }: { children: ReactNode; sx?: CSSProperties }) {
  return <article className="card" style={sx}>{children}</article>;
}
