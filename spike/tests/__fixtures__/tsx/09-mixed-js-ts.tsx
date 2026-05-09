// @ts-expect-error — intentional
const untyped: any = {};

export function Mixed() {
  // @ts-ignore
  const v: number = untyped.x;
  return <div className="mixed" data-v={v}>{v}</div>;
}
