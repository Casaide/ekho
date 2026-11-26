import EventEmitter from 'bare-events'
import b4a from 'b4a'

// A duplex stand-in for the IRC socket: records what was written, and lets a
// test play the server's side with `serve()`.
export class FakeStream extends EventEmitter {
  lines: string[]
  ended: boolean

  constructor() {
    super()
    this.lines = []
    this.ended = false
  }

  write(data: Uint8Array): boolean {
    for (const line of b4a.toString(data).split('\r\n')) if (line) this.lines.push(line)
    return true
  }

  end(): void {
    this.ended = true
  }

  serve(text: string): void {
    this.emit('data', b4a.from(text))
  }
}

// A bare-meshtastic Client stand-in: records sends, and lets a test play the
// radio's side by emitting its events.
export class FakeRadio extends EventEmitter {
  id: string
  sent: { text: string; opts: { to?: number; id?: number; wantAck?: boolean } }[]

  constructor() {
    super()
    this.id = '!e2f4a910'
    this.sent = []
  }

  send(text: string, opts: { to?: number; id?: number; wantAck?: boolean } = {}): boolean {
    this.sent.push({ text, opts })
    return true
  }
}

export function clock(start = 1000): { now: () => number; tick: (ms: number) => void } {
  let time = start
  return { now: () => time, tick: (ms) => (time += ms) }
}

// A Hypercore stand-in with JSON values, as the feed and outboxes use: kept
// in memory, copied in and out as replication would.
export class FakeLog<T> extends EventEmitter {
  values: string[]

  constructor() {
    super()
    this.values = []
  }

  get length(): number {
    return this.values.length
  }

  async append(value: T): Promise<void> {
    this.values.push(JSON.stringify(value))
    this.emit('append')
  }

  async get(index: number): Promise<T> {
    return JSON.parse(this.values[index])
  }
}

// Let pending promises and the events they lead to settle.
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10))
}
