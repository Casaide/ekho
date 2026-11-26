import type Ui from './index.ts'
import {
  colors,
  view,
  text,
  scroll,
  button,
  chip,
  press,
  clear,
  detach,
  heading,
  label
} from './kit.ts'

// `~/radio`: the T1000-E, the two paths and which one messages take now, and
// the radio's channels with the IRC channel each one is bridged to.
export default class RadioScreen {
  ui: Ui
  root: any

  _body: any

  constructor(ui: Ui) {
    this.ui = ui
    this._body = scroll({ padding: 18, gap: 14 })
    this.root = view({ flex: 1 }, [
      view({ paddingHorizontal: 18, paddingTop: 16 }, [heading('~/', 'radio')]),
      this._body
    ])
  }

  render(): void {
    const { messenger, radio, irc } = this.ui
    const info = this.ui.radioInfo
    const content = this._body.content

    // Built once and kept: out before the rest is cleared away.
    detach(this.ui.device.root)
    detach(this.ui.linkCard.root)
    clear(content)

    content.appendChild(this.ui.device.root)

    // Which way the next message goes, by the routing rule.
    content.appendChild(label('paths'))
    const route = messenger.route()
    const path = (
      name: string,
      detail: string,
      state: string,
      color: string,
      onpress?: () => void
    ) => {
      const row = view(
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 6,
          cursor: onpress ? 'pointer' : 'auto'
        },
        [
          text(name, { color, fontSize: 13, fontWeight: 'bold', width: 44 }),
          text(detail, { color: colors.soft, fontSize: 12, flex: 1 }, 1),
          text(state, {
            color: state === 'active' ? colors.accent : colors.muted,
            fontSize: 12
          })
        ]
      )
      return onpress ? press(row, onpress) : row
    }

    // Linked to a phone, the paths are the phone's.
    const remote = this.ui.linking.role === 'linked' ? messenger.status() : null
    if (remote !== null) {
      const online = this.ui.linking.online
      content.appendChild(
        path(
          'lora',
          'via your phone · radio ' + (remote.radio ? 'connected' : 'not connected'),
          online && remote.radio ? (route === 'lora' ? 'active' : 'no nodes heard') : 'off',
          colors.lora
        )
      )
      content.appendChild(
        path(
          'irc',
          'via your phone · irc ' + (remote.irc ? 'connected' : 'not connected'),
          online && remote.irc ? (route === 'irc' ? 'active' : 'standby') : 'off',
          colors.irc
        )
      )
    } else {
      const loraDetail =
        radio.state === 'on'
          ? 'primary · ' + (info.region ? info.region + ' · ' + info.preset : 'LoRa')
          : 'radio ' + (radio.state === 'off' ? 'not connected' : radio.state)
      content.appendChild(
        path(
          'lora',
          loraDetail,
          radio.state === 'on' ? (route === 'lora' ? 'active' : 'no nodes heard') : 'off',
          colors.lora
        )
      )

      const nick = messenger.irc?.nick ?? ''
      const ircDetail =
        irc.state === 'on'
          ? 'fallback · logged in as ' + nick
          : 'fallback · ' + (irc.state === 'off' ? 'not logged in' : irc.state)
      content.appendChild(
        path(
          'irc',
          ircDetail,
          irc.state === 'on' ? (route === 'irc' ? 'active' : 'standby ›') : 'set up ›',
          colors.irc,
          () => this.ui.open('setup')
        )
      )
    }

    this.ui.linkCard.render()
    content.appendChild(this.ui.linkCard.root)

    // Bulgarian messages in English, on this device: tap to turn on, which
    // fetches Mozilla's model once (about 30 MB), or off.
    const translator = this.ui.translator
    if (translator !== null) {
      content.appendChild(label('translation'))
      const states: Record<string, string> = {
        off: 'off',
        downloading: Math.round(translator.progress * 100) + '%',
        loading: 'loading',
        on: 'on',
        failed: 'failed'
      }
      const detail =
        translator.state === 'failed'
          ? 'failed: ' + translator.error + ' · tap to retry'
          : translator.state === 'off'
            ? 'bulgarian → english · downloads ~30 MB once'
            : translator.state === 'downloading'
              ? 'bulgarian → english · downloading the model'
              : 'bulgarian → english · on this device'
      content.appendChild(
        path('bg→en', detail, states[translator.state], colors.accent, () =>
          this.ui.actions.toggleTranslate()
        )
      )
    }

    // The radio's channels and the IRC channel the bridge pairs with each.
    content.appendChild(label('channels on the radio'))
    if (info.channels.length === 0) {
      content.appendChild(
        text('connect the radio to see its channels', { color: colors.muted, fontSize: 12 })
      )
    }
    for (const channel of info.channels) {
      const contact = messenger.contacts
        .all()
        .find((c) => c.channel && messenger.radioChannel(c) === channel.index)
      content.appendChild(
        view({ flexDirection: 'row', gap: 10, paddingVertical: 4 }, [
          text(String(channel.index), { color: colors.muted, fontSize: 12, width: 16 }),
          text(channel.name || 'LongFast (primary)', { color: colors.text, fontSize: 12, flex: 1 }),
          text(
            contact
              ? '↔ ' + contact.id
              : '↔ #' + (channel.name || '').toLowerCase() + ' (not joined)',
            {
              color: contact ? colors.irc : colors.muted,
              fontSize: 12
            }
          )
        ])
      )
    }

    content.appendChild(
      view({ flexDirection: 'row', gap: 8, paddingTop: 6 }, [
        button('irc setup ›', () => this.ui.open('setup'), chip(colors.irc)),
        button('view log ›', () => this.ui.open('log'), chip(colors.muted))
      ])
    )
  }
}
