export function Toggle({ on }: { on: boolean }) {
  return on ? <button className="on">ON</button> : <button className="off">OFF</button>;
}
