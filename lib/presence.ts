import EventEmitter from 'bare-events'
import type Heard from './heard.ts'

export type Network = 'irc' | 'meshtastic' | 'meshcore' | 'bitchat'

export interface Node {
  id: string
  longName: string | null
  shortName: string | null
}

// Someone seen on any transport, as one entry: the radio nodes heard, and the
// IRC nicks present in channels we're in. A bridged mesh user on IRC
// (`name|mt`) is matched to the radio node with that long name.
export interface Person {
  name: string
  nodes: { id: string; heard: number }[]
  nicks: { nick: string; network: Network; channels: string[] }[]
}

// motaba shows mesh users on IRC with a suffix for their network.
const SUFFIX: Record<string, Network> = { mt: 'meshtastic', mc: 'meshcore', bc: 'bitchat' }

// Who's around, on the radio and on IRC.
//
// Events: change.
export default class Presence extends EventEmitter {
  heard: Heard
  self: { node: string | null; nick: string | null }

  _nodes: Map<string, Node>
  _channels: Map<string, Set<string>>

  constructor(heard: Heard) {
    super()

    this.heard = heard
    this.self = { node: null, nick: null }

    this._nodes = new Map()
    this._channels = new Map()
  }

  // A node the radio knows, with its names.
  node(node: Node): void {
    this._nodes.set(node.id, node)
    this.emit('change')
  }

  nodeName(id: string): string | null {
    const node = this._nodes.get(id)
    return node ? (node.longName ?? node.shortName) : null
  }

  names(channel: string, nicks: string[]): void {
    this._channels.set(channel, new Set(nicks))
    this.emit('change')
  }

  joined(channel: string, nick: string): void {
    const members = this._channels.get(channel) ?? new Set()
    members.add(nick)
    this._channels.set(channel, members)
    this.emit('change')
  }

  parted(channel: string, nick: string): void {
    this._channels.get(channel)?.delete(nick)
    this.emit('change')
  }

  quit(nick: string): void {
    for (const members of this._channels.values()) members.delete(nick)
    this.emit('change')
  }

  renamed(from: string, to: string): void {
    for (const members of this._channels.values()) {
      if (members.delete(from)) members.add(to)
    }
    this.emit('change')
  }

  // IRC went away: nobody is known to be there any more.
  clearIrc(): void {
    this._channels.clear()
    this.emit('change')
  }

  // Everyone in one of our IRC channels, as people() lists them.
  inChannel(channel: string): Person[] {
    const name = channel.toLowerCase()
    return this.people().filter((p) =>
      p.nicks.some((n) => n.channels.some((c) => c.toLowerCase() === name))
    )
  }

  // Everyone, most recently seen first: heard on the radio, or in a channel.
  people(): Person[] {
    const byNode = new Map<string, Person>()
    const people: Person[] = []

    for (const node of this._nodes.values()) {
      if (node.id === this.self.node) continue
      const person: Person = {
        name: node.longName ?? node.shortName ?? node.id,
        nodes: [{ id: node.id, heard: this.heard.since(node.id) }],
        nicks: []
      }
      byNode.set(node.id, person)
      people.push(person)
    }

    const nicks = new Map<string, string[]>()
    for (const [channel, members] of this._channels) {
      for (const nick of members) {
        if (this.self.nick !== null && nick.toLowerCase() === this.self.nick.toLowerCase()) continue
        nicks.set(nick, [...(nicks.get(nick) ?? []), channel])
      }
    }

    for (const [nick, channels] of nicks) {
      const { name, network } = split(nick)
      const entry = { nick, network, channels }
      const node = network === 'meshtastic' ? this._match(name) : null
      // Our own radio, seen through the bridge.
      if (node !== null && node === this.self.node) continue
      const person = node === null ? null : (byNode.get(node) ?? null)
      if (person !== null) person.nicks.push(entry)
      else people.push({ name, nodes: [], nicks: [entry] })
    }

    return people.sort((a, b) => seen(a) - seen(b) || a.name.localeCompare(b.name))
  }

  // The node whose long name motaba turned into this nick: spaces as `_`,
  // possibly cut short to fit the nick length.
  _match(name: string): string | null {
    const wanted = name.toLowerCase()
    for (const node of this._nodes.values()) {
      const long = (node.longName ?? '').replace(/ /g, '_').toLowerCase()
      if (long === '') continue
      if (long === wanted || (wanted.length >= 20 && long.startsWith(wanted))) return node.id
    }
    return null
  }
}

function split(nick: string): { name: string; network: Network } {
  const bar = nick.lastIndexOf('|')
  const network = bar === -1 ? undefined : SUFFIX[nick.slice(bar + 1).toLowerCase()]
  return network ? { name: nick.slice(0, bar), network } : { name: nick, network: 'irc' }
}

// How long ago a person was last seen: their most recent node, or now if
// they're in a channel.
function seen(person: Person): number {
  let best = person.nicks.length > 0 ? 0 : Infinity
  for (const node of person.nodes) best = Math.min(best, node.heard)
  return best
}
