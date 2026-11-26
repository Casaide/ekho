import EventEmitter from 'bare-events'
import Contacts, { type Address, type ContactEntry } from './contacts.ts'
import Heard from './heard.ts'
import type Irc from './irc.ts'
import type { Contact, IrcMessage, Message, Radio, RadioAck, RadioMessage, Via } from './types.ts'

export interface MessengerOptions {
  contacts?: Contacts
  heard?: Heard
  now?: () => number
  // Our own node ID, added to IRC messages so people can tell it's us. A hint,
  // not proof: anyone on IRC can type it.
  node?: string | null
  channelName?: string
  // The IRC channel the community bridge mirrors the mesh channel to.
  ircChannel?: string
  // Other bridged IRC channels joined, such as regional ones. IRC only.
  ircChannels?: string[]
  // What toJSON() returned last run: contacts and threads.
  state?: SavedState | null
  // Messages kept per thread when saving.
  keep?: number
}

export interface SavedState {
  contacts: Contact[]
  threads: Record<string, Message[]>
  // The last message read in each conversation; missing in older state.
  read?: Record<string, number>
}

export interface Status {
  radio: boolean
  irc: boolean
  heard: number
  route: Via
}

// The core of ekho: one thread per person, LoRa first, IRC when no LoRa node
// has been heard. The radio is a bare-meshtastic Client and the IRC side an
// Irc; either is attached when it connects.
//
// States: sending -> delivered | failed for LoRa direct messages. LoRa
// channel messages and IRC messages go to sent, as neither has receipts.
//
// Events: message (msg, contact), update (msg), contacts, status.
export default class Messenger extends EventEmitter {
  contacts: Contacts
  heard: Heard
  now: () => number
  node: string | null
  radio: Radio | null
  irc: Irc | null
  channel: Contact
  keep: number

  _threads: Map<string, Message[]>
  _read: Map<string, number>
  _radioChannels: Map<string, number>
  _pending: Map<number, Message>
  _unradio: (() => void) | null
  _unirc: (() => void) | null

  constructor(opts: MessengerOptions = {}) {
    super()

    this.contacts = opts.contacts ?? new Contacts()
    this.heard = opts.heard ?? new Heard()
    this.now = opts.now ?? Date.now
    this.node = opts.node ?? null
    this.radio = null
    this.irc = null
    this.keep = opts.keep ?? 500

    this._threads = new Map()
    this._read = new Map()
    this._radioChannels = new Map([[ircChannel0(opts), 0]])
    this._pending = new Map()
    this._unradio = null
    this._unirc = null

    if (opts.state) this._restore(opts.state)

    const ircChannel = opts.ircChannel ?? '#bulgaria'

    // A channel saved under an older name, or since left, is dropped.
    const kept = new Set([ircChannel, ...(opts.ircChannels ?? [])])
    for (const c of this.contacts.all()) {
      if (c.channel && !kept.has(c.id)) this.contacts.remove(c)
    }
    for (const name of kept) if (name !== ircChannel) this.addChannel(name)

    this.channel =
      this.contacts.get(ircChannel) ??
      this.contacts.add({ name: opts.channelName ?? 'mesh', nick: ircChannel, channel: true })
  }

  // Attach a connected radio. A previous one, after a reconnect, is let go.
  setRadio(radio: Radio): void {
    if (this._unradio !== null) this._unradio()

    this.radio = radio
    this._unradio = listen(radio, {
      message: (m: RadioMessage) => this._onradio(m),
      position: (p: { from: string }) => this.heard.mark(p.from),
      telemetry: (t: { from: string }) => this.heard.mark(t.from),
      ack: (a: RadioAck) => this._onack(a),
      close: () => {
        this.radio = null
        this._unradio!()
        this._unradio = null
        this.emit('status')
      }
    })

    this.emit('status')
  }

  // Attach an IRC client. A previous one, after a reconnect, is let go.
  setIrc(irc: Irc): void {
    if (this._unirc !== null) this._unirc()

    this.irc = irc
    this._unirc = listen(irc, {
      message: (m: IrcMessage) => this._onirc(m),
      ready: () => this.emit('status'),
      close: () => {
        this.irc = null
        this._unirc!()
        this._unirc = null
        this.emit('status')
      }
    })

    this.emit('status')
  }

  // A new contact, from someone seen around or entered by hand.
  addContact(entry: ContactEntry): Contact {
    const contact = this.contacts.add(entry)
    this.emit('contacts')
    return contact
  }

  // Record that `contact` is also reachable at a node or a nick, whether or
  // not they run ekho. If another contact already holds that address, they
  // were the same person all along, and the two are joined.
  link(contact: Contact, address: Address): Contact {
    const others = [
      address.node ? this.contacts.byNode(address.node) : null,
      address.nick ? this.contacts.byNick(address.nick) : null
    ]

    for (const other of others) {
      if (other && other !== contact && !other.channel) this.join(contact, other)
    }

    this.contacts.link(contact, address)
    this.emit('contacts')

    return contact
  }

  // Mark two contacts as one person: `other`'s addresses and messages move
  // into `contact`, and `other` goes away.
  join(contact: Contact, other: Contact): Contact {
    const moved = this.thread(other)
    for (const msg of moved) msg.contact = contact.id

    const thread = this.thread(contact)
      .concat(moved)
      .sort((a, b) => a.time - b.time)
    this._threads.set(contact.id, thread)
    this._threads.delete(other.id)
    this._read.delete(other.id)

    this.contacts.remove(other)
    for (const node of other.nodes) this.contacts.link(contact, { node })
    for (const nick of other.nicks) this.contacts.link(contact, { nick })
    if (contact.alias === null) contact.alias = other.alias

    this.emit('contacts')

    return contact
  }

  // Give a contact a name of the user's choosing, or null to clear it.
  rename(contact: Contact, alias: string | null): void {
    contact.alias = alias
    this.emit('contacts')
  }

  // Reactions travel as a short text message for now. Meshtastic has native
  // reactions, which need bare-meshtastic support; IRC never will.
  react(msg: Message, emoji: string): Message {
    const snippet = msg.text.length > 40 ? msg.text.slice(0, 40) + '…' : msg.text
    return this.send(this.contacts.get(msg.contact)!, emoji + ' re: "' + snippet + '"')
  }

  toJSON(): SavedState {
    const threads: Record<string, Message[]> = {}
    for (const [id, thread] of this._threads) threads[id] = thread.slice(-this.keep)
    return { contacts: this.contacts.all(), threads, read: Object.fromEntries(this._read) }
  }

  // The radio's channels, as its index for each IRC channel the bridge pairs
  // it with: a channel named "Sofia" is #sofia, and the unnamed primary one
  // (LongFast) is the mesh channel. Channels without a radio one are IRC only.
  setRadioChannels(channels: { index: number; name: string | null; role: number }[]): void {
    this._radioChannels = new Map()
    for (const c of channels) {
      if (c.role === 0) continue
      const irc = c.name ? '#' + c.name.toLowerCase() : c.index === 0 ? this.channel.id : null
      if (irc !== null) this._radioChannels.set(irc, c.index)
    }
    this.emit('contacts')
  }

  // The radio channel paired with a channel contact, or null: IRC only.
  radioChannel(contact: Contact): number | null {
    return this.radioChannelOf(contact.id)
  }

  // The same, by IRC channel name, for channels not joined.
  radioChannelOf(name: string): number | null {
    return this._radioChannels.get(name.toLowerCase()) ?? null
  }

  // Messages received in a conversation since it was last read.
  unread(contact: Contact): number {
    const thread = this.thread(contact)
    const last = this._read.get(contact.id)
    let count = 0
    for (let i = thread.length - 1; i >= 0 && thread[i].id !== last; i--) {
      if (thread[i].state === 'received') count++
    }
    return count
  }

  markRead(contact: Contact): void {
    if (this.unread(contact) === 0) return
    // By message rather than time: one arriving in the same millisecond as
    // the read would otherwise count as read.
    this._read.set(contact.id, this.thread(contact).at(-1)!.id)
    this.emit('read', contact)
  }

  // The whole routing rule: any node heard recently, LoRa; otherwise IRC.
  route(): Via {
    return this.radio !== null && this.heard.any() ? 'lora' : 'irc'
  }

  status(): Status {
    return {
      radio: this.radio !== null,
      irc: this.irc !== null && this.irc.ready,
      heard: this.heard.count(),
      route: this.route()
    }
  }

  thread(contact: Contact): Message[] {
    return this._threads.get(contact.id) ?? []
  }

  send(contact: Contact, text: string, opts: { via?: Via } = {}): Message {
    const msg: Message = {
      id: randomId(),
      contact: contact.id,
      from: null,
      text,
      // A channel with no radio channel paired exists on IRC only.
      via:
        opts.via ?? (contact.channel && this.radioChannel(contact) === null ? 'irc' : this.route()),
      state: 'sending',
      reason: null,
      address: null,
      time: this.now()
    }

    this._push(contact, msg)
    this._dispatch(contact, msg)

    return msg
  }

  // A bridged IRC channel of its own, such as a regional one. The mesh
  // channel stays `channel`; these are reached over IRC only.
  addChannel(name: string): Contact {
    const contact =
      this.contacts.get(name) ?? this.contacts.add({ name, nick: name, channel: true })
    this.emit('contacts')
    return contact
  }

  removeChannel(name: string): void {
    const contact = this.contacts.get(name)
    if (contact === null || contact === this.channel) return
    this.contacts.remove(contact)
    this.emit('contacts')
  }

  // Try a failed message again on LoRa.
  retry(msg: Message): void {
    msg.via = 'lora'
    this._dispatch(this.contacts.get(msg.contact)!, msg)
  }

  // Send a failed LoRa message over IRC instead. Never done automatically.
  sendViaIrc(msg: Message): void {
    msg.via = 'irc'
    this._dispatch(this.contacts.get(msg.contact)!, msg)
  }

  _dispatch(contact: Contact, msg: Message): void {
    msg.state = 'sending'
    msg.reason = null

    if (msg.via === 'lora') this._sendLora(contact, msg)
    else this._sendIrc(contact, msg)

    this.emit('update', msg)
  }

  _sendLora(contact: Contact, msg: Message): void {
    if (this.radio === null) return this._fail(msg, 'RADIO_OFFLINE')

    if (contact.channel) {
      const index = this.radioChannel(contact)
      if (index === null) return this._fail(msg, 'NO_RADIO_CHANNEL')
      this.radio.send(msg.text, { wantAck: false, channel: index })
      msg.address = 'channel ' + index
      msg.state = 'sent'
      return
    }

    const node = this._bestNode(contact)
    if (node === null) return this._fail(msg, 'NO_NODE')

    msg.id = randomId()
    msg.address = node
    this._pending.set(msg.id, msg)
    this.radio.send(msg.text, { to: nodeNum(node), id: msg.id })
  }

  _sendIrc(contact: Contact, msg: Message): void {
    if (this.irc === null || !this.irc.ready) return this._fail(msg, 'IRC_OFFLINE')
    if (contact.nicks.length === 0) return this._fail(msg, 'NO_NICK')

    msg.address = contact.nicks[0]
    this.irc.privmsg(msg.address, this.node ? msg.text + ' [' + this.node + ']' : msg.text)
    msg.state = 'sent'
  }

  _fail(msg: Message, reason: string): void {
    msg.state = 'failed'
    msg.reason = reason
  }

  _onack({ id, delivered, reason }: RadioAck): void {
    const msg = this._pending.get(id)
    if (msg === undefined) return

    this._pending.delete(id)
    msg.state = delivered ? 'delivered' : 'failed'
    msg.reason = delivered ? null : reason

    this.emit('update', msg)
  }

  _onradio(m: RadioMessage): void {
    this.heard.mark(m.from)

    const contact = m.direct
      ? (this.contacts.byNode(m.from) ?? this.contacts.add({ name: m.name, node: m.from }))
      : this.channel

    this._push(contact, {
      id: randomId(),
      contact: contact.id,
      from: m.direct ? null : m.name,
      text: m.text,
      via: 'lora',
      state: 'received',
      reason: null,
      hops: m.hops,
      address: m.from,
      time: this.now()
    })
  }

  _onirc(m: IrcMessage): void {
    // The bridge mirrors Meshtastic channel traffic onto IRC as `Name|mt`.
    // While LoRa is up our radio hears that itself, so the IRC copy is
    // skipped, but only that: plain IRC users, MeshCore and Bitchat users never
    // reach our radio, and a channel the radio doesn't have has no other way in.
    const mirror = /\|mt$/i.test(m.from) && this.radioChannelOf(m.to) !== null
    if (!m.direct && mirror && this.route() === 'lora') return

    const contact = m.direct
      ? (this.contacts.byNick(m.from) ?? this.contacts.add({ nick: m.from }))
      : (this.contacts.byNick(m.to) ?? this.channel)

    this._push(contact, {
      id: randomId(),
      contact: contact.id,
      from: m.direct ? null : m.from,
      text: m.text,
      via: 'irc',
      state: 'received',
      reason: null,
      address: m.direct ? m.from : m.to,
      time: this.now()
    })
  }

  // The node to send to: the one of theirs heard most recently.
  _bestNode(contact: Contact): string | null {
    let best: string | null = null
    for (const node of contact.nodes) {
      if (best === null || this.heard.since(node) < this.heard.since(best)) best = node
    }
    return best
  }

  _restore(state: SavedState): void {
    for (const contact of state.contacts) this.contacts.add(contact)
    for (const [id, last] of Object.entries(state.read ?? {})) {
      // v0.5 saved a time here, which matches no message: all count as unread.
      this._read.set(id, last)
    }

    for (const [id, thread] of Object.entries(state.threads)) {
      for (const msg of thread) {
        // Its ack can't arrive any more: the radio session it was sent in is
        // gone. Shown as failed, so it can be retried.
        if (msg.state === 'sending') {
          msg.state = 'failed'
          msg.reason = 'INTERRUPTED'
        }
      }
      this._threads.set(id, thread)
    }
  }

  _push(contact: Contact, msg: Message): void {
    let thread = this._threads.get(contact.id)
    if (thread === undefined) {
      thread = []
      this._threads.set(contact.id, thread)
    }

    thread.push(msg)
    this.emit('message', msg, contact)
  }
}

// Subscribe to several events; returns a function that unsubscribes them all.
function listen(emitter: EventEmitter, handlers: Record<string, (...args: any[]) => void>) {
  for (const [name, fn] of Object.entries(handlers)) emitter.on(name, fn)
  return () => {
    for (const [name, fn] of Object.entries(handlers)) emitter.off(name, fn)
  }
}

// Same as bare-meshtastic: 32 bits, never zero. Used to match acks, not a
// secret.
function randomId(): number {
  return (Math.random() * 0x100000000) >>> 0 || 1
}

function nodeNum(id: string): number {
  return parseInt(id.slice(1), 16)
}

// Until the radio says which channels it has, its primary one is the mesh
// channel.
function ircChannel0(opts: MessengerOptions): string {
  return opts.ircChannel ?? '#bulgaria'
}
