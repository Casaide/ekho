import type Ui from './index.ts'
import { parse } from '../code.ts'
import {
  colors,
  view,
  text,
  input,
  button,
  chip,
  primary,
  clear,
  detach,
  label,
  box
} from './kit.ts'

// Where linking stands, as the app tells the UI.
export interface LinkState {
  // On its own, holding the radio and IRC with devices linked to it, or
  // linked to such a device.
  role: 'alone' | 'hub' | 'linked'
  // The code open for another device to type, as the hub.
  code: string | null
  // Devices linked to this one, by name.
  devices: string[]
  // Typing a code in: sent and waiting.
  joining: boolean
  error: string | null
}

// Linking another device, such as a Mac, to the phone that holds the radio
// and IRC: the phone shows a code, the other device types it. On the radio
// screen. The code field is built once, so typing survives a redraw.
export class LinkCard {
  ui: Ui
  root: any

  _code: any

  constructor(ui: Ui) {
    this.ui = ui
    this.root = view({ gap: 10 })
    this._code = input('code from your phone: xxxxx-xxxxx')
    this._code.returnKeyType = 'go'
    this._code.on('submit', () => this._join())
  }

  render(): void {
    const { linking } = this.ui
    detach(this._code)
    clear(this.root)

    this.root.appendChild(label('devices'))

    if (linking.role === 'linked') {
      this.root.appendChild(
        note('linked to your phone: messages come and go through its radio and irc.')
      )
      this.root.appendChild(button('unlink', () => this.ui.actions.unlink(), chip(colors.muted)))
      return
    }

    if (linking.code !== null) {
      this.root.appendChild(
        view({ ...box(), alignItems: 'center', gap: 6 }, [
          text(linking.code, {
            color: colors.accent,
            fontSize: 26,
            fontWeight: 'bold',
            letterSpacing: 2
          }),
          text('type this on your other device · works for 10 minutes', {
            color: colors.muted,
            fontSize: 11
          })
        ])
      )
      this.root.appendChild(button('cancel', () => this.ui.actions.closeLink(), chip(colors.muted)))
    } else {
      this.root.appendChild(
        note('see and send your messages on another device, such as a mac, through this one.')
      )
      this.root.appendChild(
        button('link a device ›', () => this.ui.actions.openLink(), chip(colors.accent))
      )
    }

    for (const name of linking.devices) {
      this.root.appendChild(
        view({ flexDirection: 'row', alignItems: 'center', gap: 10 }, [
          text(name, { color: colors.text, fontSize: 13, flex: 1 }),
          button('forget', () => this.ui.actions.forgetDevice(name), chip(colors.muted))
        ])
      )
    }

    // A device with others linked to it is the one holding the radio, not
    // one to link to another.
    if (linking.devices.length > 0 || linking.code !== null) return

    this.root.appendChild(label('or link this device to your phone'))
    this.root.appendChild(this._code)
    this.root.appendChild(
      linking.joining
        ? note('linking… keep ekho open on your phone')
        : button('link', () => this._join(), primary())
    )
    if (linking.error !== null) {
      this.root.appendChild(text(linking.error, { color: colors.failed, fontSize: 12 }))
    }
  }

  _join(): void {
    const code = parse(this._code.value)
    if (code === null) {
      this.ui.linking = { ...this.ui.linking, error: 'a code is ten letters and numbers' }
      this.ui.render()
      return
    }
    this._code.value = ''
    this.ui.actions.joinLink(code)
  }
}

function note(value: string): any {
  return text(value, { color: colors.soft, fontSize: 12, lineHeight: 18 })
}
