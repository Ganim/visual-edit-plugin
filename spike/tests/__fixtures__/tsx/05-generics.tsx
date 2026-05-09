function Box<T extends string>(props: { value: T }) {
  return <div className="box">{props.value}</div>;
}

export function App() {
  return <Box<'a'> value="a" />;
}
