import type Ui from './index.ts'
import {
  colors,
  view,
  text,
  input,
  button,
  chip,
  clear,
  dot,
  spinner,
  status,
  label
} from './kit.ts'

// The radio's card: state with a spinner while connecting, what we know of
// the device once it's up, and the one button that fits. Shown on onboarding
// and on the radio screen.
export class DeviceCard {
  ui: Ui
  root: any

  _dot: any
  _title: any
  _state: any
  _wheel: any
  _details: any
  _buttons: any

  constructor(ui: Ui) {
    this.ui = ui

    this._dot = view({})
    this._title = text('t1000-e', { color: colors.text, fontSize: 14, fontWeight: 'bold', flex: 1 })
    this._state = text('', { color: colors.muted, fontSize: 12 })
    this._wheel = spinner()
    this._details = view({ gap: 6 })
    this._buttons = view({ flexDirection: 'row', gap: 8 })

    this.root = view(
      {
        gap: 10,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 6,
        backgroundColor: colors.panel
      },
      [
        view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [this._dot, this._title]),
        view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [this._wheel, this._state]),
        this._details,
        this._buttons
      ]
    )
  }

  render(): void {
    const { radio, messenger } = this.ui
    const info = this.ui.radioInfo
    const on = radio.state === 'on'

    clear(this._dot)
    this._dot.appendChild(dot(on))
    this._title.text = on && info.longName ? info.longName : 't1000-e'

    const words: Record<string, string> = {
      off: 'not connected',
      connecting: radio.detail || 'connecting',
      on: 'connected · ' + (Bare.platform === 'android' || Bare.platform === 'ios' ? 'ble' : 'usb'),
      waiting: radio.detail,
      failed: radio.detail
    }
    status(this._state, this._wheel, radio, words[radio.state])

    clear(this._details)
    if (on) {
      const row = (name: string, value: string) =>
        view({ flexDirection: 'row' }, [
          text(name, { color: colors.muted, fontSize: 12, width: 110 }),
          text(value, { color: colors.text, fontSize: 12, flex: 1 })
        ])
      this._details.appendChild(
        row('node', (messenger.node ?? '') + (info.shortName ? ' · ' + info.shortName : ''))
      )
      this._details.appendChild(row('nodes heard', messenger.heard.count() + ' · last 15m'))
      if (info.region) this._details.appendChild(row('lora', info.region + ' · ' + info.preset))
    }

    clear(this._buttons)
    const busy = radio.state === 'connecting' || radio.state === 'waiting'
    this._buttons.appendChild(
      on
        ? button('disconnect', () => this.ui.actions.disconnectRadio(), chip(colors.muted))
        : busy
          ? button('cancel', () => this.ui.actions.disconnectRadio(), chip(colors.muted))
          : button('connect t1000-e', () => this.ui.actions.connectRadio(), chip(colors.accent))
    )
  }
}

// The IRC login: nick and password while logged out, the state, and the
// buttons that fit. Shown on onboarding and on the IRC setup screen.
export class IrcForm {
  ui: Ui
  root: any
  nick: any
  password: any

  _fields: any
  _state: any
  _wheel: any
  _buttons: any
  _notice: any

  constructor(ui: Ui, opts: { nick?: string; password?: string } = {}) {
    this.ui = ui

    this.nick = input('nick · from your node short name')
    this.nick.value = opts.nick ?? ''
    this.password = input('password · stored on this device', { secureTextEntry: true })
    this.password.value = opts.password ?? ''

    this._fields = view({ gap: 8 }, [label('nick'), this.nick, label('password'), this.password])
    this._state = text('', { color: colors.muted, fontSize: 12 })
    this._wheel = spinner()
    this._buttons = view({ flexDirection: 'row', gap: 8 })
    this._notice = text('', { color: colors.muted, fontSize: 11 })

    this.root = view({ gap: 10 }, [
      this._fields,
      view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [this._wheel, this._state]),
      this._buttons,
      this._notice
    ])
  }

  notice(value: string): void {
    this._notice.text = 'NickServ: ' + value
  }

  render(): void {
    const irc = this.ui.irc
    const nick = this.ui.messenger.irc?.nick ?? ''

    const words: Record<string, string> = {
      off: irc.detail === 'paused' ? 'paused while ekho is in the background' : 'not logged in',
      connecting: irc.detail || 'connecting',
      on: 'logged in as ' + nick,
      waiting: irc.detail,
      failed: irc.detail
    }
    status(this._state, this._wheel, irc, words[irc.state])

    const loggedOut = irc.state === 'off' || irc.state === 'failed'
    this._fields.style = { gap: 8, display: loggedOut ? 'flex' : 'none' }

    clear(this._buttons)
    if (loggedOut) {
      this._buttons.appendChild(button('log in', () => this._connect(false), chip(colors.text)))
      this._buttons.appendChild(button('register', () => this._connect(true), chip(colors.irc)))
    } else {
      this._buttons.appendChild(
        button(
          irc.state === 'on' ? 'log out' : 'cancel',
          () => this.ui.actions.logOutIrc(),
          chip(colors.muted)
        )
      )
    }
  }

  _connect(register: boolean): void {
    this.ui.actions.connectIrc({
      nick: this.nick.value.trim(),
      password: this.password.value,
      register
    })
  }
}
