import native from 'bare-native'
import theme from './theme.ts'
import type Messenger from './messenger.ts'
import { displayName } from './contacts.ts'
import type { Contact, Message } from './types.ts'
import Log, { line } from './log.ts'
import type { Entry } from './log.ts'

const { View, Text, TextInput, ScrollView, Clipboard, Keyboard, ActivityIndicator } = native
const { colors, font } = theme

export interface UiActions {
  connectRadio(): void
  disconnectRadio(): void
  connectIrc(opts: { nick: string; password: string; register: boolean }): void
  finishOnboarding(): void
}

export type Page = 'chats' | 'onboarding' | 'settings' | 'log'

// The whole app view. Pages: onboarding (first run: connect the radio, log in
// to IRC), chats (the list, the selected conversation, the composer),
// settings (the same radio and IRC controls, later) and the log. On a narrow
// screen chats shows the list or the conversation, one at a time; on a wide
// one, both side by side.
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
  _radioButton: any
  _spinner: any
  _irc: any
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
  page: Page
  _body: any
  _logPanel: any
  _logList: any
  _setup: any
  _onboarding: any
  _settings: any
  _headerButton: any

  constructor(
    messenger: Messenger,
    actions: UiActions,
    opts: {
      compact?: boolean
      nick?: string
      password?: string
      log?: Log
      onboarded?: boolean
    } = {}
  ) {
    this.messenger = messenger
    this.actions = actions
    this.compact = opts.compact ?? false
    this.selected = null
    this._showInfo = false
    this.log = opts.log ?? new Log()
    this.page = opts.onboarded === false ? 'onboarding' : 'chats'

    this._status = text('', { color: colors.muted, fontSize: 11 })

    const title = button('~/ekho', () => this.select(null), {
      color: colors.text,
      fontSize: 16,
      fontWeight: 'bold'
    })

    // The app name and the log on one line, where the radio and IRC stand on
    // the next, so neither crowds the other on a phone.
    const header = view({ paddingHorizontal: 14, paddingVertical: 10, gap: 4 }, [
      view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [
        mark(),
        view({ flex: 1 }, [title]),
        (this._headerButton = view())
      ]),
      this._status
    ])

    this._list = new ScrollView()
    this._list.style = { flex: 1 }

    this._nick = input('nick, from your node short name')
    this._password = input('password, stored on this device', { secureTextEntry: true })
    this._nick.value = opts.nick ?? ''
    this._radio = text('not connected', { color: colors.muted, fontSize: 12 })
    this._radioButton = view()
    this._spinner = new ActivityIndicator()
    this._spinner.style = { color: colors.accent, display: 'none' }
    this._irc = text('not logged in', { color: colors.muted, fontSize: 12 })
    this._password.value = opts.password ?? ''

    // The radio and IRC controls: on the onboarding page the first time, in
    // settings after that. One set, moved between the two.
    this._setup = view({ gap: 8 }, [
      text('// radio', { color: colors.muted, fontSize: 11 }),
      this._radioButton,
      view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [this._spinner, this._radio]),
      text('// irc fallback · irc.motaba.net', { color: colors.muted, fontSize: 11 }),
      this._nick,
      this._password,
      view({ flexDirection: 'row', gap: 8 }, [
        button('log in', () => this._connectIrc(false), chip(colors.text)),
        button('register', () => this._connectIrc(true), chip(colors.irc))
      ]),
      this._irc
    ])
    this.setRadioConnected(null)

    this._side = view({ width: 300 }, [this._list])
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
      [view({ flex: 1 }, [this._input]), button('send', () => this._send(), primary())]
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
        button('close', () => this.show('settings'), chip(colors.text))
      ]),
      rule(),
      this._logList
    ])
    this.log.on('entry', (entry: Entry) => {
      if (this.page === 'log') this._logList.content.appendChild(logLine(entry))
    })

    this._onboarding = page()
    this._settings = page()

    // Typing in a field near the bottom: bring it into view above the keyboard.
    for (const field of [this._nick, this._password]) {
      field.on('focus', () => {
        const scroll = this.page === 'onboarding' ? this._onboarding : this._settings
        setTimeout(() => (scroll.contentOffset = { y: Number.MAX_SAFE_INTEGER }), 300)
      })
    }

    // Errors show here, above a UI that keeps working.
    this._banner = view({ display: 'none' })

    this.root = view(
      {
        flex: 1,
        backgroundColor: colors.ground,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)'
      },
      [this._banner, header, rule(), this._body, this._onboarding, this._settings, this._logPanel]
    )

    // Lift everything above the on-screen keyboard while it's open.
    Keyboard.on('change', ({ height }: { height: number }) => {
      this.root.style = {
        ...this.root.style,
        paddingBottom: height > 0 ? height : 'env(safe-area-inset-bottom)'
      }
    })

    messenger.on('contacts', () => this.render())
    messenger.on('message', () => this.render())
    messenger.on('update', () => this.render())
    messenger.on('status', () => this.render())

    this._fillPage()
    this.render()
  }

  // A spinner beside the radio status while it connects.
  setRadioBusy(busy: boolean): void {
    this._spinner.animating = busy
    this._spinner.style = { color: colors.accent, display: busy ? 'flex' : 'none' }
  }

  // What the radio is doing, in words: scanning, connected, or what went wrong.
  setRadioStatus(status: string, failed = false): void {
    this._radio.text = status
    this._radio.style = {
      color: failed ? colors.failed : colors.muted,
      fontFamily: font,
      fontSize: 12,
      flex: 1
    }
  }

  // The radio's button: connect when there's none, disconnect when there is.
  setRadioConnected(id: string | null): void {
    clear(this._radioButton)
    this._radioButton.appendChild(
      id === null
        ? button('connect t1000-e', () => this.actions.connectRadio(), chip(colors.accent))
        : button('disconnect ' + id, () => this.actions.disconnectRadio(), chip(colors.muted))
    )
  }

  // What IRC is doing, in words: logged in, what NickServ said, or what failed.
  setIrcStatus(status: string, failed = false): void {
    this._irc.text = status
    this._irc.style = {
      color: failed ? colors.failed : colors.muted,
      fontFamily: font,
      fontSize: 12
    }
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

  show(page: Page): void {
    this.page = page
    clear(this._logList.content)
    if (page === 'log') {
      for (const entry of this.log.entries) this._logList.content.appendChild(logLine(entry))
      this._logList.contentOffset = { y: Number.MAX_SAFE_INTEGER }
    }
    this._fillPage()
    this.render()
  }

  finishOnboarding(): void {
    this.actions.finishOnboarding()
    this.show('chats')
  }

  // Rebuild the onboarding or settings page around the shared controls.
  _fillPage(): void {
    if (this._setup.parent !== null) this._setup.parent.removeChild(this._setup)
    clear(this._onboarding.content)
    clear(this._settings.content)

    const label = (value: string) => text(value, { color: colors.muted, fontSize: 11 })

    if (this.page === 'onboarding') {
      const content = this._onboarding.content
      content.appendChild(
        text('welcome to ekho', { color: colors.text, fontSize: 20, fontWeight: 'bold' })
      )
      content.appendChild(
        text(
          'Message people over LoRa with your T1000-E. When no radio is in range, ' +
            'messages go over IRC instead, through irc.motaba.net. Set up either or both; ' +
            'you can change this later in settings.',
          { color: colors.soft, fontSize: 13, lineHeight: 20 }
        )
      )
      content.appendChild(this._setup)
      content.appendChild(button('start messaging', () => this.finishOnboarding(), primary()))
    }

    if (this.page === 'settings') {
      const content = this._settings.content
      content.appendChild(
        view({ flexDirection: 'row', alignItems: 'center' }, [
          text('settings', { color: colors.text, fontSize: 18, fontWeight: 'bold', flex: 1 }),
          button('close', () => this.show('chats'), chip(colors.text))
        ])
      )
      content.appendChild(this._setup)
      content.appendChild(label('// help'))
      content.appendChild(button('view log', () => this.show('log'), chip(colors.muted)))
    }
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
    const on = (page: Page) => (this.page === page ? 'flex' : 'none')
    this._body.style = { flex: 1, flexDirection: 'row', display: on('chats') }
    this._onboarding.style = { flex: 1, display: on('onboarding') }
    this._settings.style = { flex: 1, display: on('settings') }
    this._logPanel.style = { flex: 1, display: on('log') }

    clear(this._headerButton)
    if (this.page === 'chats') {
      this._headerButton.appendChild(
        button('settings', () => this.show('settings'), chip(colors.muted))
      )
    }

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

// The ekho mark, a node and its echo, drawn from views: a dot and three
// widening bars that fade out.
function mark(): any {
  const bar = (height: number, opacity: number) =>
    view({ width: 3, height, borderRadius: 2, backgroundColor: colors.accent, opacity })
  return view({ flexDirection: 'row', alignItems: 'center', gap: 3 }, [
    view({ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent }),
    bar(9, 1),
    bar(14, 0.6),
    bar(19, 0.3)
  ])
}

// A page of its own that scrolls: onboarding and settings.
function page(): any {
  const scroll = new ScrollView()
  scroll.style = { flex: 1, display: 'none' }
  scroll.contentStyle = { padding: 20, gap: 16 }
  return scroll
}

function primary(): { color: string } & object {
  return {
    ...chip(colors.ground),
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    fontWeight: 'bold'
  }
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
    view({ alignSelf: 'flex-start', ...box, cursor: 'pointer' }, [
      text(label, { color, fontSize, fontWeight })
    ]),
    onpress
  )
}

// Acts on a tap or click, and dims while pressed so the touch shows.
function press(node: any, onpress: () => void): any {
  const dim = (opacity: number) => (node.style = { ...node.style, opacity })
  node.on('pointerdown', () => dim(0.5))
  node.on('pointercancel', () => dim(1))
  node.on('pointerup', () => {
    dim(1)
    onpress()
  })
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
