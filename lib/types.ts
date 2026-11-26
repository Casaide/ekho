import type EventEmitter from 'bare-events'

// The slice of a bare-meshtastic Client that ekho uses.
export interface Radio extends EventEmitter {
  // Our own node ID, like '!e2f4a910'.
  readonly id: string
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
  // The exact address it came from or went to: a node ID, a nick or a
  // channel. Shown in message info, since one person can have several.
  address: string | null
  time: number
}
