// When each node was last heard on LoRa. Any packet counts - a message,
// position or telemetry - not just node info, which a radio only broadcasts
// every few hours.
export default class Heard {
  window: number
  now: () => number

  _last: Map<string, number>

  constructor(opts: { window?: number; now?: () => number } = {}) {
    this.window = opts.window ?? 15 * 60 * 1000
    this.now = opts.now ?? Date.now

    this._last = new Map()
  }

  mark(node: string, at = this.now()): void {
    this._last.set(node, at)
  }

  // When each node was last heard, as times.
  toJSON(): Record<string, number> {
    return Object.fromEntries(this._last)
  }

  // Milliseconds since `node` was heard, or `Infinity` if never.
  since(node: string): number {
    const last = this._last.get(node)
    return last === undefined ? Infinity : this.now() - last
  }

  recent(node: string): boolean {
    return this.since(node) <= this.window
  }

  // How many nodes were heard inside the window.
  count(): number {
    let n = 0
    for (const node of this._last.keys()) if (this.recent(node)) n++
    return n
  }

  any(): boolean {
    return this.count() > 0
  }
}
