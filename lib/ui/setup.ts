import type Ui from './index.ts'
import type { Entry } from '../log.ts'
import {
  colors,
  view,
  text,
  scroll,
  button,
  chip,
  chipBox,
  clear,
  detach,
  rule,
  label,
  box,
  back
} from './kit.ts'

export interface Channel {
  name: string
  users: number
  topic: string
}

// How many lines of the IRC log the screen shows.
const LOG_LINES = 8

// `~/setup/irc`: what IRC is for here, the login, what the server and
// NickServ said, and the channels to join, each marked with whether the
// radio has it too or it's IRC only.
export default class Setup {
  ui: Ui
  root: any
  channels: Channel[] | null
  joined: string[]
  main: string

  _back: any
  _body: any

  constructor(ui: Ui) {
    this.ui = ui
    this.channels = null
    this.joined = []
    this.main = ''

    this._back = back(() => this.ui.back())
    this._body = scroll({ padding: 18, gap: 14 })

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
          view({ flexDirection: 'row', flex: 1 }, [
            text('~/setup/', { color: colors.muted, fontSize: 15, fontWeight: 'bold' }),
            text('irc', { color: colors.text, fontSize: 15, fontWeight: 'bold' })
          ])
        ]
      ),
      rule(),
      this._body
    ])
  }

  render(): void {
    const content = this._body.content
    this._back.style = { ...this._back.style, display: this.ui.compact ? 'flex' : 'none' }

    detach(this.ui.form.root)
    clear(content)

    content.appendChild(
      text('irc fallback', { color: colors.text, fontSize: 16, fontWeight: 'bold' })
    )
    content.appendChild(
      text(
        'Used only when no LoRa nodes are heard. motaba bridges it to the mesh both ways. The server wants a registered nick: register once, and ekho logs you in after.',
        { color: colors.soft, fontSize: 13, lineHeight: 19 }
      )
    )

    content.appendChild(label('server'))
    content.appendChild(
      view(box(), [text('irc.motaba.net:6697 · tls', { color: colors.text, fontSize: 13 })])
    )

    content.appendChild(this.ui.form.root)

    content.appendChild(label('log'))
    content.appendChild(this._log())

    content.appendChild(label('channels · tap to join or leave'))
    content.appendChild(this._channels())
  }

  // The last few IRC lines, terminal style.
  _log(): any {
    const lines = this.ui.log.entries.filter(ircLine).slice(-LOG_LINES)
    const box = view(
      {
        gap: 4,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 6,
        backgroundColor: colors.panel
      },
      []
    )
    if (lines.length === 0) {
      box.appendChild(text('> nothing yet', { color: colors.muted, fontSize: 11 }))
    }
    for (const entry of lines) {
      box.appendChild(
        text(
          '> ' + entry.text.replace(/^irc:? ?/, ''),
          {
            color:
              entry.level === 'error'
                ? colors.failed
                : entry.text.includes('NickServ')
                  ? colors.irc
                  : colors.soft,
            fontSize: 11
          },
          2
        )
      )
    }
    return box
  }

  _channels(): any {
    const wrap = view({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })
    if (this.channels === null) {
      wrap.appendChild(text('log in to see them', { color: colors.muted, fontSize: 12 }))
      return wrap
    }

    const { messenger } = this.ui
    for (const channel of this.channels) {
      const isMain = channel.name === this.main
      const on = isMain || this.joined.includes(channel.name)
      const radio = messenger.radioChannelOf(channel.name) !== null
      const label =
        channel.name +
        ' · ' +
        channel.users +
        ' · ' +
        (radio ? 'radio' : 'irc only') +
        (isMain ? ' · always' : '')

      wrap.appendChild(
        isMain
          ? view({ ...chipBox(colors.accent), alignSelf: 'flex-start' }, [
              text(label, { color: colors.accent, fontSize: 12 })
            ])
          : button(
              label,
              () => this.ui.actions.toggleChannel(channel.name),
              chip(on ? colors.accent : colors.muted)
            )
      )
    }
    return wrap
  }
}

// Lines about IRC: our own steps, and NickServ's notices from the server.
function ircLine(entry: Entry): boolean {
  if (entry.text.startsWith('irc: ')) return true
  return entry.text.startsWith('irc <') && entry.text.includes('NickServ')
}
