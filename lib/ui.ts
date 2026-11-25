import native from 'bare-native'
import theme from './theme.ts'
import type Messenger from './messenger.ts'
import { displayName } from './contacts.ts'
import type { Contact, Message } from './types.ts'
import Log, { line } from './log.ts'
import type { Entry } from './log.ts'

const { View, Text, TextInput, ScrollView, Clipboard } = native
const { colors, font } = theme

export interface UiActions {
  connectRadio(): void
  connectIrc(opts: { nick: string; password: string; register: boolean }): void
}

// The whole app view: chats, the selected conversation, the composer, and the
// radio and IRC controls. On a narrow screen it shows the chats or the
// conversation, one at a time; on a wide one, both side by side.
//
// It redraws from the Messenger on every change, which is plenty for a
// first attempt.
export default class Ui {
  messenger: Messenger
  actions: UiActions
  compact: boolean
  selected: Contact | null
  root: any

  _status: any
  _radio: any
  _banner: any
  _side: any
  _divider: any
  _main: any
  _list: any
  _thread: any
  _input: any
  _nick: any
  _password: any
  _header: any
  _info: any
  _alias: any
  _showInfo: boolean
  log: Log
  _showLog: boolean
  _body: any
  _logPanel: any
  _logList: any

  constructor(
    messenger: Messenger,
    actions: UiActions,
    opts: { compact?: boolean; nick?: string; password?: string; log?: Log } = {}
  ) {
    this.messenger = messenger
    this.actions = actions
    this.compact = opts.compact ?? false
    this.selected = null
    this._showInfo = false
    this.log = opts.log ?? new Log()
    this._showLog = false

    this._status = text('', { color: colors.muted, fontSize: 12, flex: 1, textAlign: 'right' })

    const title = button('~/ekho', () => this.select(null), {
      color: colors.text,
      fontSize: 16,
      fontWeight: 'bold'
    })

    const header = view(
      {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14
      },
      [title, this._status, button('log', () => this.toggleLog(), chip(colors.muted))]
    )

    this._list = new ScrollView()
    this._list.style = { flex: 1 }

    this._nick = input('nick, from your node short name')
    this._password = input('password, stored on this device', { secureTextEntry: true })
    this._nick.value = opts.nick ?? ''
    this._radio = text('not connected', { color: colors.muted, fontSize: 12 })
    this._password.value = opts.password ?? ''

    const setup = view({ padding: 14, gap: 8 }, [
      text('// radio', { color: colors.muted, fontSize: 11 }),
      button('connect t1000-e', () => this.actions.connectRadio(), chip(colors.accent)),
      this._radio,
      text('// irc fallback · irc.motaba.net', { color: colors.muted, fontSize: 11 }),
      this._nick,
      this._password,
      view({ flexDirection: 'row', gap: 8 }, [
        button('log in', () => this._connectIrc(false), chip(colors.text)),
        button('register', () => this._connectIrc(true), chip(colors.irc))
      ])
    ])

    this._side = view({ width: 300 }, [this._list, rule(), setup])
    this._divider = view({ width: 1, backgroundColor: colors.line })

    this._thread = new ScrollView()
    this._thread.style = { flex: 1 }
    this._thread.contentStyle = { padding: 16, gap: 14 }

    this._input = input('message')
    this._input.returnKeyType = 'send'
    this._input.on('submit', () => this._send())

    const composer = view(
      {
        flexDirection: 'row',
        gap: 8,
        padding: 12
      },
      [
        view({ flex: 1 }, [this._input]),
        button('send', () => this._send(), {
          ...chip(colors.ground),
          backgroundColor: colors.accent,
          borderColor: colors.accent,
          fontWeight: 'bold'
        })
      ]
    )

    // The selected contact's name, and the way into their info.
    this._header = view({
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10
    })

    // Contact info: every address they're known by, an alias, and joining.
    this._alias = input('alias, optional')
    this._alias.returnKeyType = 'done'
    this._alias.on('submit', () => {
      const alias = this._alias.value.trim()
      this.messenger.rename(this.selected!, alias === '' ? null : alias)
    })
    this._info = new ScrollView()
    this._info.style = { flex: 1 }
    this._info.contentStyle = { padding: 16, gap: 10 }

    this._main = view({ flex: 1 }, [
      this._header,
      rule(),
      this._info,
      this._thread,
      rule(),
      composer
    ])

    this._body = view({ flex: 1, flexDirection: 'row' }, [this._side, this._divider, this._main])

    // Everything the app has reported, to read or copy and share.
    this._logList = new ScrollView()
    this._logList.style = { flex: 1 }
    this._logList.contentStyle = { padding: 14, gap: 6 }
    this._logPanel = view({ flex: 1, display: 'none' }, [
      view({ flexDirection: 'row', gap: 8, padding: 14 }, [
        text('// log · info, warnings and errors', { color: colors.muted, fontSize: 11, flex: 1 }),
        button('copy', () => this.copyLog(), chip(colors.accent)),
        button('close', () => this.toggleLog(), chip(colors.text))
      ]),
      rule(),
      this._logList
    ])
    this.log.on('entry', (entry: Entry) => {
      if (this._showLog) this._logList.content.appendChild(logLine(entry))
    })

    // Errors show here, above a UI that keeps working.
    this._banner = view({ display: 'none' })

    this.root = view(
      {
        flex: 1,
        backgroundColor: colors.ground,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)'
      },
      [this._banner, header, rule(), this._body, this._logPanel]
    )

    messenger.on('contacts', () => this.render())
    messenger.on('message', () => this.render())
    messenger.on('update', () => this.render())
    messenger.on('status', () => this.render())

    this.render()
  }

  // What the radio is doing, in words: scanning, connected, or what went wrong.
  setRadioStatus(status: string, failed = false): void {
    this._radio.text = status
    this._radio.style = { color: failed ? colors.failed : colors.muted, fontSize: 12 }
  }

  showError(message: string): void {
    clear(this._banner)
    this._banner.style = { padding: 14, gap: 8, backgroundColor: colors.panel }
    this._banner.appendChild(text(message, { color: colors.failed, fontSize: 12 }))
    this._banner.appendChild(button('dismiss', () => this.hideError(), chip(colors.failed)))
  }

  hideError(): void {
    clear(this._banner)
    this._banner.style = { display: 'none' }
  }

  toggleLog(): void {
    this._showLog = !this._showLog
    clear(this._logList.content)
    if (this._showLog) {
      for (const entry of this.log.entries) this._logList.content.appendChild(logLine(entry))
      this._logList.contentOffset = { y: Number.MAX_SAFE_INTEGER }
    }
    this.render()
  }

  copyLog(): void {
    Clipboard.setString(this.log.toString())
    this.log.info('log copied to the clipboard')
  }

  setCompact(compact: boolean): void {
    this.compact = compact
    this.render()
  }

  select(contact: Contact | null): void {
    this.selected = contact
    this._showInfo = false
    this.render()
  }

  toggleInfo(): void {
    this._showInfo = !this._showInfo
    if (this._showInfo) this._alias.value = this.selected!.alias ?? ''
    this.render()
  }

  render(): void {
    const s = this.messenger.status()
    this._status.text =
      'lora ' +
      (s.radio ? s.heard + ' heard' : 'off') +
      ' · irc ' +
      (s.irc ? 'on' : 'off') +
      ' · route ' +
      s.route

    const showSide = !this.compact || this.selected === null
    const showMain = !this.compact || this.selected !== null

    this._side.style = {
      ...this._side.style,
      display: showSide ? 'flex' : 'none',
      width: this.compact ? '100%' : 300
    }
    this._divider.style = {
      width: 1,
      backgroundColor: colors.line,
      display: this.compact ? 'none' : 'flex'
    }
    this._main.style = { flex: 1, display: showMain ? 'flex' : 'none' }
    this._body.style = { flex: 1, flexDirection: 'row', display: this._showLog ? 'none' : 'flex' }
    this._logPanel.style = { flex: 1, display: this._showLog ? 'flex' : 'none' }

    // A contact merged away no longer exists.
    if (this.selected !== null && this.messenger.contacts.get(this.selected.id) === null) {
      this.selected = null
    }

    this._info.style = { flex: 1, display: this._showInfo ? 'flex' : 'none' }
    this._thread.style = { flex: 1, display: this._showInfo ? 'none' : 'flex' }

    this._renderList()
    this._renderHeader()
    this._renderInfo()
    this._renderThread()
  }

  _renderHeader(): void {
    clear(this._header)
    if (this.selected === null) return

    this._header.appendChild(
      text(displayName(this.selected), {
        color: colors.text,
        fontWeight: 'bold',
        fontSize: 14,
        flex: 1
      })
    )
    this._header.appendChild(
      button(this._showInfo ? 'messages' : 'info', () => this.toggleInfo(), chip(colors.text))
    )
  }

  _renderInfo(): void {
    // The alias field lives across renders, so take it out before clearing.
    if (this._alias.parent !== null) this._info.content.removeChild(this._alias)
    clear(this._info.content)
    if (this.selected === null || !this._showInfo) return

    const contact = this.selected
    const content = this._info.content
    const label = (value: string) => text(value, { color: colors.muted, fontSize: 11 })

    content.appendChild(label('// alias'))
    content.appendChild(this._alias)

    content.appendChild(label('// known as'))
    for (const node of contact.nodes) {
      const since = this.messenger.heard.since(node)
      content.appendChild(
        text('lora  ' + node + '  ' + (since === Infinity ? 'not heard' : 'heard ' + ago(since)), {
          color: colors.text,
          fontSize: 13
        })
      )
    }
    for (const nick of contact.nicks) {
      content.appendChild(text('irc   ' + nick, { color: colors.irc, fontSize: 13 }))
    }

    if (contact.channel) return

    content.appendChild(label('// same person as… (joins them into this contact)'))
    for (const other of this.messenger.contacts.all()) {
      if (other === contact || other.channel) continue
      content.appendChild(
        button(
          displayName(other) + '  [' + address(other) + ']',
          () => this.messenger.join(contact, other),
          chip(colors.soft)
        )
      )
    }
  }

  _renderList(): void {
    clear(this._list.content)

    for (const contact of this.messenger.contacts.all()) {
      const thread = this.messenger.thread(contact)
      const last = thread[thread.length - 1]
      const active = this.selected !== null && this.selected.id === contact.id

      this._list.content.appendChild(
        press(
          view(
            {
              padding: 14,
              gap: 4,
              backgroundColor: active ? colors.panel : colors.ground
            },
            [
              text(displayName(contact), { color: colors.text, fontWeight: 'bold', fontSize: 14 }),
              text(last ? last.text : '', { color: colors.soft, fontSize: 13 }, 1),
              text('[' + address(contact) + ']', { color: colors.muted, fontSize: 11 })
            ]
          ),
          () => this.select(contact)
        )
      )
      this._list.content.appendChild(rule())
    }
  }

  _renderThread(): void {
    clear(this._thread.content)
    if (this.selected === null) return

    for (const msg of this.messenger.thread(this.selected)) {
      this._thread.content.appendChild(this._message(msg))
    }

    this._thread.contentOffset = { y: Number.MAX_SAFE_INTEGER }
  }

  _message(msg: Message): any {
    const mine = msg.state !== 'received'
    const tone =
      msg.state === 'failed' ? colors.failed : msg.via === 'irc' ? colors.irc : colors.accent

    const meta =
      time(msg.time) +
      ' ' +
      (mine ? 'you' : (msg.from ?? displayName(this.selected!))) +
      ' [' +
      msg.via +
      (msg.address ? ' ' + msg.address : '') +
      (msg.hops ? ' · ' + msg.hops + ' hops' : '') +
      ']' +
      (mine ? ' ' + msg.state + (msg.reason ? ' · ' + msg.reason : '') : '')

    const children = [
      text(meta, { color: mine ? tone : colors.muted, fontSize: 11 }),
      // A coloured bar down the left, as a view: borders paint on every side.
      view({ flexDirection: 'row', gap: 10 }, [
        view({ width: 2, backgroundColor: mine ? tone : colors.edge }),
        text(msg.text, { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 })
      ])
    ]

    if (msg.state === 'received') {
      children.push(
        view({ flexDirection: 'row', gap: 8, paddingLeft: 12 }, [
          button('♥', () => this.messenger.react(msg, '♥'), chip(colors.muted)),
          button('+1', () => this.messenger.react(msg, '👍'), chip(colors.muted))
        ])
      )
    }

    if (msg.state === 'failed') {
      children.push(
        view({ flexDirection: 'row', gap: 8, paddingLeft: 12 }, [
          button('retry on lora', () => this.messenger.retry(msg), chip(colors.text)),
          button('send via irc', () => this.messenger.sendViaIrc(msg), chip(colors.irc))
        ])
      )
    }

    return view({ gap: 4 }, children)
  }

  _send(): void {
    const value = this._input.value.trim()
    if (value === '' || this.selected === null) return

    this.messenger.send(this.selected, value)
    this._input.value = ''
  }

  _connectIrc(register: boolean): void {
    this.actions.connectIrc({
      nick: this._nick.value.trim(),
      password: this._password.value,
      register
    })
  }
}

function view(style: object, children: any[] = []): any {
  const v = new View()
  v.style = style
  for (const child of children) v.appendChild(child)
  return v
}

function logLine(entry: Entry): any {
  const color =
    entry.level === 'error' ? colors.failed : entry.level === 'warn' ? colors.irc : colors.soft
  return text(line(entry), { color, fontSize: 11 })
}

// A one-point line between sections.
function rule(): any {
  return view({ height: 1, backgroundColor: colors.line })
}

function text(value: string, style: object, lines = 0): any {
  const t = new Text(value)
  t.style = { fontFamily: font, ...style }
  if (lines) t.numberOfLines = lines
  return t
}

function input(placeholder: string, opts: { secureTextEntry?: boolean } = {}): any {
  const i = new TextInput(opts)
  i.placeholder = placeholder
  i.autoCapitalize = 'none'
  i.autoCorrect = false
  i.style = {
    fontFamily: font,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.edge,
    borderRadius: 6,
    padding: 10
  }
  return i
}

function chip(color: string): { color: string } & object {
  return {
    color,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: color,
    borderRadius: 4
  }
}

// A label in a box that acts on a tap or click. Pointer events arrive on
// views, so the text sits inside one.
function button(
  label: string,
  onpress: () => void,
  style: { color: string; fontSize?: number; fontWeight?: string } & object
): any {
  const { color, fontSize = 12, fontWeight = 'normal', ...box } = style
  return press(
    view({ ...box, cursor: 'pointer', alignSelf: 'flex-start' }, [
      text(label, { color, fontSize, fontWeight })
    ]),
    onpress
  )
}

function press(node: any, onpress: () => void): any {
  node.on('pointerup', onpress)
  return node
}

// Destroying a child removes it from its parent, so walk a copy.
function clear(node: any): void {
  for (const child of [...node.children]) child.destroy()
}

function address(contact: Contact): string {
  if (contact.channel) return 'channel · ' + contact.nicks.join(', ')
  return contact.nodes.concat(contact.nicks.map((nick) => 'irc:' + nick)).join(' · ')
}

function ago(ms: number): string {
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return Math.round(ms / 60_000) + 'm ago'
  return Math.round(ms / 3_600_000) + 'h ago'
}

function time(ms: number): string {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
