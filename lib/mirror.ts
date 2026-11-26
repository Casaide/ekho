import EventEmitter from 'bare-events'
import type Messenger from './messenger.ts'
import { FORMAT } from './hub.ts'
import type { Entry } from './hub.ts'
import type { Command } from './types.ts'

// The slice of a Hypercore with JSON values that the feed and outboxes use.
export interface Log<T> {
  readonly length: number
  append(value: T): Promise<unknown>
  get(index: number): Promise<T>
  on(event: 'append', listener: () => void): unknown
}

// On a linked device: the Messenger shows what the hub's feed says, and what
// the user sends goes into this device's outbox for the hub to do.
//
// Events: applied (index), once the feed has been applied that far; synced,
// once a whole state from the hub has been applied; around (around), with
// what the hub sees around it (lib/hub.ts); newer,
// when the feed comes from a newer ekho, and applying stops there.
export default class Mirror extends EventEmitter {
  messenger: Messenger
  feed: Log<Entry>
  outbox: Log<Command>
  applied: number

  _applying: boolean
  _tail: Promise<unknown>

  constructor(
    messenger: Messenger,
    feed: Log<Entry>,
    outbox: Log<Command>,
    opts: { applied?: number } = {}
  ) {
    super()
    this.messenger = messenger
    this.feed = feed
    this.outbox = outbox
    this.applied = opts.applied ?? 0

    this._applying = false
    this._tail = Promise.resolve()

    messenger.relay = (command: Command) => {
      this._tail = this._tail.then(() => outbox.append(command))
    }
    feed.on('append', () => this.update())
  }

  // Apply what's new in the feed. Resolves once caught up.
  async update(): Promise<void> {
    if (this._applying) return
    this._applying = true
    while (this.applied < this.feed.length) {
      const entry = await this.feed.get(this.applied)
      if ((entry.format ?? FORMAT) > FORMAT) {
        this.emit('newer')
        break
      }
      this._apply(entry)
      this.applied++
      this.emit('applied', this.applied)
    }
    this._applying = false
  }

  flushed(): Promise<unknown> {
    return this._tail
  }

  // Ask the hub for its whole state: it comes back through the feed.
  sync(): void {
    this.messenger.relay!({ type: 'state' })
  }

  // Back to a device of its own: sends go out its own radio and IRC again.
  close(): void {
    this.messenger.relay = null
    this.messenger.setRemote(null)
  }

  _apply(entry: Entry): void {
    const { messenger } = this
    if (entry.type === 'state') {
      messenger.adopt(entry.state)
      messenger.setRemote(entry.status)
      this.emit('synced')
    } else if (entry.type === 'message') {
      messenger.receive(entry.contact, entry.msg)
    } else if (entry.type === 'update') {
      messenger.change(entry.msg)
    } else if (entry.type === 'contacts') {
      messenger.setContacts(entry.contacts)
    } else if (entry.type === 'around') {
      messenger.setRadioChannels(entry.around.radioChannels)
      this.emit('around', entry.around)
    } else {
      messenger.setRemote(entry.status)
    }
  }
}
