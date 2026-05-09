const props = { a: 1 } satisfies Record<string, number>;

export function Tag() {
  return <span className="tag" data-x={props.a}>tag</span>;
}
