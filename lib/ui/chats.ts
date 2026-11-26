import type Ui from './index.ts'
import type { Contact } from '../types.ts'
import { displayName } from '../contacts.ts'
import {
  colors,
  view,
  text,
  input,
  scroll,
  button,
  chip,
  press,
  clear,
  heading,
  avatar,
  dot,
  when
} from './kit.ts'

// `~/chats`: the radio at a glance, a filter, and every conversation, the
// most recent first, each with who, when, the last line and the path it took.
export default class Chats {
  ui: Ui
  root: any

  _radio: any
  _search: any
  _list: any
  _key: string
  _typing: ReturnType<typeof setTimeout> | null

  constructor(ui: Ui) {
    this.ui = ui

    this._radio = view({})
    this._search = input('/ filter')
    // Filter once typing pauses, not on every key.
    this._typing = null
    this._search.on('change', () => {
      if (this._typing !== null) clearTimeout(this._typing)
      this._typing = setTimeout(() => {
        this._typing = null
        this.render()
      }, 250)
    })
    this._key = ''
    this._list = scroll({ paddingTop: 6 })

    this.root = view({ flex: 1 }, [
      view({ paddingHorizontal: 18, paddingTop: 16, gap: 14 }, [
        view({ flexDirection: 'row', alignItems: 'center' }, [
          view({ flex: 1 }, [heading('~/', 'chats')]),
          button('+ new', () => this.ui.open('contacts'), chip(colors.muted))
        ]),
        this._radio,
        this._search
      ]),
      this._list
    ])
  }

  render(): void {
    this._renderRadio()
    this._renderList()
  }

  // `● t1000-e · ble        nodes heard 5`; opens the radio screen.
  // Linked to the phone, it's the phone's: `● via your phone · radio`.
  _renderRadio(): void {
    const { radio, messenger } = this.ui
    clear(this._radio)
    const proxied = this.ui.proxied()
    const on = proxied === null ? radio.state === 'on' : proxied.on
    const state =
      proxied !== null
        ? proxied.state
        : on
          ? 'connected'
          : radio.state === 'off'
            ? 'not connected'
            : radio.state
    this._radio.appendChild(
      press(
        view(
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            backgroundColor: colors.panel,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 6,
            cursor: 'pointer'
          },
          [
            dot(on),
            text((proxied === null ? 't1000-e · ' : 'via your phone · ') + state, {
              color: colors.text,
              fontSize: 12,
              flex: 1
            }),
            text('nodes heard ', { color: colors.muted, fontSize: 12 }),
            text(String(messenger.status().heard), { color: colors.accent, fontSize: 12 })
          ]
        ),
        () => this.ui.open('radio')
      )
    )
  }

  _renderList(): void {
    const { messenger } = this.ui
    const filter = this._search.value.trim().toLowerCase()
    const last = (c: Contact) => messenger.thread(c).at(-1)?.time ?? 0

    // Swiped away: gone until a newer message comes in.
    const cleared = (c: Contact) => (this.ui.cleared[c.id] ?? -1) >= last(c)
    const contacts = messenger.contacts
      .all()
      .filter((c) => !cleared(c))
      .filter((c) => filter === '' || displayName(c).toLowerCase().includes(filter))
      .sort((a, b) => last(b) - last(a))

    // Rebuild only when a row would look different.
    const key = [
      filter,
      this.ui.selected?.id ?? '',
      messenger.route(),
      Math.floor(messenger.now() / 60_000),
      Object.keys(this.ui.cleared).length,
      ...contacts.map((c) => {
        const msg = messenger.thread(c).at(-1)
        return c.id + displayName(c) + (msg ? msg.id + msg.state : '') + messenger.unread(c)
      })
    ].join('|')
    if (key === this._key) return
    this._key = key

    clear(this._list.content)
    for (const contact of contacts) this._list.content.appendChild(this._row(contact))

    if (contacts.length === 0) {
      this._list.content.appendChild(
        text(filter ? 'nothing matches' : 'no chats yet: start one from contacts', {
          color: colors.muted,
          fontSize: 12,
          padding: 18
        })
      )
    }
  }

  _row(contact: Contact): any {
    const { messenger } = this.ui
    const msg = messenger.thread(contact).at(-1) ?? null
    const unread = messenger.unread(contact) > 0
    const selected = this.ui.selected !== null && this.ui.selected.id === contact.id
    const name = displayName(contact)

    const preview =
      msg === null ? '' : (msg.from && contact.channel ? msg.from + ': ' : '') + msg.text
    const path = this.ui.pathOf(contact, msg)

    return press(
      view(
        {
          flexDirection: 'row',
          gap: 12,
          paddingHorizontal: 18,
          paddingTop: 12,
          backgroundColor: selected ? colors.panel : colors.ground,
          cursor: 'pointer'
        },
        [
          avatar(contact.channel ? '#' : name),
          view({ flex: 1, gap: 4, paddingBottom: 12 }, [
            view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [
              text(name, { color: colors.text, fontSize: 14, fontWeight: 'bold' }, 1),
              unread ? dot(true) : view({}),
              view({ flex: 1 }),
              text(msg ? when(msg.time, messenger.now()) : '', {
                color: colors.muted,
                fontSize: 11
              })
            ]),
            text(preview, { color: colors.soft, fontSize: 13 }, 1),
            text('[' + path.label + ']', { color: path.color, fontSize: 11 }),
            view({ height: 1, backgroundColor: colors.faint, marginTop: 8 })
          ])
        ]
      ),
      () => this.ui.select(contact),
      undefined,
      () => this.ui.clear(contact)
    )
  }
}
