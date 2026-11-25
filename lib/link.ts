import EventEmitter from 'bare-events'

export type LinkState = 'off' | 'connecting' | 'on' | 'waiting' | 'failed'

// What an open connection gives back: a way to close it, and word when it
// closes by itself.
export interface Connection {
  close(): void
  on(event: 'close', fn: () => void): unknown
}

// A failure only the user can fix (a wrong password, Bluetooth blocked):
// retrying would fail the same way, so the link stops and says so.
export class FatalError extends Error {
  fatal: boolean

  constructor(message: string) {
    super(message)
    this.fatal = true
  }
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
}

const RETRY = [5_000, 15_000, 60_000]

// One connection that should stay up while it's wanted: the radio, or IRC.
// It holds the single state the screen shows, and does the retrying.
//
// `connect` opens a connection, reporting progress through `detail`, and
// resolves once it's usable. Rejecting with a FatalError stops the link;
// any other rejection, or a close nobody asked for, retries after 5 s, 15 s,
// then every minute.
//
// Events: change (when state or detail change).
export default class Link<C extends Connection = Connection> extends EventEmitter {
  name: string
  state: LinkState
  detail: string
  wanted: boolean
  connection: C | null
  retry: number[]
  timers: Timers

  _connect: (detail: (text: string) => void) => Promise<C>
  _attempt: number
  _failures: number
  _timer: unknown
  _paused: boolean

  constructor(
    name: string,
    connect: (detail: (text: string) => void) => Promise<C>,
    opts: { retry?: number[]; timers?: Timers } = {}
  ) {
    super()

    this.name = name
    this.state = 'off'
    this.detail = ''
    this.wanted = false
    this.connection = null
    this.retry = opts.retry ?? RETRY
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
    }

    this._connect = connect
    this._attempt = 0
    this._failures = 0
    this._timer = null
    this._paused = false
  }

  // Want the connection up, and keep it up. Starting again while connecting
  // or connected does nothing; from `waiting` or `failed` it tries now.
  start(): void {
    this.wanted = true
    if (this.state === 'connecting' || this.state === 'on') return
    this._failures = 0
    this._open()
  }

  // No longer wanted: close it, and stop retrying.
  stop(): void {
    this.wanted = false
    this._close()
    this._set('off', '')
  }

  // Close for now, as when Android pauses the app, but keep wanting it.
  pause(): void {
    if (this._paused) return
    this._paused = true
    this._close()
    if (this.wanted) this._set('off', 'paused')
  }

  // Back from a pause: reconnect if it's wanted.
  resume(): void {
    if (!this._paused) return
    this._paused = false
    if (this.wanted) {
      this._failures = 0
      this._open()
    }
  }

  _open(): void {
    this._cancelRetry()
    const attempt = ++this._attempt
    this._set('connecting', '')

    this._connect((text) => {
      if (attempt === this._attempt) this._set('connecting', text)
    }).then(
      (connection) => {
        // Stopped, paused or restarted while this was opening.
        if (attempt !== this._attempt) return connection.close()

        this.connection = connection
        this._failures = 0
        this._set('on', '')

        connection.on('close', () => {
          if (this.connection !== connection) return
          this.connection = null
          this._dropped('connection closed')
        })
      },
      (err: Error & { fatal?: boolean }) => {
        if (attempt !== this._attempt) return
        if (err.fatal) return this._set('failed', err.message)
        this._dropped(err.message)
      }
    )
  }

  _dropped(reason: string): void {
    if (!this.wanted || this._paused) return this._set('off', '')

    const wait = this.retry[Math.min(this._failures++, this.retry.length - 1)]
    this._set('waiting', reason + ', retrying in ' + Math.round(wait / 1000) + ' s')
    this._timer = this.timers.setTimeout(() => {
      this._timer = null
      this._open()
    }, wait)
  }

  _close(): void {
    this._cancelRetry()
    this._attempt++
    const connection = this.connection
    this.connection = null
    if (connection !== null) connection.close()
  }

  _cancelRetry(): void {
    if (this._timer !== null) this.timers.clearTimeout(this._timer)
    this._timer = null
  }

  _set(state: LinkState, detail: string): void {
    if (state === this.state && detail === this.detail) return
    this.state = state
    this.detail = detail
    this.emit('change')
  }
}
