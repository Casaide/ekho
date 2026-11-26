import EventEmitter from 'bare-events'
import Contacts, { type Address, type ContactEntry } from './contacts.ts'
import Heard from './heard.ts'
import type Irc from './irc.ts'
import type {
  Command,
  Contact,
  IrcMessage,
  Message,
  Radio,
  RadioAck,
  RadioMessage,
  Via
} from './types.ts'

export interface MessengerOptions {
  contacts?: Contacts
  heard?: Heard
  now?: () => number
  // Our own radio's node ID, once one is connected.
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

// How far apart the same message over both paths can arrive and still be
// taken as one.
const TWIN_WINDOW = 2 * 60 * 1000

// Text compared as words, whatever the spacing.
function same(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

// The long name of the motaba bridge's radio, which repeats IRC lines onto
// the mesh.
const BRIDGE = 'irc'

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
  // On a linked device, the radio and IRC are another device's: sends go to
  // it through relay, and remote is its status, as its feed last said.
  relay: ((command: Command) => void) | null
  remote: Status | null

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
    this.relay = null
    this.remote = null

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

  // Replies and reactions travel as a short text message for now. Meshtastic
  // has native ones, which need bare-meshtastic support; IRC never will. As
  // mirco suggested, they read the way motaba's own app writes them:
  // ↩️, then who said it and the first two words, then the answer:
  // `↩️ "mirco: and the…": 👍`.
  reply(msg: Message, text: string, opts: { wrote?: string } = {}): Message {
    const prefix = this.replyTo(msg)
    const wrote = opts.wrote === undefined ? {} : { wrote: prefix + opts.wrote }
    return this.send(this.contacts.get(msg.contact)!, prefix + text, wrote)
  }

  // What goes before a reply's text. The name is the one others see: the
  // sender's nick in a channel, theirs in a direct conversation, ours for our
  // own messages.
  replyTo(msg: Message): string {
    const contact = this.contacts.get(msg.contact)!
    const name =
      msg.state !== 'received'
        ? (this.irc?.nick ?? 'me')
        : (msg.from ?? contact.nicks[0] ?? contact.alias ?? contact.name)
    return '↩️ "' + name + ': ' + quote(msg.text) + '": '
  }

  react(msg: Message, emoji: string): Message {
    return this.reply(msg, emoji)
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

  // The way to a contact: the routing rule, except that LoRa needs a way in.
  // A channel with no radio channel paired exists on IRC only, and a person
  // whose node the radio doesn't know goes by IRC if they have a nick.
  routeFor(contact: Contact): Via {
    if (contact.channel) return this.radioChannel(contact) === null ? 'irc' : this.route()
    const route = this.route()
    if (route === 'lora' && this.relay === null && contact.nicks.length > 0) {
      const node = this._bestNode(contact)
      if (node === null || !this._knows(node)) return 'irc'
    }
    return route
  }

  // The whole routing rule: any node heard recently, LoRa; otherwise IRC.
  route(): Via {
    if (this.remote !== null) return this.remote.route
    return this.radio !== null && this.heard.any() ? 'lora' : 'irc'
  }

  status(): Status {
    if (this.remote !== null) return this.remote
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

  // `wrote`: what you typed, when `text` is its translation.
  send(contact: Contact, text: string, opts: { via?: Via; wrote?: string } = {}): Message {
    const msg: Message = {
      id: randomId(),
      contact: contact.id,
      from: null,
      text,
      via: opts.via ?? this.routeFor(contact),
      state: 'sending',
      reason: null,
      address: null,
      time: this.now()
    }
    if (opts.wrote !== undefined) msg.wrote = opts.wrote

    this._push(contact, msg)

    if (this.relay !== null) {
      this.relay({ type: 'send', local: msg.id, contact: contact.id, text, via: opts.via ?? null })
    } else {
      this._dispatch(contact, msg)
    }

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
    if (this.relay !== null) this._relayed(msg, { type: 'retry', ref: msg.ref! })
    else this._dispatch(this.contacts.get(msg.contact)!, msg)
  }

  // Send a failed LoRa message over IRC instead. Never done automatically.
  sendViaIrc(msg: Message): void {
    msg.via = 'irc'
    if (this.relay !== null) this._relayed(msg, { type: 'irc', ref: msg.ref! })
    else this._dispatch(this.contacts.get(msg.contact)!, msg)
  }

  _relayed(msg: Message, command: Command): void {
    msg.state = 'sending'
    msg.reason = null
    this.relay!(command)
    this.emit('update', msg)
  }

  // On a linked device, applying the feed of the one holding the radio and
  // IRC (lib/feed.ts): its whole state, then each message, change, contact
  // list and status as they come.

  adopt(state: SavedState): void {
    for (const contact of this.contacts.all()) this.contacts.remove(contact)
    this._threads.clear()
    this._read.clear()
    for (const contact of state.contacts) this.contacts.add(contact)
    for (const [id, thread] of Object.entries(state.threads)) this._threads.set(id, thread)
    for (const [id, last] of Object.entries(state.read ?? {})) this._read.set(id, last)
    this.channel = this.contacts.get(this.channel.id) ?? this.contacts.add(this.channel)
    this.emit('contacts')
  }

  // A message, taking the place of our own copy of it if we sent it, or of
  // itself if the feed is applied again from before it (after a restart that
  // came before saving how far it got).
  receive(contact: Contact, msg: Message): void {
    const known = this.contacts.get(contact.id) ?? this.contacts.add(contact)
    const thread = this.thread(known)
    const ours =
      (msg.ref === undefined ? undefined : thread.find((m) => m.ref === msg.ref)) ??
      (msg.local === undefined
        ? undefined
        : thread.find((m) => m.id === msg.local && m.ref === undefined))
    if (ours === undefined) return this._push(known, msg)
    Object.assign(ours, msg)
    this.emit('update', ours)
  }

  // A change to a message: its state, mostly.
  change(msg: Message): void {
    for (const thread of this._threads.values()) {
      const found = thread.find((m) => m.ref === msg.ref)
      if (found === undefined) continue
      Object.assign(found, msg)
      this.emit('update', found)
      return
    }
  }

  setContacts(contacts: Contact[]): void {
    for (const contact of this.contacts.all()) this.contacts.remove(contact)
    for (const contact of contacts) this.contacts.add(contact)
    this.channel = this.contacts.get(this.channel.id) ?? this.contacts.add(this.channel)
    this.emit('contacts')
  }

  setRemote(status: Status | null): void {
    this.remote = status
    this.emit('status')
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
      // The radio counts another radio repeating it as the ack, and reports
      // failure if none does after its retries.
      msg.id = randomId()
      msg.address = 'channel ' + index
      this._pending.set(msg.id, msg)
      this.radio.send(msg.text, { id: msg.id, channel: index })
      return
    }

    // Only to a node the radio knows: heard this session, or in its node
    // list. It can't reach one it has never heard of, so this fails now,
    // offering IRC, rather than after the radio's retries.
    const node = this._bestNode(contact)
    if (node === null || !this._knows(node)) return this._fail(msg, 'NO_NODE')

    msg.id = randomId()
    msg.address = node
    this._pending.set(msg.id, msg)
    this.radio.send(msg.text, { to: nodeNum(node), id: msg.id })
  }

  _sendIrc(contact: Contact, msg: Message): void {
    if (this.irc === null || !this.irc.ready) return this._fail(msg, 'IRC_OFFLINE')
    if (contact.nicks.length === 0) return this._fail(msg, 'NO_NICK')

    msg.address = contact.nicks[0]
    this.irc.privmsg(msg.address, msg.text)
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
    const relayed = this.contacts.get(msg.contact)!.channel
    msg.state = delivered ? (relayed ? 'relayed' : 'delivered') : 'failed'
    msg.reason = delivered ? null : reason

    this.emit('update', msg)
  }

  _onradio(m: RadioMessage): void {
    this.heard.mark(m.from)

    // The bridge's own radio repeats IRC lines onto the mesh, from a node
    // named "irc". While we're on IRC we have each line already, with who
    // said it, so the radio's copy is skipped; without IRC it's the only way
    // to see them, and kept.
    if (!m.direct && m.name.toLowerCase() === BRIDGE && this.irc !== null && this.irc.ready) return

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

  _knows(node: string): boolean {
    if (this.heard.since(node) !== Infinity) return true
    return (this.radio!.nodes?.get(nodeNum(node))?.user ?? null) !== null
  }

  // Who sent a received message, as a contact, if they're one: in a channel
  // by their node on LoRa or nick on IRC, otherwise the conversation's.
  _senderOf(contact: Contact, msg: Message): Contact | null {
    if (!contact.channel) return contact
    if (msg.via === 'lora') return this.contacts.byNode(msg.address!)
    return this.contacts.byNick(msg.from!)
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

    // The same words from the same person over the other path, just now:
    // one message, marked as having come both ways. Only for people you've
    // joined across both paths, so it's never a guess.
    const sender = msg.state === 'received' ? this._senderOf(contact, msg) : null
    if (sender !== null && sender.nodes.length > 0 && sender.nicks.length > 0) {
      const words = same(msg.text)
      const twin = thread.findLast(
        (m) =>
          m.state === 'received' &&
          m.via !== msg.via &&
          m.also === undefined &&
          msg.time - m.time <= TWIN_WINDOW &&
          same(m.text) === words &&
          this._senderOf(contact, m) === sender
      )
      if (twin !== undefined) {
        twin.also = msg.via
        this.emit('update', twin)
        return
      }
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

// What a reply quotes: two words, marked as cut if there were more.
function quote(text: string): string {
  const words = text.trim().split(/\s+/)
  const two = words.slice(0, 2).join(' ').slice(0, 20)
  return words.length > 2 || two.length < words.slice(0, 2).join(' ').length ? two + '…' : two
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
