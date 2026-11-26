import EventEmitter from 'bare-events'
import type Messenger from './messenger.ts'
import type { Status } from './messenger.ts'
import type { Command, Contact, Message } from './types.ts'
import type { Log } from './mirror.ts'

// What goes in the feed, in order: the whole state first, then each change.
// Each carries the next message number, so numbering carries on from the
// feed after a restart, even if the state saved on disk is older.
export type Entry = { next?: number } & (
  | { type: 'state'; state: ReturnType<Messenger['toJSON']>; status: Status }
  | { type: 'message'; contact: Contact; msg: Message }
  | { type: 'update'; msg: Message }
  | { type: 'contacts'; contacts: Contact[] }
  | { type: 'status'; status: Status }
)

// On the device holding the radio and IRC: everything the Messenger does goes
// into a feed that linked devices replicate, and what they ask for, in an
// outbox of their own each, is done here. Each message gets a number, its
// `ref`, by which both sides name it.
//
// Events: done (key, index), once a device's outbox has been read that far.
export default class Hub extends EventEmitter {
  messenger: Messenger
  feed: Log<Entry>

  _next: number
  // The linked device's own number for the message being sent for it.
  _local: number | null
  _status: string
  _tail: Promise<unknown>
  _listeners: [string, (...args: any[]) => void][]

  constructor(messenger: Messenger, feed: Log<Entry>) {
    super()
    this.messenger = messenger
    this.feed = feed

    this._next = 1
    this._local = null
    this._status = ''
    this._tail = Promise.resolve()

    this._listeners = [
      [
        'message',
        (msg: Message, contact: Contact) => {
          const local = this._local
          this._number(msg)
          this._append({
            type: 'message',
            contact,
            msg: local === null ? { ...msg } : { ...msg, local }
          })
        }
      ],
      [
        'update',
        (msg: Message) => {
          this._number(msg)
          this._append({ type: 'update', msg: { ...msg } })
        }
      ],
      ['contacts', () => this._append({ type: 'contacts', contacts: messenger.contacts.all() })],
      ['status', () => this._appendStatus()]
    ]
    for (const [name, fn] of this._listeners) messenger.on(name, fn)
  }

  // Stop writing the feed: this device is linking to another instead.
  close(): void {
    for (const [name, fn] of this._listeners) this.messenger.off(name, fn)
  }

  // Number what isn't yet, and start the feed with the whole state if it's
  // new or messages came from before it.
  async ready(): Promise<unknown> {
    if (this.feed.length > 0) {
      const last = await this.feed.get(this.feed.length - 1)
      this._next = Math.max(this._next, last.next ?? 1)
    }
    let unnumbered = false
    for (const contact of this.messenger.contacts.all()) {
      for (const msg of this.messenger.thread(contact)) {
        if (msg.ref === undefined) unnumbered = true
        else this._next = Math.max(this._next, msg.ref + 1)
      }
    }
    if (this.feed.length === 0 || unnumbered) {
      for (const contact of this.messenger.contacts.all()) {
        for (const msg of this.messenger.thread(contact)) this._number(msg)
      }
      const status = this.messenger.status()
      this._status = JSON.stringify(status)
      this._append({ type: 'state', state: this.messenger.toJSON(), status })
    }
    return this.flushed()
  }

  flushed(): Promise<unknown> {
    return this._tail
  }

  // Read a linked device's outbox from `done`, now and as it grows.
  follow(outbox: Log<Command>, key: string, done = 0): void {
    let reading = false
    const read = async () => {
      if (reading) return
      reading = true
      while (done < outbox.length) {
        const command = await outbox.get(done)
        done++
        this.run(command)
        this.emit('done', key, done)
      }
      reading = false
    }
    outbox.on('append', read)
    read()
  }

  run(command: Command): void {
    const { messenger } = this
    if (command.type === 'send') {
      const contact = messenger.contacts.get(command.contact)
      if (contact === null) return
      this._local = command.local
      messenger.send(contact, command.text, command.via === null ? {} : { via: command.via })
      this._local = null
      return
    }
    const msg = this._find(command.ref)
    if (msg === null) return
    if (command.type === 'retry') messenger.retry(msg)
    else messenger.sendViaIrc(msg)
  }

  _find(ref: number): Message | null {
    for (const contact of this.messenger.contacts.all()) {
      const msg = this.messenger.thread(contact).find((m) => m.ref === ref)
      if (msg !== undefined) return msg
    }
    return null
  }

  _number(msg: Message): void {
    if (msg.ref === undefined) msg.ref = this._next++
  }

  _appendStatus(): void {
    const status = this.messenger.status()
    const json = JSON.stringify(status)
    if (json === this._status) return
    this._status = json
    this._append({ type: 'status', status })
  }

  // In order: each append waits for the one before.
  _append(entry: Entry): void {
    entry.next = this._next
    this._tail = this._tail.then(() => this.feed.append(entry))
  }
}
