import type Ui from './index.ts'
import {
  colors,
  view,
  text,
  scroll,
  button,
  chip,
  primary,
  clear,
  detach,
  mark,
  label
} from './kit.ts'

// The first run: what ekho is, the radio, and IRC. Either or both can be set
// up here; both live on the radio and IRC setup screens after.
export default class Onboarding {
  ui: Ui
  root: any

  _body: any

  constructor(ui: Ui) {
    this.ui = ui
    this._body = scroll({ padding: 20, gap: 16 })
    this.root = view({ flex: 1 }, [this._body])
  }

  render(): void {
    const content = this._body.content
    detach(this.ui.device.root)
    detach(this.ui.form.root)
    clear(content)

    content.appendChild(view({ flexDirection: 'row', paddingTop: 10 }, [mark()]))
    content.appendChild(
      text('welcome to ekho', { color: colors.text, fontSize: 22, fontWeight: 'bold' })
    )
    content.appendChild(
      text(
        'Message people over LoRa with your T1000-E. When no radio is in range, messages go over IRC instead, through irc.motaba.net, and reach the mesh from there. Nobody you message needs this app.',
        { color: colors.soft, fontSize: 13, lineHeight: 20 }
      )
    )

    content.appendChild(label('1 · your radio'))
    content.appendChild(
      text('Disconnect it from the Meshtastic app first: it pairs with one phone at a time.', {
        color: colors.muted,
        fontSize: 12,
        lineHeight: 17
      })
    )
    content.appendChild(this.ui.device.root)

    content.appendChild(label('2 · irc fallback · irc.motaba.net'))
    content.appendChild(this.ui.form.root)

    content.appendChild(
      view({ flexDirection: 'row', gap: 8, paddingTop: 8 }, [
        button('start messaging', () => this.ui.finishOnboarding(), primary()),
        button('view log', () => this.ui.open('log'), chip(colors.muted))
      ])
    )
  }
}
