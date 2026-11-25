import type { Contact } from './types.ts'

// People, not addresses. A contact links a Meshtastic node ID ('!e2f4a910')
// and an IRC nick, either of which may be missing. Links are the user's own:
// local and unsigned.
export default class Contacts {
  _byId: Map<string, Contact>
  _byNode: Map<string, Contact>
  _byNick: Map<string, Contact>

  constructor(entries: Partial<Contact>[] = []) {
    this._byId = new Map()
    this._byNode = new Map()
    this._byNick = new Map()

    for (const entry of entries) this.add(entry)
  }

  add({
    name = null,
    node = null,
    nick = null,
    channel = false
  }: {
    name?: string | null
    node?: string | null
    nick?: string | null
    channel?: boolean
  }): Contact {
    const id = node ?? (channel ? nick! : 'irc:' + nick!.toLowerCase())

    const contact: Contact = { id, name: name ?? node ?? nick!, node, nick, channel }

    this._byId.set(contact.id, contact)
    this._index(contact)

    return contact
  }

  // Add a node or a nick to an existing contact.
  link(contact: Contact, { node = contact.node, nick = contact.nick }): Contact {
    contact.node = node
    contact.nick = nick
    this._index(contact)
    return contact
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
    if (contact.node) this._byNode.set(contact.node, contact)
    if (contact.nick) this._byNick.set(contact.nick.toLowerCase(), contact)
  }
}
