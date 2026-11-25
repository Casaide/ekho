import type EventEmitter from 'bare-events'

// The slice of a bare-meshtastic Client that ekho uses.
export interface Radio extends EventEmitter {
  // Our own node ID, like '!e2f4a910'.
  readonly id: string
  send(text: string, opts?: { to?: number; id?: number; wantAck?: boolean }): boolean
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
  name: string
  // Meshtastic node ID, like '!e2f4a910'.
  node: string | null
  // IRC nick, or the IRC channel for a channel contact.
  nick: string | null
  channel: boolean
}

export type Via = 'lora' | 'irc'

export type State = 'sending' | 'sent' | 'delivered' | 'failed' | 'received'

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
  time: number
}
