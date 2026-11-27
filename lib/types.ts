import type EventEmitter from 'bare-events'

// The slice of a bare-meshtastic Client that ekho uses.
export interface Radio extends EventEmitter {
  // Our own node ID, like '!e2f4a910'.
  readonly id: string
  // The radio's node list, once synced: nodes it has heard of.
  readonly nodes?: Map<number, { user: unknown }>
  send(
    text: string,
    opts?: { to?: number; id?: number; wantAck?: boolean; channel?: number }
  ): boolean
}

// What a synced bare-meshtastic Client also knows: the radio's node list,
// its channels and its LoRa settings. Read by the app once connected.
export interface RadioState {
  nodes: Map<
    number,
    { num: number; user: { longName: string | null; shortName: string | null } | null }
  >
  channels: Map<number, { index: number; name: string | null; role: number }>
  config: { region: string; preset: string } | null
  nodeNum: number
}

export interface RadioMessage {
  from: string
  name: string
  text: string
  snr: number
  rssi: number
  hops: number
  direct: boolean
}

export interface RadioAck {
  id: number
  delivered: boolean
  reason: string
}

export interface IrcMessage {
  from: string
  to: string
  text: string
  direct: boolean
}

export interface Contact {
  id: string
  // The name the network gave: a node's short name or a nick.
  name: string
  // A name the user chose; shown instead of `name` when set.
  alias: string | null
  // Every Meshtastic node ID known to be this person, like '!e2f4a910'.
  nodes: string[]
  // Every IRC nick known to be this person, or the IRC channel for a channel
  // contact.
  nicks: string[]
  channel: boolean
}

export type Via = 'lora' | 'irc'

export type State = 'sending' | 'sent' | 'relayed' | 'delivered' | 'failed' | 'received'

export interface Message {
  // Packet ID on LoRa, used to match the ack. Zero otherwise.
  id: number
  contact: string
  // Sender's name in a channel; null for our own messages and for direct ones.
  from: string | null
  text: string
  via: Via
  state: State
  reason: string | null
  hops?: number
  // Ours, sent translated: what was typed.
  wrote?: string
  // Ours, sent as an action (`/me`): what was done. Its text is `* nick does`.
  action?: string
  // Received over the other path too, from the same person: the copy that
  // was folded into this one.
  also?: Via
  // The exact address it came from or went to: a node ID, a nick or a
  // channel. Shown in message info, since one person can have several.
  address: string | null
  time: number
  // On a linked device: the message's number in the feed of the device that
  // sent or received it, by which retries and updates name it.
  ref?: number
  // The same, as the linked device first numbered its own message, before
  // the feed had it.
  local?: number
}

// What a linked device asks of the one holding the radio and IRC.
export type Command =
  | { type: 'send'; local: number; contact: string; text: string; via: Via | null }
  | { type: 'retry'; ref: number }
  | { type: 'irc'; ref: number }
  // The whole state again, for a device that may have missed some of it.
  | { type: 'state' }
  // Join or leave an IRC channel.
  | { type: 'channel'; name: string; join: boolean }
