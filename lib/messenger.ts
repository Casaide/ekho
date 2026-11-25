import EventEmitter from 'bare-events'
import Contacts from './contacts.ts'
import Heard from './heard.ts'
import type Irc from './irc.ts'
import type {
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
  // Our own node ID, added to IRC messages so people can tell it's us. A hint,
  // not proof: anyone on IRC can type it.
  node?: string | null
  channelName?: string
  // The IRC channel the community bridge mirrors the mesh channel to.
  ircChannel?: string
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
// Events: message (msg, contact), update (msg), status.
export default class Messenger extends EventEmitter {
  contacts: Contacts
  heard: Heard
  now: () => number
  node: string | null
  radio: Radio | null
  irc: Irc | null
  channel: Contact

  _threads: Map<string, Message[]>
  _pending: Map<number, Message>

  constructor(opts: MessengerOptions = {}) {
    super()

    this.contacts = opts.contacts ?? new Contacts()
    this.heard = opts.heard ?? new Heard()
    this.now = opts.now ?? Date.now
    this.node = opts.node ?? null
    this.radio = null
    this.irc = null

    this.channel = this.contacts.add({
      name: opts.channelName ?? 'mesh',
      nick: opts.ircChannel ?? '#mesh',
      channel: true
    })

    this._threads = new Map()
    this._pending = new Map()
  }

  setRadio(radio: Radio): void {
    this.radio = radio

    radio.on('message', (m: RadioMessage) => this._onradio(m))
    radio.on('position', (p: { from: string }) => this.heard.mark(p.from))
    radio.on('telemetry', (t: { from: string }) => this.heard.mark(t.from))
    radio.on('ack', (a: RadioAck) => this._onack(a))
    radio.on('close', () => {
      if (this.radio === radio) this.radio = null
      this.emit('status')
    })

    this.emit('status')
  }

  setIrc(irc: Irc): void {
    this.irc = irc

    irc.on('message', (m: IrcMessage) => this._onirc(m))
    irc.on('ready', () => this.emit('status'))
    irc.on('close', () => {
      if (this.irc === irc) this.irc = null
      this.emit('status')
    })

    this.emit('status')
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
      id: 0,
      contact: contact.id,
      from: null,
      text,
      via: opts.via ?? this.route(),
      state: 'sending',
      reason: null,
      time: this.now()
    }

    this._push(contact, msg)
    this._dispatch(contact, msg)

    return msg
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
      this.radio.send(msg.text, { wantAck: false })
      msg.state = 'sent'
      return
    }

    if (contact.node === null) return this._fail(msg, 'NO_NODE')

    msg.id = randomId()
    this._pending.set(msg.id, msg)
    this.radio.send(msg.text, { to: nodeNum(contact.node), id: msg.id })
  }

  _sendIrc(contact: Contact, msg: Message): void {
    if (this.irc === null || !this.irc.ready) return this._fail(msg, 'IRC_OFFLINE')
    if (contact.nick === null) return this._fail(msg, 'NO_NICK')

    this.irc.privmsg(contact.nick, this.node ? msg.text + ' [' + this.node + ']' : msg.text)
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
      id: 0,
      contact: contact.id,
      from: m.direct ? null : m.name,
      text: m.text,
      via: 'lora',
      state: 'received',
      reason: null,
      hops: m.hops,
      time: this.now()
    })
  }

  _onirc(m: IrcMessage): void {
    // The bridge mirrors mesh channel traffic onto IRC. While LoRa is up we
    // already hear it there, so the IRC copy is skipped.
    if (!m.direct && this.route() === 'lora') return

    const contact = m.direct
      ? (this.contacts.byNick(m.from) ?? this.contacts.add({ nick: m.from }))
      : (this.contacts.byNick(m.to) ?? this.channel)

    this._push(contact, {
      id: 0,
      contact: contact.id,
      from: m.direct ? null : m.from,
      text: m.text,
      via: 'irc',
      state: 'received',
      reason: null,
      time: this.now()
    })
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

// Same as bare-meshtastic: 32 bits, never zero. Used to match acks, not a
// secret.
function randomId(): number {
  return (Math.random() * 0x100000000) >>> 0 || 1
}

function nodeNum(id: string): number {
  return parseInt(id.slice(1), 16)
}
