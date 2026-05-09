function logged(target: unknown, _ctx: unknown) { return target; }

@logged
class Card {
  render() {
    return <div className="card">decorated</div>;
  }
}
