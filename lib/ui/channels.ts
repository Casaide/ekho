import type Ui from './index.ts'
import type { Contact } from '../types.ts'
import { displayName } from '../contacts.ts'
import {
  colors,
  view,
  text,
  scroll,
  press,
  clear,
  heading,
  avatar,
  label,
  dot,
  button,
  chip
} from './kit.ts'

// `~/channels`: the channels you're in, with who's there now and whether
// they reach the radio, then the rest of the server's channels to join.
export default class Channels {
  ui: Ui
  root: any

  _summary: any
  _list: any
  _key: string

  constructor(ui: Ui) {
    this.ui = ui

    this._summary = text('', { color: colors.muted, fontSize: 12 })
    this._list = scroll({ paddingHorizontal: 18, paddingVertical: 10, gap: 10 })
    this._key = ''

    this.root = view({ flex: 1 }, [
      view({ paddingHorizontal: 18, paddingTop: 16, gap: 12 }, [
        heading('~/', 'channels'),
        this._summary
      ]),
      this._list
    ])
  }

  render(): void {
    const { messenger, presence } = this.ui
    const joined = messenger.contacts.all().filter((c) => c.channel)
    const others = this.ui.channels().filter((c) => !c.joined)
    const here = (c: Contact) => presence.inChannel(c.id).length

    this._summary.text = joined.length + ' joined · ' + others.length + ' more on the server'

    // Rebuild only when what's listed changed, not for every event.
    const key = [
      joined.map((c) => c.id + displayName(c) + here(c) + messenger.radioChannel(c)).join(),
      others.map((c) => c.name + c.users).join()
    ].join('|')
    if (key === this._key) return
    this._key = key

    const content = this._list.content
    clear(content)

    content.appendChild(label('joined · tap to open'))
    for (const contact of joined) content.appendChild(this._row(contact, here(contact)))

    if (others.length > 0) {
      content.appendChild(label('on the server · tap to join'))
      const wrap = view({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })
      for (const channel of others) {
        const radio = messenger.radioChannelOf(channel.name) !== null
        wrap.appendChild(
          button(
            channel.name + ' · ' + channel.users + (radio ? ' · radio' : ''),
            () => this.ui.openChannel(channel.name),
            chip(colors.muted)
          )
        )
      }
      content.appendChild(wrap)
    }
  }

  _row(contact: Contact, here: number): any {
    const radio = this.ui.messenger.radioChannel(contact)
    const name = displayName(contact)
    const where = radio === null ? 'irc only' : 'radio channel ' + radio + ' and irc'

    return press(
      view({ flexDirection: 'row', gap: 12, paddingVertical: 8, cursor: 'pointer' }, [
        avatar('#'),
        view({ flex: 1, gap: 3 }, [
          view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [
            text(name, { color: colors.text, fontSize: 14, fontWeight: 'bold' }, 1),
            dot(here > 0, colors.irc)
          ]),
          text(name === contact.id ? where : contact.id + ' · ' + where, {
            color: radio === null ? colors.muted : colors.lora,
            fontSize: 11
          }),
          text(here + ' here now', { color: here > 0 ? colors.irc : colors.muted, fontSize: 11 })
        ])
      ]),
      () => this.ui.select(contact)
    )
  }
}
