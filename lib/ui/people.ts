import type Ui from './index.ts'
import type { Contact } from '../types.ts'
import type { Person } from '../presence.ts'
import { displayName } from '../contacts.ts'
import {
  colors,
  view,
  text,
  input,
  scroll,
  press,
  clear,
  heading,
  avatar,
  label,
  dot,
  ago
} from './kit.ts'

// What a bridged nick's suffix means, in words.
const BRIDGED: Record<string, string> = {
  meshtastic: 'meshtastic via irc',
  meshcore: 'meshcore via irc',
  bitchat: 'bitchat via irc'
}

// `~/contacts`: who's around right now on every transport, then saved
// contacts not seen. Tapping someone opens their conversation, making them a
// contact if they weren't one.
export default class People {
  ui: Ui
  root: any

  _summary: any
  _search: any
  _list: any

  constructor(ui: Ui) {
    this.ui = ui

    this._summary = text('', { color: colors.muted, fontSize: 12 })
    this._search = input('/ filter')
    this._search.on('change', () => this.render())
    this._list = scroll({ paddingHorizontal: 18, paddingVertical: 10, gap: 10 })

    this.root = view({ flex: 1 }, [
      view({ paddingHorizontal: 18, paddingTop: 16, gap: 12 }, [
        heading('~/', 'contacts'),
        this._summary,
        this._search
      ]),
      this._list
    ])
  }

  render(): void {
    const { messenger, presence } = this.ui
    const filter = this._search.value.trim().toLowerCase()
    const matches = (name: string) => filter === '' || name.toLowerCase().includes(filter)

    const people = presence.people()
    const onLora = people.filter((p) =>
      p.nodes.some((n) => n.heard < messenger.heard.window)
    ).length
    const onIrc = people.filter((p) => p.nicks.length > 0).length
    this._summary.text = onLora + ' heard on lora · ' + onIrc + ' on irc'

    const content = this._list.content
    clear(content)

    // People seen, under their contact name where they are one.
    const shown = new Set<string>()
    const online = people.filter((p) => matches(this._nameOf(p)))
    content.appendChild(label('around now · ' + online.length))
    for (const person of online) {
      const contact = this._contactOf(person)
      if (contact !== null) shown.add(contact.id)
      content.appendChild(this._row(person, contact))
    }

    const saved = messenger.contacts
      .all()
      .filter((c) => !c.channel && !shown.has(c.id) && matches(displayName(c)))
    if (saved.length > 0) {
      content.appendChild(label('saved, not seen'))
      for (const contact of saved) {
        content.appendChild(
          this._row({ name: displayName(contact), nodes: [], nicks: [] }, contact)
        )
      }
    }
  }

  _row(person: Person, contact: Contact | null): any {
    const { messenger } = this.ui
    const name = contact !== null ? displayName(contact) : person.name
    const heardRecently = person.nodes.some((n) => n.heard < messenger.heard.window)
    const lines: any[] = []

    for (const node of person.nodes) {
      lines.push(
        text(
          'lora · ' +
            node.id +
            ' · ' +
            (node.heard === Infinity ? 'not heard yet' : 'heard ' + ago(node.heard)),
          {
            color: node.heard < messenger.heard.window ? colors.lora : colors.muted,
            fontSize: 11
          },
          1
        )
      )
    }
    for (const nick of person.nicks) {
      lines.push(
        text(
          (BRIDGED[nick.network] ?? 'irc') + ' · ' + nick.nick + ' · ' + nick.channels.join(' '),
          { color: colors.irc, fontSize: 11 },
          1
        )
      )
    }
    if (lines.length === 0) lines.push(text('not seen', { color: colors.muted, fontSize: 11 }))

    return press(
      view(
        {
          flexDirection: 'row',
          gap: 12,
          paddingVertical: 8,
          cursor: 'pointer'
        },
        [
          avatar(name),
          view({ flex: 1, gap: 3 }, [
            view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [
              text(name, { color: colors.text, fontSize: 14, fontWeight: 'bold' }, 1),
              dot(
                heardRecently || person.nicks.length > 0,
                heardRecently ? colors.accent : colors.irc
              )
            ]),
            ...lines
          ])
        ]
      ),
      () => this.ui.select(contact ?? this._add(person))
    )
  }

  _nameOf(person: Person): string {
    const contact = this._contactOf(person)
    return contact !== null ? displayName(contact) : person.name
  }

  _contactOf(person: Person): Contact | null {
    const { contacts } = this.ui.messenger
    for (const node of person.nodes) {
      const contact = contacts.byNode(node.id)
      if (contact !== null) return contact
    }
    for (const nick of person.nicks) {
      const contact = contacts.byNick(nick.nick)
      if (contact !== null) return contact
    }
    return null
  }

  // Someone tapped who isn't a contact yet: make them one, with every address
  // we've seen them on.
  _add(person: Person): Contact {
    return this.ui.messenger.addContact({
      name: person.name,
      nodes: person.nodes.map((n) => n.id),
      nicks: person.nicks.map((n) => n.nick)
    })
  }
}
