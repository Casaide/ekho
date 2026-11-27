import EventEmitter from 'bare-events'
import type Messenger from './messenger.ts'
import type { Status } from './messenger.ts'
import type { Command, Contact, Message } from './types.ts'
import type { Log } from './mirror.ts'
import type { Seen } from './presence.ts'
import type { Whois } from './irc.ts'

// The feed's format: entries carry it, so a device reading a feed from a
// newer ekho stops instead of guessing at what it doesn't know.
// 2 added `around`, which a device reading format 1 would take for a status.
// 3 added `whois`.
export const FORMAT = 3

// What the phone sees around it, beyond the conversations: its radio's
// channels, the server's channel list, who it is, the nodes it knows with
// when each was last heard, and who's in each IRC channel.
export interface Around extends Seen {
  radioChannels: { index: number; name: string | null; role: number }[]
  server: { name: string; users: number; topic: string }[] | null
  heard: Record<string, number>
}

// What goes in the feed, in order: the whole state first, then each change.
// Each carries the next message number, so numbering carries on from the
// feed after a restart, even if the state saved on disk is older.
export type Entry = { format?: number; next?: number } & (
  | { type: 'state'; state: ReturnType<Messenger['toJSON']>; status: Status }
  | { type: 'message'; contact: Contact; msg: Message }
  | { type: 'update'; msg: Message }
  | { type: 'contacts'; contacts: Contact[] }
  | { type: 'status'; status: Status }
  | { type: 'around'; around: Around }
  | { type: 'whois'; nick: string; info: Whois | null }
)

// On the device holding the radio and IRC: everything the Messenger does goes
// into a feed that linked devices replicate, and what they ask for, in an
// outbox of their own each, is done here. Each message gets a number, its
// `ref`, by which both sides name it.
//
// Events: done (key, index), once a device's outbox has been read that far;
// channel (name, join), when a linked device joins or leaves an IRC channel.
export default class Hub extends EventEmitter {
  messenger: Messenger
  feed: Log<Entry>
  // At most one `around` per this many milliseconds: IRC joins and parts in
  // a busy channel would otherwise fill the feed.
  every: number

  _next: number
  // The linked device's own number for the message being sent for it.
  _local: number | null
  _status: string
  _tail: Promise<unknown>
  _listeners: [string, (...args: any[]) => void][]
  _around: Around | null
  _aroundJson: string
  _aroundAt: number
  _aroundTimer: ReturnType<typeof setTimeout> | null

  constructor(messenger: Messenger, feed: Log<Entry>, opts: { every?: number } = {}) {
    super()
    this.messenger = messenger
    this.feed = feed
    this.every = opts.every ?? 15_000

    this._next = 1
    this._local = null
    this._status = ''
    this._tail = Promise.resolve()
    this._around = null
    this._aroundJson = ''
    this._aroundAt = 0
    this._aroundTimer = null

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
    if (this._aroundTimer !== null) clearTimeout(this._aroundTimer)
  }

  // What's around changed: written now, or once `every` has passed since the
  // last, and only if it differs from what was written.
  around(value: Around): void {
    this._around = value
    if (this._aroundTimer !== null) return
    const wait = this._aroundAt + this.every - Date.now()
    if (wait <= 0) return this._appendAround()
    this._aroundTimer = setTimeout(() => {
      this._aroundTimer = null
      this._appendAround()
    }, wait)
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
    if (this.feed.length === 0 || unnumbered) this.snapshot()
    return this.flushed()
  }

  // The whole state, as it is now: a linked device applying it has every
  // conversation, whatever it missed. Written when the feed starts, when a
  // device links, and when one asks.
  snapshot(): void {
    for (const contact of this.messenger.contacts.all()) {
      for (const msg of this.messenger.thread(contact)) this._number(msg)
    }
    const status = this.messenger.status()
    this._status = JSON.stringify(status)
    this._append({ type: 'state', state: this.messenger.toJSON(), status })
    if (this._around !== null) this._append({ type: 'around', around: this._around })
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

  // A linked device's request. From another device's core, so checked:
  // anything that isn't one is skipped.
  run(command: Command): void {
    if (!valid(command)) return
    if (command.type === 'state') return this.snapshot()
    if (command.type === 'channel') {
      this.emit('channel', command.name, command.join)
      return
    }
    if (command.type === 'whois') return this._whois(command.nick)
    const { messenger } = this
    if (command.type === 'send') {
      const contact = messenger.contacts.get(command.contact)
      if (contact === null) return
      this._local = command.local
      messenger.send(contact, command.text, {
        ...(command.via === null ? {} : { via: command.via }),
        ...(command.action === true ? { action: true } : {})
      })
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

  // Asked of our IRC, the answer into the feed; nothing without IRC.
  _whois(nick: string): void {
    const irc = this.messenger.irc
    if (irc === null || !irc.ready) return this._append({ type: 'whois', nick, info: null })
    const wanted = nick.toLowerCase()
    const answer = (got: string, info: Whois | null) => {
      if (got.toLowerCase() !== wanted) return
      irc.off('whois', answer)
      this._append({ type: 'whois', nick, info })
    }
    irc.on('whois', answer)
    irc.whois(nick)
  }

  _appendAround(): void {
    const json = JSON.stringify(this._around)
    if (json === this._aroundJson) return
    this._aroundJson = json
    this._aroundAt = Date.now()
    this._append({ type: 'around', around: this._around! })
  }

  // In order: each append waits for the one before.
  _append(entry: Entry): void {
    entry.format = FORMAT
    entry.next = this._next
    this._tail = this._tail.then(() => this.feed.append(entry))
  }
}

function valid(command: any): boolean {
  if (command?.type === 'send') {
    return (
      Number.isInteger(command.local) &&
      typeof command.contact === 'string' &&
      typeof command.text === 'string' &&
      command.text.length <= 1000 &&
      (command.via === null || command.via === 'lora' || command.via === 'irc') &&
      (command.action === undefined || typeof command.action === 'boolean')
    )
  }
  if (command?.type === 'whois') {
    return typeof command.nick === 'string' && /^[^\s,]{1,30}$/.test(command.nick)
  }
  if (command?.type === 'retry' || command?.type === 'irc') return Number.isInteger(command.ref)
  if (command?.type === 'state') return true
  if (command?.type === 'channel') {
    return (
      typeof command.name === 'string' &&
      /^#[^\s,]{1,49}$/.test(command.name) &&
      typeof command.join === 'boolean'
    )
  }
  return false
}
