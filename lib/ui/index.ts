import native from 'bare-native'
import type Messenger from '../messenger.ts'
import type { Contact, Message } from '../types.ts'
import Log from '../log.ts'
import Link from '../link.ts'
import Presence from '../presence.ts'
import { colors, view, text, button, chip, press, clear, detach, ago } from './kit.ts'
import { DeviceCard, IrcForm } from './parts.ts'
import Chats from './chats.ts'
import Thread from './thread.ts'
import ContactScreen from './contact.ts'
import People from './people.ts'
import RadioScreen from './radio.ts'
import Setup from './setup.ts'
import type { Channel } from './setup.ts'
import LogScreen from './log.ts'
import Onboarding from './onboarding.ts'

export type { Channel } from './setup.ts'

const { Keyboard } = native

export interface UiActions {
  connectRadio(): void
  disconnectRadio(): void
  connectIrc(opts: { nick: string; password: string; register: boolean }): void
  logOutIrc(): void
  finishOnboarding(): void
  toggleChannel(name: string): void
}

export type Page =
  | 'onboarding'
  | 'chats'
  | 'contacts'
  | 'radio'
  | 'thread'
  | 'contact'
  | 'setup'
  | 'log'

const TABS: Page[] = ['chats', 'contacts', 'radio']

// What the radio told us about itself, for the radio screen.
export interface RadioInfo {
  longName: string | null
  shortName: string | null
  region: string | null
  preset: string | null
  channels: { index: number; name: string | null; role: number }[]
}

// Below this width, one screen at a time with tabs; above, panes side by side.
const COMPACT = 700
// Wide enough for the contact beside the conversation.
const THREE_PANES = 1100

// The whole app view, after the mockups. On a phone: one screen at a time,
// with chats, contacts and radio as tabs, and conversation, contact, IRC setup
// and the log on top of them. On a desktop: the tab's list on the left, the
// open screen in the middle, and the contact on the right when there's room.
export default class Ui {
  messenger: Messenger
  actions: UiActions
  log: Log
  radio: Link
  irc: Link
  presence: Presence
  radioInfo: RadioInfo
  compact: boolean
  wide: boolean
  page: Page
  tab: Page
  selected: Contact | null
  root: any

  device: DeviceCard
  form: IrcForm

  _history: Page[]
  _banner: any
  _stage: any
  _left: any
  _center: any
  _right: any
  _panes: any
  _tabbar: any
  _hint: any

  _chats: Chats
  _thread: Thread
  _contact: ContactScreen
  _side: ContactScreen
  _people: People
  _radio: RadioScreen
  _setup: Setup
  _log: LogScreen
  _onboarding: Onboarding

  constructor(
    messenger: Messenger,
    actions: UiActions,
    opts: {
      compact?: boolean
      nick?: string
      password?: string
      log?: Log
      onboarded?: boolean
      radio?: Link
      irc?: Link
      presence?: Presence
    } = {}
  ) {
    this.messenger = messenger
    this.actions = actions
    this.log = opts.log ?? new Log()
    // Idle links stand in where none are given.
    this.radio = opts.radio ?? new Link('radio', () => new Promise(() => {}))
    this.irc = opts.irc ?? new Link('irc', () => new Promise(() => {}))
    this.presence = opts.presence ?? new Presence(messenger.heard)
    this.radioInfo = { longName: null, shortName: null, region: null, preset: null, channels: [] }
    this.compact = opts.compact ?? false
    this.wide = false
    this.page = opts.onboarded === false ? 'onboarding' : 'chats'
    this.tab = 'chats'
    this.selected = null

    this.device = new DeviceCard(this)
    this.form = new IrcForm(this, { nick: opts.nick, password: opts.password })

    this._history = []
    this._chats = new Chats(this)
    this._thread = new Thread(this)
    this._contact = new ContactScreen(this)
    this._side = new ContactScreen(this)
    this._people = new People(this)
    this._radio = new RadioScreen(this)
    this._setup = new Setup(this)
    this._log = new LogScreen(this)
    this._onboarding = new Onboarding(this)

    // Errors show here, above an app that keeps working.
    this._banner = view({ display: 'none' })
    this._tabbar = view({ flexDirection: 'row', height: 56 })
    this._stage = view({ flex: 1 })
    this._left = view({ width: 320 })
    this._center = view({ flex: 1 })
    this._right = view({ width: 320 })
    this._hint = text('pick a chat', { color: colors.muted, fontSize: 13, padding: 24 })
    this._panes = view({ flex: 1, flexDirection: 'row' }, [
      this._left,
      view({ width: 1, backgroundColor: colors.line }),
      this._center,
      view({ width: 1, backgroundColor: colors.line }),
      this._right
    ])

    this.root = view(
      {
        flex: 1,
        backgroundColor: colors.ground,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)'
      },
      [this._banner, this._stage, this._panes]
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
    messenger.on('read', () => this.render())
    this.radio.on('change', () => this.render())
    this.irc.on('change', () => this.render())
    this.presence.on('change', () => this.render())
    this.log.on('entry', () => {
      if (this.page === 'setup') this._setup.render()
    })

    this.render()
  }

  // Navigation.

  open(page: Page): void {
    if (TABS.includes(page)) {
      this.tab = page
      this._history = []
    } else if (page !== this.page && this.page !== 'onboarding') {
      this._history.push(this.page)
    }
    if (page === 'log' && this.page === 'onboarding') this._history = ['onboarding']
    this.page = page
    this.render()
  }

  // Same as open, by the name the tests and app used before.
  show(page: Page): void {
    this.open(page)
  }

  back(): void {
    this.page = this._history.pop() ?? this.tab
    this.render()
  }

  select(contact: Contact | null): void {
    this.selected = contact
    if (contact === null) {
      this.page = this.tab
      this._history = []
      return this.render()
    }
    if (this.page === 'contact') this.page = this._history.pop() ?? this.tab
    this.open('thread')
  }

  toggleInfo(): void {
    if (this.page === 'contact') this.back()
    else this.open('contact')
  }

  finishOnboarding(): void {
    this.actions.finishOnboarding()
    this._history = []
    this.page = 'chats'
    this.tab = 'chats'
    this.render()
  }

  // Layout.

  setCompact(compact: boolean): void {
    this.compact = compact
    this.render()
  }

  setWidth(width: number): void {
    this.compact = width < COMPACT
    this.wide = width >= THREE_PANES
    this.render()
  }

  // Data from the app.

  setRadioInfo(info: RadioInfo): void {
    this.radioInfo = info
    this.render()
  }

  setChannels(list: Channel[] | null, joined: string[], main: string): void {
    this._setup.channels = list
    this._setup.joined = joined
    this._setup.main = main
    if (this.page === 'setup' || this.page === 'onboarding') this.render()
  }

  setIrcNotice(value: string): void {
    this.form.notice(value)
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

  copyLog(): void {
    this._log.copy()
  }

  // Words shared by screens.

  // Under a name: how they're reached. `!a7c3e91f · heard 2m ago · irc: ivanp`
  reachLine(contact: Contact): string {
    const { messenger } = this
    if (contact.channel) {
      const index = messenger.radioChannel(contact)
      return contact.id + ' · ' + (index === null ? 'irc only' : 'radio channel ' + index)
    }
    const parts: string[] = []
    for (const node of contact.nodes.slice(0, 1)) {
      const heard = messenger.heard.since(node)
      parts.push(node + (heard === Infinity ? ' · not heard' : ' · heard ' + ago(heard)))
    }
    if (contact.nicks.length > 0) parts.push('irc: ' + contact.nicks[0])
    return parts.join(' · ')
  }

  // The tag under a chat: `lora · dm`, `lora · channel`, `irc · fallback`.
  pathOf(contact: Contact, msg: Message | null): { label: string; color: string } {
    const ircOnly = contact.channel && this.messenger.radioChannel(contact) === null
    const via = ircOnly ? 'irc' : (msg?.via ?? this.messenger.route())
    let kind = 'dm'
    if (contact.channel) kind = ircOnly ? 'irc only' : 'channel'
    else if (via === 'irc' && contact.nodes.length > 0) kind = 'fallback'
    return { label: via + ' · ' + kind, color: via === 'irc' ? colors.irc : colors.lora }
  }

  online(nick: string): boolean {
    return this.presence.people().some((p) => p.nicks.some((n) => n.nick === nick))
  }

  // Drawing.

  render(): void {
    // A contact joined into another no longer exists.
    if (this.selected !== null && this.messenger.contacts.get(this.selected.id) === null) {
      this.selected = null
      if (this.page === 'thread' || this.page === 'contact') this.page = this.tab
    }
    if (this.selected === null && (this.page === 'thread' || this.page === 'contact')) {
      this.page = this.tab
    }

    // Whatever's on screen in a conversation has been read.
    if (this.selected !== null && this.page === 'thread') this.messenger.markRead(this.selected)

    this.device.render()
    this.form.render()

    const full = this.page === 'onboarding'
    const split = !this.compact && !full

    this._stage.style = { flex: 1, display: split ? 'none' : 'flex' }
    this._panes.style = { flex: 1, flexDirection: 'row', display: split ? 'flex' : 'none' }

    const screens = this._screens()
    for (const screen of screens) detach(screen.root)
    detach(this._tabbar)
    detach(this._hint)
    this._log.show(this.page === 'log')

    if (!split) {
      const screen = this._screenFor(this.page)
      this._stage.appendChild(screen.root)
      screen.render()
      if (TABS.includes(this.page)) {
        this._renderTabbar()
        this._stage.appendChild(this._tabbar)
      }
      return
    }

    // Side by side: the tab's list, the open screen, and the contact.
    const list = this._screenFor(this.tab)
    this._left.appendChild(list.root)
    list.render()
    this._renderTabbar()
    this._left.appendChild(this._tabbar)

    const detail = TABS.includes(this.page) ? null : this._screenFor(this.page)
    if (detail !== null) {
      this._center.appendChild(detail.root)
      detail.render()
    } else {
      this._center.appendChild(this._hint)
    }

    const side = this.wide && this.page === 'thread' && this.selected !== null
    this._right.style = { width: 320, display: side ? 'flex' : 'none' }
    if (side) {
      this._right.appendChild(this._side.root)
      this._side.render()
    }
  }

  _screens(): { root: any; render(): void }[] {
    return [
      this._chats,
      this._thread,
      this._contact,
      this._side,
      this._people,
      this._radio,
      this._setup,
      this._log,
      this._onboarding
    ]
  }

  _screenFor(page: Page): { root: any; render(): void } {
    const screens: Record<Page, { root: any; render(): void }> = {
      onboarding: this._onboarding,
      chats: this._chats,
      contacts: this._people,
      radio: this._radio,
      thread: this._thread,
      contact: this._contact,
      setup: this._setup,
      log: this._log
    }
    return screens[page]
  }

  // chats · contacts · radio, the current one lit, with unread on chats.
  _renderTabbar(): void {
    clear(this._tabbar)
    this._tabbar.style = { flexDirection: 'row', height: 56 }
    const unread = this.messenger.contacts.all().reduce((n, c) => n + this.messenger.unread(c), 0)

    for (const tab of TABS) {
      const on = this.tab === tab && (TABS.includes(this.page) || !this.compact)
      const name = tab === 'chats' && unread > 0 ? 'chats · ' + unread : tab
      this._tabbar.appendChild(
        press(
          view({ flex: 1, cursor: 'pointer' }, [
            view({ height: 2, backgroundColor: on ? colors.accent : colors.line }),
            view({ flex: 1, alignItems: 'center', justifyContent: 'center' }, [
              text(name, {
                color: on ? colors.accent : colors.muted,
                fontSize: 12,
                fontWeight: on ? 'bold' : 'normal'
              })
            ])
          ]),
          () => this.open(tab)
        )
      )
    }
  }
}
