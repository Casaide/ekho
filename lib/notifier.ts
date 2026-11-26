import type Messenger from './messenger.ts'
import type { Contact, Message } from './types.ts'
import { displayName } from './contacts.ts'

// Where notifications go: the system's, on Android.
export interface Sink {
  show(id: number, opts: { title: string; body: string }): void
  cancel(id: number): void
}

// What to tell the user while ekho is off screen: a notification per
// conversation for messages to you, and for channel lines that name you.
// Busy channels otherwise stay quiet. A conversation's notification goes
// once it's read.
export default class Notifier {
  messenger: Messenger
  sink: Sink
  // On screen: nothing is shown then, as the app shows it.
  foreground: boolean
  // Our names, matched in channel lines: the IRC nick and the radio's names.
  names: () => string[]

  _ids: Map<string, number>
  _contacts: Map<number, string>
  _counts: Map<string, number>
  _next: number

  constructor(messenger: Messenger, sink: Sink, opts: { names?: () => string[] } = {}) {
    this.messenger = messenger
    this.sink = sink
    this.foreground = true
    this.names = opts.names ?? (() => [])

    this._ids = new Map()
    this._contacts = new Map()
    this._counts = new Map()
    this._next = 1

    messenger.on('message', (msg: Message, contact: Contact) => this._onmessage(msg, contact))
    messenger.on('read', (contact: Contact) => this.clear(contact))
  }

  // The conversation a notification is for, once it's tapped.
  contact(id: number): Contact | null {
    const contactId = this._contacts.get(id)
    return contactId === undefined ? null : this.messenger.contacts.get(contactId)
  }

  clear(contact: Contact): void {
    const id = this._ids.get(contact.id)
    if (id === undefined || !this._counts.has(contact.id)) return
    this._counts.delete(contact.id)
    this.sink.cancel(id)
  }

  _onmessage(msg: Message, contact: Contact): void {
    if (this.foreground || msg.state !== 'received') return
    if (contact.channel && !this._mentions(msg.text)) return

    let id = this._ids.get(contact.id)
    if (id === undefined) {
      id = this._next++
      this._ids.set(contact.id, id)
      this._contacts.set(id, contact.id)
    }

    const count = (this._counts.get(contact.id) ?? 0) + 1
    this._counts.set(contact.id, count)

    const name = displayName(contact)
    const title =
      (contact.channel ? msg.from + ' in ' + name : name) + (count > 1 ? ' · ' + count : '')
    this.sink.show(id, { title, body: msg.text })
  }

  _mentions(text: string): boolean {
    const lower = text.toLowerCase()
    return this.names().some((name) => name.length > 1 && lower.includes(name.toLowerCase()))
  }
}
