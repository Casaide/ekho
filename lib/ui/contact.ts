import type Ui from './index.ts'
import { displayName } from '../contacts.ts'
import type { Contact } from '../types.ts'
import { personRow, contactOf } from './people.ts'
import {
  colors,
  view,
  text,
  input,
  scroll,
  button,
  chip,
  primary,
  clear,
  detach,
  rule,
  avatar,
  label,
  ago,
  back
} from './kit.ts'

// People listed under a channel; the contacts tab has everyone.
const HERE = 40

// `~/contacts/ivan`: who they are, every address they're reached on in the
// order ekho tries them, linking another node or nick, and joining two
// contacts that turn out to be the same person.
export default class ContactScreen {
  ui: Ui
  root: any

  _back: any
  _crumb: any
  _where: any
  _body: any
  _alias: any
  _link: any
  _editButton: any
  _editing: boolean

  // `side`: shown beside a conversation on a desktop, closed with ×.
  constructor(ui: Ui, opts: { side?: boolean } = {}) {
    this.ui = ui
    this._editing = false

    this._back = opts.side ? back(() => this.ui.toggleInfo(), '×') : back(() => this.ui.back())
    this._where = text('~/contacts/', { color: colors.muted, fontSize: 15, fontWeight: 'bold' })
    this._crumb = text('', { color: colors.text, fontSize: 15, fontWeight: 'bold' }, 1)

    this._alias = input('alias, optional')
    this._alias.returnKeyType = 'done'
    this._alias.on('submit', () => this._edit())

    this._link = input('+ link another node (!a7c3e91f) or nick')
    this._link.returnKeyType = 'done'
    this._link.on('submit', () => this._linkAddress())

    this._body = scroll({ padding: 18, gap: 14 })
    this._editButton = view({})

    this.root = view({ flex: 1 }, [
      view(
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10
        },
        [
          this._back,
          view({ flexDirection: 'row', flex: 1 }, [this._where, this._crumb]),
          this._editButton
        ]
      ),
      rule(),
      this._body
    ])
  }

  render(): void {
    const contact = this.ui.selected
    if (contact === null) return
    const { messenger } = this.ui
    const name = displayName(contact)

    // Always: on a desktop the details take the middle pane, and back is the
    // way to the conversation.
    this._back.style = { ...this._back.style, display: 'flex' }
    this._crumb.text = name
    this._where.text = contact.channel ? '~/channels/' : '~/contacts/'

    clear(this._editButton)
    this._editButton.appendChild(
      button(this._editing ? 'done' : 'edit', () => this._edit(), chip(colors.text))
    )

    detach(this._alias)
    detach(this._link)
    const content = this._body.content
    clear(content)

    content.appendChild(
      view({ flexDirection: 'row', alignItems: 'center', gap: 14 }, [
        avatar(contact.channel ? '#' : name, 52),
        view({ flex: 1, gap: 4 }, [
          text(name, { color: colors.text, fontSize: 17, fontWeight: 'bold' }),
          text(
            contact.channel
              ? (contact.alias === null ? '' : contact.id + ' · ') +
                  'channel · ' +
                  (messenger.radioChannel(contact) === null ? 'irc only' : 'radio and irc')
              : 'linked by you · stock apps · unverified',
            { color: colors.muted, fontSize: 11 }
          )
        ])
      ])
    )

    if (this._editing) {
      this._alias.value = contact.alias ?? ''
      content.appendChild(label('alias · press done to save'))
      content.appendChild(this._alias)
    }

    content.appendChild(label('reach ' + name + ' on · tried in order'))

    let order = 1
    const row = (network: string, address: string, seen: string, color: string) =>
      view(
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 6
        },
        [
          text(String(order++), { color: colors.muted, fontSize: 12 }),
          text(network, { color, fontSize: 12, fontWeight: 'bold', width: 44 }),
          text(address, { color: colors.text, fontSize: 12, flex: 1 }, 1),
          text(seen, { color: colors.muted, fontSize: 11 })
        ]
      )

    if (contact.channel) {
      const index = messenger.radioChannel(contact)
      if (index !== null) {
        content.appendChild(row('lora', 'radio channel ' + index, '', colors.lora))
      }
      content.appendChild(row('irc', contact.id, '', colors.irc))

      const here = this.ui.presence.inChannel(contact.id)
      content.appendChild(label('here now · ' + here.length + ' · tap to message'))
      for (const person of here.slice(0, HERE)) {
        content.appendChild(personRow(this.ui, person, contactOf(this.ui, person)))
      }
      if (here.length > HERE) {
        content.appendChild(
          text('and ' + (here.length - HERE) + ' more: see contacts', {
            color: colors.muted,
            fontSize: 11
          })
        )
      }
    } else {
      for (const node of contact.nodes) {
        content.appendChild(row('lora', node, ago(messenger.heard.since(node)), colors.lora))
      }
      for (const nick of contact.nicks) {
        content.appendChild(row('irc', nick, this.ui.online(nick) ? 'online' : '', colors.irc))
      }
      content.appendChild(this._link)

      // The few most recent: a list of everyone would be long and slow.
      const recent = (c: Contact) => messenger.thread(c).at(-1)?.time ?? 0
      const others = messenger.contacts
        .all()
        .filter((c) => c !== contact && !c.channel)
        .sort((a, b) => recent(b) - recent(a))
        .slice(0, 8)
      if (others.length > 0) {
        content.appendChild(label('same person as… · joins them into one'))
        const chips = view({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })
        for (const other of others) {
          chips.appendChild(
            button(
              displayName(other),
              () => this.ui.messenger.join(contact, other),
              chip(colors.soft)
            )
          )
        }
        content.appendChild(chips)
      }

      content.appendChild(
        text(
          '// ' +
            name +
            " doesn't need this app. your messages reach them in whatever client they already use, and their replies land here in one thread.",
          { color: colors.muted, fontSize: 11, lineHeight: 17 }
        )
      )
    }

    content.appendChild(button('message', () => this.ui.select(contact), primary()))
  }

  // Edit, or done: done saves the alias as typed.
  _edit(): void {
    if (this._editing) {
      const alias = this._alias.value.trim()
      this.ui.messenger.rename(this.ui.selected!, alias === '' ? null : alias)
    }
    this._editing = !this._editing
    this.render()
  }

  _linkAddress(): void {
    const value = this._link.value.trim()
    if (value === '' || this.ui.selected === null) return
    const address = value.startsWith('!') ? { node: value.toLowerCase() } : { nick: value }
    // Linking an address someone else holds joins the two into this one.
    const contact = this.ui.messenger.link(this.ui.selected, address)
    this._link.value = ''
    this.ui.selected = contact
    this.render()
  }
}
