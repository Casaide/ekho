import native from 'bare-native'
import EventEmitter from 'bare-events'
import type Messenger from '../messenger.ts'
import type { Contact, Message } from '../types.ts'
import Log from '../log.ts'
import Link from '../link.ts'
import Presence from '../presence.ts'
import {
  colors,
  view,
  text,
  button,
  chip,
  press,
  swipeable,
  setSwipeBack,
  clear,
  detach,
  ago
} from './kit.ts'
import { DeviceCard, IrcForm } from './parts.ts'
import Chats from './chats.ts'
import Thread from './thread.ts'
import ContactScreen from './contact.ts'
import People from './people.ts'
import Channels from './channels.ts'
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

const PAGES = [
  'onboarding',
  'chats',
  'channels',
  'contacts',
  'radio',
  'thread',
  'contact',
  'setup',
  'log'
] as const

export type Page = (typeof PAGES)[number]

const TABS: Page[] = ['chats', 'channels', 'contacts', 'radio']

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

// Events: select (contact | null), when the open conversation changes.
//
// The whole app view, after the mockups. On a phone: one screen at a time,
// with chats, contacts and radio as tabs, and conversation, contact, IRC setup
// and the log on top of them. On a desktop: the tab's list on the left, the
// open screen in the middle, and the contact on the right when there's room.
export default class Ui extends EventEmitter {
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
  _tabs: { tab: Page; bar: any; label: any }[]
  _pending: ReturnType<typeof setTimeout> | null

  _chats: Chats
  _thread: Thread
  _contact: ContactScreen
  _side: ContactScreen
  _people: People
  _channels: Channels
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
    super()

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
    this._channels = new Channels(this)
    this._radio = new RadioScreen(this)
    this._setup = new Setup(this)
    this._log = new LogScreen(this)
    this._onboarding = new Onboarding(this)

    // Errors show here, above an app that keeps working.
    this._banner = view({ display: 'none' })
    // Built once, so a tab being touched is never replaced mid-tap; only its
    // colours and label change.
    this._tabbar = view({ flexDirection: 'row', height: 56 })
    this._tabs = []
    for (const tab of TABS) {
      const bar = view({ height: 2, backgroundColor: colors.line })
      const label = text(tab, { color: colors.muted, fontSize: 12 })
      this._tabbar.appendChild(
        press(
          view({ flex: 1, cursor: 'pointer' }, [
            bar,
            view({ flex: 1, alignItems: 'center', justifyContent: 'center' }, [label])
          ]),
          () => this.open(tab)
        )
      )
      this._tabs.push({ tab, bar, label })
    }
    this._pending = null
    // Swiping right on empty space goes back, as on any pressable thing.
    this._stage = swipeable(view({ flex: 1 }))
    setSwipeBack(() => this.swipeBack())
    this._left = view({ width: 320 })
    this._center = swipeable(view({ flex: 1 }))
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

    // Events come in bursts (a busy channel, people joining and leaving the
    // bridge): redraw once for each burst, not once for each event.
    messenger.on('contacts', () => this.schedule())
    messenger.on('message', (_msg: Message, contact: Contact) => {
      // A message arriving in the open conversation is read already.
      if (this.page === 'thread' && this.selected !== null && contact.id === this.selected.id) {
        this.messenger.markRead(contact)
      }
      this.schedule()
    })
    messenger.on('update', () => this.schedule())
    messenger.on('status', () => this.schedule())
    messenger.on('read', () => this.schedule())
    this.radio.on('change', () => this.schedule())
    this.irc.on('change', () => this.schedule())
    this.presence.on('change', () => this.schedule())
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

  // Back, from a swipe or Android's back gesture: from a screen on top to the
  // one below, or to chats from another tab. False when there's nowhere to
  // go back to (chats, onboarding), so Android can leave the app.
  goBack(): boolean {
    if (this.page === 'onboarding' || this.page === 'chats') return false
    if (TABS.includes(this.page)) this.open('chats')
    else this.back()
    return true
  }

  swipeBack(): void {
    this.goBack()
  }

  back(): void {
    this.page = this._history.pop() ?? this.tab
    this.render()
  }

  select(contact: Contact | null): void {
    this.selected = contact
    this.emit('select', contact)
    if (contact === null) {
      this.page = this.tab
      this._history = []
      return this.render()
    }
    if (this.page === 'contact') this.page = this._history.pop() ?? this.tab
    this.messenger.markRead(contact)
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
    this.schedule()
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

  // Channels to open: the server's list once logged in, busiest first, or
  // just the ones joined before that.
  channels(): { name: string; users: number; joined: boolean }[] {
    const joined = this.messenger.contacts.all().filter((c) => c.channel)
    const isJoined = (name: string) => joined.some((c) => c.id.toLowerCase() === name.toLowerCase())
    const list = this._setup.channels
    if (list === null) return joined.map((c) => ({ name: c.id, users: 0, joined: true }))
    return list.map((c) => ({ name: c.name, users: c.users, joined: isJoined(c.name) }))
  }

  // Open a channel's conversation, joining it first if need be.
  openChannel(name: string): void {
    if (this.messenger.contacts.get(name) === null) this.actions.toggleChannel(name)
    const contact = this.messenger.contacts.get(name)
    if (contact !== null) this.select(contact)
  }

  online(nick: string): boolean {
    return this.presence.people().some((p) => p.nicks.some((n) => n.nick === nick))
  }

  // Drawing.

  // Redraw soon, once, however many times this is called meanwhile.
  schedule(): void {
    if (this._pending !== null) return
    this._pending = setTimeout(() => {
      this._pending = null
      this.render()
    }, 100)
  }

  render(): void {
    if (this._pending !== null) clearTimeout(this._pending)
    this._pending = null

    // A contact joined into another no longer exists.
    if (this.selected !== null && this.messenger.contacts.get(this.selected.id) === null) {
      this.selected = null
      if (this.page === 'thread' || this.page === 'contact') this.page = this.tab
    }
    if (this.selected === null && (this.page === 'thread' || this.page === 'contact')) {
      this.page = this.tab
    }

    this.device.render()
    this.form.render()

    const full = this.page === 'onboarding'
    const split = !this.compact && !full

    this._stage.style = { flex: 1, display: split ? 'none' : 'flex' }
    this._panes.style = { flex: 1, flexDirection: 'row', display: split ? 'flex' : 'none' }

    this._log.show(this.page === 'log')

    // What goes where. Views move only when this changes: moving a view
    // cancels a touch on it.
    const side = split && this.wide && this.page === 'thread' && this.selected !== null
    const detail = TABS.includes(this.page) ? null : this._screenFor(this.page)
    const tabs = TABS.includes(this.page) || split
    const layout: [any, any[]][] = split
      ? [
          [this._left, [this._screenFor(this.tab).root, this._tabbar]],
          [this._center, [detail === null ? this._hint : detail.root]],
          [this._right, side ? [this._side.root] : []],
          [this._stage, []]
        ]
      : [
          [
            this._stage,
            tabs
              ? [this._screenFor(this.page).root, this._tabbar]
              : [this._screenFor(this.page).root]
          ],
          [this._left, []],
          [this._center, []],
          [this._right, []]
        ]
    this._place(layout)
    this._right.style = { width: 320, display: side ? 'flex' : 'none' }

    if (tabs) this._renderTabbar()
    if (split) this._screenFor(this.tab).render()
    if (detail !== null) detail.render()
    else if (!split) this._screenFor(this.page).render()
    if (side) this._side.render()
  }

  // Put each container's children in place, touching only those that differ.
  _place(layout: [any, any[]][]): void {
    const same = layout.every(
      ([container, children]) =>
        container.children.length === children.length &&
        children.every((child, i) => container.children[i] === child)
    )
    if (same) return
    for (const [container] of layout) {
      for (const child of [...container.children]) detach(child)
    }
    for (const [container, children] of layout) {
      for (const child of children) container.appendChild(child)
    }
  }

  _screens(): { root: any; render(): void }[] {
    return [
      this._chats,
      this._thread,
      this._contact,
      this._side,
      this._people,
      this._channels,
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
      channels: this._channels,
      contacts: this._people,
      radio: this._radio,
      thread: this._thread,
      contact: this._contact,
      setup: this._setup,
      log: this._log
    }
    return screens[page]
  }

  // chats · channels · contacts · radio, the current one lit, with unread on chats.
  _renderTabbar(): void {
    const unread = this.messenger.contacts.all().reduce((n, c) => n + this.messenger.unread(c), 0)

    for (const { tab, bar, label } of this._tabs) {
      const on = this.tab === tab && (TABS.includes(this.page) || !this.compact)
      bar.style = { height: 2, backgroundColor: on ? colors.accent : colors.line }
      label.text = tab === 'chats' && unread > 0 ? 'chats · ' + unread : tab
      label.style = {
        fontFamily: label.style.fontFamily,
        color: on ? colors.accent : colors.muted,
        fontSize: 12,
        fontWeight: on ? 'bold' : 'normal'
      }
    }
  }
}
