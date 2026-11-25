import type { Contact } from './types.ts'

// People, not addresses. A contact holds every Meshtastic node ID
// ('!e2f4a910') and IRC nick known to belong to one person, whether or not
// they run ekho, plus an optional alias the user gave them. Links are the
// user's own: local and unsigned.
export default class Contacts {
  _byId: Map<string, Contact>
  _byNode: Map<string, Contact>
  _byNick: Map<string, Contact>

  constructor(entries: ContactEntry[] = []) {
    this._byId = new Map()
    this._byNode = new Map()
    this._byNick = new Map()

    for (const entry of entries) this.add(entry)
  }

  add(entry: ContactEntry): Contact {
    const nodes = entry.nodes ?? (entry.node ? [entry.node] : [])
    const nicks = entry.nicks ?? (entry.nick ? [entry.nick] : [])
    const channel = entry.channel ?? false

    const contact: Contact = {
      id: entry.id ?? nodes[0] ?? (channel ? nicks[0] : 'irc:' + nicks[0].toLowerCase()),
      name: entry.name ?? nodes[0] ?? nicks[0],
      alias: entry.alias ?? null,
      nodes,
      nicks,
      channel
    }

    this._byId.set(contact.id, contact)
    this._index(contact)

    return contact
  }

  // Add a node or a nick to a contact. Joining two contacts that turn out to
  // be one person is the Messenger's job, as it owns their threads.
  link(contact: Contact, { node = null, nick = null }: Address): Contact {
    if (node && !contact.nodes.includes(node)) contact.nodes.push(node)
    if (nick && !contact.nicks.some((n) => same(n, nick))) contact.nicks.push(nick)
    this._index(contact)
    return contact
  }

  remove(contact: Contact): void {
    this._byId.delete(contact.id)
    for (const node of contact.nodes) {
      if (this._byNode.get(node) === contact) this._byNode.delete(node)
    }
    for (const nick of contact.nicks) {
      if (this._byNick.get(nick.toLowerCase()) === contact) this._byNick.delete(nick.toLowerCase())
    }
  }

  get(id: string): Contact | null {
    return this._byId.get(id) ?? null
  }

  byNode(node: string): Contact | null {
    return this._byNode.get(node) ?? null
  }

  byNick(nick: string): Contact | null {
    return this._byNick.get(nick.toLowerCase()) ?? null
  }

  all(): Contact[] {
    return [...this._byId.values()]
  }

  toJSON(): Contact[] {
    return this.all()
  }

  _index(contact: Contact): void {
    for (const node of contact.nodes) this._byNode.set(node, contact)
    for (const nick of contact.nicks) this._byNick.set(nick.toLowerCase(), contact)
  }
}

export interface Address {
  node?: string | null
  nick?: string | null
}

// What `add` takes: a saved contact, or a new one with one node and nick.
export interface ContactEntry extends Address {
  id?: string
  name?: string | null
  alias?: string | null
  nodes?: string[]
  nicks?: string[]
  channel?: boolean
}

// The name to show: the user's alias, else the name the network gave.
export function displayName(contact: Contact): string {
  return contact.alias ?? contact.name
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
