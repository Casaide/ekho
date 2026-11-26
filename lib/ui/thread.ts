import native from 'bare-native'
import type Ui from './index.ts'
import type { Contact, Message } from '../types.ts'
import { displayName } from '../contacts.ts'
import { parts, links, host, media, lines } from '../links.ts'
import type { Media } from '../links.ts'
import { mentions } from '../mentions.ts'
import type { Mention } from '../mentions.ts'
import {
  colors,
  view,
  text,
  input,
  scroll,
  button,
  chip,
  primary,
  link,
  press,
  font,
  clear,
  detach,
  label,
  rule,
  ago,
  clock,
  dayLabel,
  dayIndex,
  bytes,
  back
} from './kit.ts'

// The most a LoRa text can hold (bare-meshtastic's MAX_PAYLOAD is 233 bytes),
// with room to spare, and what motaba passes on to the mesh from IRC.
const LIMIT = { lora: 200, irc: 150 }

// Failure reasons, in words.
const REASONS: Record<string, string> = {
  MAX_RETRANSMIT: 'no ack after 3 tries',
  NO_RESPONSE: 'no response',
  TIMEOUT: 'timed out',
  RADIO_OFFLINE: 'radio not connected',
  NO_NODE: 'their node is unknown to the radio',
  IRC_OFFLINE: 'irc not connected',
  NO_NICK: 'no irc nick for them',
  NO_RADIO_CHANNEL: 'not a channel on the radio',
  INTERRUPTED: 'interrupted'
}

const { Clipboard, TextFragment, Image, WebView } = native

// The reactions offered first; any other can be typed.
const EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '✅', '👎', '📡']

// What a state means, for the details of a message.
function meaning(msg: Message): string {
  if (msg.state === 'received') return 'received over ' + msg.via
  if (msg.state === 'delivered') return 'their radio confirmed it arrived'
  if (msg.state === 'relayed') return 'another radio repeated it onto the mesh'
  if (msg.state === 'sending') {
    return msg.address?.startsWith('channel')
      ? 'waiting to hear another radio repeat it'
      : 'waiting for their radio to confirm'
  }
  if (msg.state === 'failed') return 'not delivered: ' + (REASONS[msg.reason ?? ''] ?? msg.reason)
  if (msg.via === 'irc') {
    return 'the server took it; irc has no delivery receipts, so this is as far as ekho can see'
  }
  return 'sent on the channel'
}

// A conversation, log style: one line per message with time, who, the path
// it took and its state, then the text. The composer shows the route the
// next message will take, and how much room is left.
export default class Thread {
  ui: Ui
  root: any

  _back: any
  _title: any
  _sub: any
  _list: any
  _route: any
  _input: any
  _count: any
  // The box around the message input, lit while typing, and how many
  // characters fit on one of its lines.
  _box: any
  _perLine: number
  // The list's width, to break links to fit it.
  _width: number
  _detail: any
  _open: Message | null
  // The message being answered, and the line saying so above the box.
  _replyTo: Message | null
  _replying: any
  // What the list shows, to rebuild it only when that changes.
  _shown: string
  // The conversation and its length when last scrolled to the end, and until
  // when a scroll to the end is still settling.
  _end: string
  _settling: number
  // Kept at the end while the reader is there: through late layout, an
  // app opening on the conversation, previews and translations coming in.
  // Lost when they scroll up, back when they scroll down to it.
  _stick: boolean
  _contentHeight: number
  _viewHeight: number
  // Until when scroll events are ours, from placing it, not the reader's.
  _quiet: number
  _timers: ReturnType<typeof setTimeout>[]
  _emoji: any
  // Sounds and videos playing, by link, in this conversation: kept across
  // redraws so a message arriving doesn't stop one.
  _playing: Map<string, any>
  _playingIn: string | null
  // Messages shown as written though translated, by id.
  _original: Set<number>
  // Sending what's typed in Bulgarian: the switch, the translation shown
  // above the box, the send button, and the wait before translating.
  _inBulgarian: boolean
  _toBg: any
  _preview: any
  _sendBox: any
  _sendLabel: any
  _typing: ReturnType<typeof setTimeout> | null

  constructor(ui: Ui) {
    this.ui = ui

    this._back = back(() => this.ui.back())
    this._title = text('', { color: colors.text, fontSize: 15, fontWeight: 'bold' }, 1)
    this._sub = text('', { color: colors.muted, fontSize: 11 }, 1)
    this._list = scroll({ padding: 16, gap: 14 })
    this._width = 390
    this._list.on('layout', (frame: { width: number; height: number }) => {
      this._viewHeight = frame.height
      if (this._stick) this._toBottom()
      if (Math.abs(frame.width - this._width) < 1) return
      this._width = frame.width
      this._shown = ''
      this.ui.schedule()
    })
    this._route = text('', { color: colors.muted, fontSize: 11 })
    this._count = text('', { color: colors.muted, fontSize: 11 })
    // A message's details, when one is tapped.
    this._detail = view({ display: 'none' })
    this._open = null
    this._replyTo = null
    this._replying = view({ display: 'none' })
    this._shown = ''
    this._end = ''
    this._settling = 0
    this._stick = true
    this._contentHeight = 0
    this._viewHeight = 0
    this._quiet = 0
    this._list.content.on('layout', (frame: { height: number }) => {
      this._contentHeight = frame.height
      if (this._stick) this._toBottom()
    })
    this._list.on('scroll', (offset: { y: number }) => {
      if (Date.now() < this._quiet) return
      this._stick = offset.y >= this._contentHeight - this._viewHeight - 40
    })
    this._timers = []
    this._playing = new Map()
    this._playingIn = null
    this._original = new Set()
    this._inBulgarian = false
    this._toBg = view({})
    this._preview = text('', { color: colors.text, fontSize: 13, display: 'none' })
    this._sendLabel = text('➤', { color: colors.ground, fontSize: 16, fontWeight: 'bold' })
    this._sendBox = view({}, [this._sendLabel])
    this._typing = null
    // Lives across redraws, so a message arriving doesn't wipe what's typed.
    this._emoji = input('or type any emoji')
    this._emoji.returnKeyType = 'send'
    this._emoji.on('submit', () => {
      const emoji = this._emoji.value.trim()
      const msg = this._open
      if (emoji === '' || msg === null) return
      this._act(() => this.ui.messenger.react(msg, emoji))
    })

    // On a phone the box grows as the message does, up to a few lines; on a
    // desktop it's one line, Return sending.
    const phone = Bare.platform === 'android' || Bare.platform === 'ios'
    this._input = input('message', { multiline: phone })
    // A message, unlike a nick or a code: the keyboard's suggestions and
    // capitals help.
    this._input.autoCorrect = true
    this._input.autoCapitalize = 'sentences'
    this._input.returnKeyType = 'send'
    // The box is lit instead, all of it, not just the text inside.
    this._input.focusRing = false
    this._perLine = 0
    this._input.on('submit', () => this._send())
    this._input.on('change', (value: string) => {
      // A message is one line: Return sends, on a phone too.
      if (value.includes('\n')) {
        this._input.value = value.replace(/\n/g, ' ')
        return this._send()
      }
      this._renderCount()
      this._grow()
      this._translateSoon()
    })
    this._input.on('layout', (frame: { width: number }) => {
      const perLine = Math.max(1, Math.floor((frame.width - 2 * INPUT_PAD) / (INPUT_SIZE * 0.6)))
      if (perLine === this._perLine) return
      this._perLine = perLine
      this._grow()
    })
    this._box = view(
      {
        flex: 1,
        flexDirection: 'row',
        // The prompt stays on the first line as the box grows.
        alignItems: 'flex-start',
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 8,
        backgroundColor: colors.panel,
        paddingLeft: 12
      },
      [
        text('>', {
          color: colors.accent,
          fontSize: INPUT_SIZE,
          lineHeight: INPUT_LINE,
          paddingTop: INPUT_PAD
        }),
        this._input
      ]
    )
    const lit = (on: boolean) =>
      (this._box.style = { ...this._box.style, borderColor: on ? colors.accent : colors.line })
    this._input.on('focus', () => lit(true))
    this._input.on('blur', () => lit(false))
    this._grow()

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
          view({ flex: 1, gap: 2 }, [this._title, this._sub]),
          button('info', () => this.ui.toggleInfo(), chip(colors.text))
        ]
      ),
      rule(),
      this._list,
      this._detail,
      rule(),
      view({ paddingHorizontal: 14, paddingTop: 8, gap: 6 }, [
        view({ flexDirection: 'row', alignItems: 'center', gap: 6 }, [
          this._route,
          view({ flex: 1 }),
          this._toBg,
          this._count
        ]),
        this._replying,
        this._preview,
        view(
          {
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            paddingBottom: 14
          },
          [
            // A tap anywhere on the box, the `>` too, is a tap on the input.
            press(this._box, () => this._input.focus()),
            press(this._sendBox, () => this._send())
          ]
        )
      ])
    ])
  }

  render(): void {
    const contact = this.ui.selected
    if (contact === null) return

    this._back.style = { ...this._back.style, display: this.ui.compact ? 'flex' : 'none' }
    this._title.text = displayName(contact)
    this._sub.text = this.ui.reachLine(contact)

    const thread = this.ui.messenger.thread(contact)
    const now = this.ui.messenger.now()
    // A reply belongs to its conversation.
    if (this._replyTo !== null && this._replyTo.contact !== contact.id) this._replyTo = null
    this._renderRoute(contact)
    this._renderReplying()
    this.renderCompose()
    this._renderDetail(contact)

    // Another conversation: what played in the last one stops.
    if (this._playingIn !== contact.id) {
      this._playing.clear()
      this._playingIn = contact.id
    }

    // Redraws come often (presence, status): the list is rebuilt only when
    // what it shows changed, and so it keeps its place otherwise.
    const shown = [
      contact.id,
      dayIndex(now),
      this._open?.id ?? '',
      ...thread.map((m) => m.id + m.state + (m.reason ?? ''))
    ].join('|')
    if (shown === this._shown) return
    this._shown = shown

    // Where the reader was, to stay there after the rebuild.
    const was = this._list.contentOffset.y
    clear(this._list.content)
    let day = -1
    let side: boolean | null = null
    for (const msg of thread) {
      if (dayIndex(msg.time) !== day) {
        day = dayIndex(msg.time)
        this._list.content.appendChild(
          text('── ' + dayLabel(msg.time, now) + ' ──', {
            color: colors.muted,
            fontSize: 11,
            textAlign: 'center'
          })
        )
      }
      // More room where it turns from theirs to ours, or back.
      const mine = msg.state !== 'received'
      if (side !== null && side !== mine) this._list.content.appendChild(view({ height: 10 }))
      side = mine
      this._list.content.appendChild(this._message(contact, msg))
    }
    // Room under the last message: scrolled to the end, Android stops at the
    // last child, leaving the content's bottom padding out of view.
    this._list.content.appendChild(view({ height: 20 }))
    // To the end on opening a conversation and when a message is added;
    // otherwise where the reader was. A rebuild while a scroll to the end is
    // still settling goes to the end too: restoring the offset it caught
    // halfway would scroll back up.
    const at = contact.id + ':' + thread.length
    if (at !== this._end || Date.now() < this._settling || this._stick) this.toEnd()
    else this._place(was)
    this._end = at
  }

  // To the latest message, as on opening, or when the keyboard opens and the
  // list shrinks: the offset stays put, which would leave older messages in
  // view.
  toEnd(): void {
    this._stick = true
    this._settling = Date.now() + 400
    this._place(Number.MAX_SAFE_INTEGER)
  }

  // To the end now, as the content is laid out.
  _toBottom(): void {
    this._quiet = Date.now() + 300
    this._list.contentOffset = { y: Number.MAX_SAFE_INTEGER }
  }

  // The offset is clamped to the content as last laid out, which may not
  // have the latest yet: placed again once the layout has caught up, and any
  // placing still pending is dropped.
  _place(y: number): void {
    for (const timer of this._timers) clearTimeout(timer)
    const place = () => {
      this._quiet = Date.now() + 300
      this._list.contentOffset = { y }
    }
    place()
    this._timers = [setTimeout(place, 50), setTimeout(place, 250)]
  }

  // Tap a message for its details; tap it again, or close, to hide them.
  _toggle(msg: Message): void {
    this._open = this._open !== null && this._open.id === msg.id ? null : msg
    this._emoji.value = ''
    this._renderDetail(this.ui.selected!)
  }

  _renderDetail(contact: Contact): void {
    detach(this._emoji)
    clear(this._detail)
    const msg = this._open
    // Gone from this thread (another conversation, or joined away).
    if (msg === null || !this.ui.messenger.thread(contact).some((m) => m.id === msg.id)) {
      this._open = null
      this._detail.style = { display: 'none' }
      return
    }

    const mine = msg.state !== 'received'
    const row = (name: string, value: string, color: string = colors.text) =>
      view({ flexDirection: 'row', gap: 10 }, [
        text(name, { color: colors.muted, fontSize: 12, width: 56 }),
        text(value, { color, fontSize: 12, flex: 1 })
      ])

    this._detail.style = {
      padding: 14,
      gap: 8,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.line
    }
    this._detail.appendChild(
      view({ flexDirection: 'row', alignItems: 'center' }, [
        view({ flex: 1 }, [label('message')]),
        link('close', () => this._toggle(msg))
      ])
    )
    const now = this.ui.messenger.now()
    this._detail.appendChild(row('when', dayLabel(msg.time, now) + ' ' + clock(msg.time)))
    this._detail.appendChild(row('from', mine ? 'you' : (msg.from ?? displayName(contact))))
    const english = mine ? null : (this.ui.translator?.translation(msg.text) ?? null)
    if (english !== null && english !== msg.text) {
      this._detail.appendChild(row('original', msg.text))
    }
    this._detail.appendChild(
      row(
        'path',
        this._path(msg) + (msg.address ? ' · ' + msg.address : ''),
        msg.via === 'irc' ? colors.irc : colors.lora
      )
    )
    this._detail.appendChild(
      row(
        'state',
        msg.state + ' · ' + meaning(msg),
        msg.state === 'failed' ? colors.failed : colors.text
      )
    )

    const actions = []
    // Retrying a node the radio doesn't know would only fail again.
    if (msg.state === 'failed' && msg.reason !== 'NO_NODE') {
      actions.push(
        button(
          'retry on lora',
          () => this._act(() => this.ui.messenger.retry(msg)),
          chip(colors.text)
        )
      )
    }
    if (msg.state === 'failed') {
      if (contact.nicks.length > 0) {
        actions.push(
          button(
            'send via irc',
            () => this._act(() => this.ui.messenger.sendViaIrc(msg)),
            chip(colors.irc)
          )
        )
      }
    }
    actions.push(button('↩️ reply', () => this._reply(msg), chip(colors.accent)))
    // Any message of theirs can be translated, or shown as written again:
    // people mix English and Bulgarian, in either alphabet.
    const translator = this.ui.translator
    if (!mine && translator !== null && translator.state === 'on') {
      const english = translator.translation(msg.text)
      if (english === null) {
        actions.push(
          button(
            'translate',
            () => this._act(() => translator.translate(msg.text)),
            chip(colors.text)
          )
        )
      } else if (english !== msg.text) {
        const original = this._original.has(msg.id)
        actions.push(
          button(
            original ? 'show english' : 'show original',
            () => {
              if (original) this._original.delete(msg.id)
              else this._original.add(msg.id)
              this._shown = ''
              this.render()
            },
            chip(colors.text)
          )
        )
      }
    }
    if (msg.state === 'received') {
      // Any emoji: the common ones a tap away, anything else typed. Sent as
      // a short text until bare-meshtastic carries Meshtastic's reactions.
      const picks = view({ flexDirection: 'row', flexWrap: 'wrap', gap: 6 })
      for (const emoji of EMOJI) {
        picks.appendChild(
          button(emoji, () => this._act(() => this.ui.messenger.react(msg, emoji)), {
            ...chip(colors.muted),
            fontSize: 16
          })
        )
      }
      this._detail.appendChild(label('react'))
      this._detail.appendChild(picks)
      this._detail.appendChild(this._emoji)
    }
    actions.push(
      button('copy', () => this._act(() => Clipboard.setString(msg.text)), chip(colors.muted))
    )
    this._detail.appendChild(view({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, actions))
  }

  // Do something with the open message, then put its details away.
  _act(fn: () => void): void {
    this._open = null
    fn()
    this.render()
  }

  _message(contact: Contact, msg: Message): any {
    const mine = msg.state !== 'received'
    const failed = msg.state === 'failed'
    const pathColor = msg.via === 'irc' ? colors.irc : colors.lora

    // Yours on the right, theirs on the left, as in other messengers; whose
    // it is shows by the side, so only theirs carry a name.
    const head = [text(clock(msg.time), { color: colors.muted, fontSize: 11 })]
    if (!mine) {
      const name = text(msg.from ?? displayName(contact), {
        color: colors.text,
        fontSize: 11,
        fontWeight: 'bold'
      })
      // In a channel, their name opens them: their conversation and info,
      // where two of them can be joined into one person.
      head.push(
        contact.channel ? press(view({ cursor: 'pointer' }, [name]), () => this._sender(msg)) : name
      )
    }
    head.push(text('[' + this._path(msg) + ']', { color: pathColor, fontSize: 11 }))
    if (mine) {
      head.push(
        text(failed ? 'failed · ' + (REASONS[msg.reason ?? ''] ?? msg.reason) : msg.state, {
          color: failed
            ? colors.failed
            : msg.state === 'delivered' || msg.state === 'relayed'
              ? colors.accent
              : colors.muted,
          fontSize: 11
        })
      )
    }

    const bar = view({
      width: 2,
      backgroundColor: failed ? colors.failed : mine ? colors.accent : colors.edge
    })
    // Theirs in Bulgarian shows in English once translated; the original is
    // in its details, on hold.
    const english = mine ? null : (this.ui.translator?.translation(msg.text) ?? null)
    const translated = english !== null && english !== msg.text && !this._original.has(msg.id)
    if (translated) head.push(text('translated', { color: colors.muted, fontSize: 11 }))
    const body = this._body(translated ? english : msg.text)
    // A message with a link is as wide as a message gets, rather than as
    // wide as its widest line: Android rounds a box fitted to a line down to
    // whole pixels, and the line then wraps once more than measured, drawing
    // past the box. Its link's lines (`lines`) leave a character spare.
    const linked = links(msg.text).length > 0
    if (linked) body.style = { ...body.style, flex: 1, textAlign: mine ? 'right' : 'left' }
    // Above the message, not in it, so a tap on the name doesn't also tap
    // the message.
    const top = view(
      {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 6,
        justifyContent: mine ? 'flex-end' : 'flex-start'
      },
      head
    )
    const children = [
      view(
        { flexDirection: 'row', gap: 10, justifyContent: mine ? 'flex-end' : 'flex-start' },
        mine ? [body, bar] : [bar, body]
      )
    ]

    // Only something that needs doing gets a line of its own.
    if (failed) {
      children.push(
        text(msg.reason === 'NO_NODE' ? 'tap to send via irc' : 'tap for retry or irc', {
          color: colors.failed,
          fontSize: 11,
          paddingHorizontal: 12,
          textAlign: mine ? 'right' : 'left'
        })
      )
    }

    const selected = this._open !== null && this._open.id === msg.id
    const bubble = press(
      view(
        {
          gap: 6,
          padding: 6,
          borderRadius: 6,
          backgroundColor: selected ? colors.panel : colors.ground,
          cursor: 'pointer'
        },
        children
      ),
      // A tap on a message with a link opens the link; the message's details
      // and actions are a hold away. A failed one still opens its choices.
      () => {
        const url = links(msg.text)[0]
        if (url !== undefined && !failed) this.ui.actions.openUrl(url)
        else this._toggle(msg)
      },
      () => this._hold(msg)
    )
    // Links open from their own cards, beside the message rather than in
    // it, so a tap on one doesn't also open the message's details.
    const width = linked ? { width: '85%' } : { maxWidth: '85%' }
    return view({ gap: 6, alignSelf: mine ? 'flex-end' : 'flex-start', ...width }, [
      top,
      bubble,
      ...links(msg.text)
        .slice(0, 2)
        .map((url) => this._link(url, mine))
    ])
  }

  // Who sent a channel message, as a contact, made one if need be: by nick
  // on IRC, by node on LoRa. Opened with its info.
  _sender(msg: Message): void {
    const { messenger } = this.ui
    const contact =
      msg.via === 'irc'
        ? (messenger.contacts.byNick(msg.from!) ?? messenger.addContact({ nicks: [msg.from!] }))
        : (messenger.contacts.byNode(msg.address!) ??
          messenger.addContact({ name: msg.from!, nodes: [msg.address!] }))
    this.ui.select(contact)
    if (this.ui.compact) return this.ui.open('contact')
    this.ui.info = true
    this.ui.render()
  }

  // A message's text, its links and mentions marked. A link goes on lines
  // of its own, broken by us to fit (see `lines`).
  _body(value: string): any {
    const style = { color: colors.text, fontSize: 14, lineHeight: 20, flexShrink: 1 }
    const split = parts(value)
    const named = split.flatMap((part) => (part.url === null ? mentions(part.text) : []))
    const plain = (m: Mention) => m.name === null && m.node === null
    if (split.every((part) => part.url === null) && named.every(plain)) return text(value, style)
    const body = text('', style)
    split.forEach((part, i) => {
      if (part.url !== null) {
        const fragment = new TextFragment(lines(part.text, this._linkWidth()).join('\n'))
        fragment.style = { color: colors.accent, textDecorationLine: 'underline' }
        body.appendChild(fragment)
        return
      }
      let around = part.text
      if (i > 0) around = '\n' + around.replace(/^ +/, '')
      if (i < split.length - 1) around = around.replace(/ +$/, '') + '\n'
      if (around.trim() === '') return
      for (const m of mentions(around)) body.appendChild(this._mention(m))
    })
    return body
  }

  // How many characters of a message's monospace text fit on a line, from
  // the list's width: the most a message takes (85%), less its padding, bar
  // and gap, with one to spare.
  _linkWidth(): number {
    const width = (this._width - 32) * 0.85 - 24
    return Math.max(12, Math.floor(width / (14 * 0.6)) - 1)
  }

  // `@Root 👾`, or a node's name for its ID; in another colour if it's us.
  _mention(m: Mention): any {
    if (m.name === null && m.node === null) return new TextFragment(m.text)
    const { presence } = this.ui
    const name = m.node === null ? m.name! : (presence.nodeName(m.node) ?? m.node)
    const ours = [presence.self.nick, this.ui.radioInfo.longName, this.ui.radioInfo.shortName]
    const us =
      (m.node !== null && m.node === presence.self.node) ||
      ours.some((n) => n !== null && n.toLowerCase() === name.toLowerCase())
    const fragment = new TextFragment('@' + name)
    fragment.style = { color: us ? colors.irc : colors.lora, fontWeight: 'bold' }
    return fragment
  }

  // A link to open: its preview once fetched, else just where it goes. A
  // sound or a video plays in place instead.
  // `mine`: on the right, under one of ours.
  _link(url: string, mine: boolean): any {
    const kind = media(url)
    if (kind !== null) return this._media(url, kind, mine)
    const preview = this.ui.previews?.get(url) ?? null
    const open = () => this.ui.actions.openUrl(url)
    if (preview === null) {
      return button('↗ ' + host(url), open, {
        ...chip(colors.accent),
        fontSize: 11,
        alignSelf: mine ? 'flex-end' : 'flex-start'
      })
    }
    const card = {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 6,
      backgroundColor: colors.panel,
      cursor: 'pointer'
    }

    // A link to a picture: the picture, whole, in a box of its own.
    if (preview.title === null) {
      return press(
        view({ ...card, padding: 4, alignSelf: mine ? 'flex-end' : 'flex-start' }, [
          picture(preview.image!, 232, 174, 'contain')
        ]),
        open
      )
    }

    // A page: a small square of its picture beside where it's from, its
    // title and the start of its description, the same size whatever the
    // page's picture is.
    const about = view({ flex: 1, gap: 3 }, [
      text(preview.site, { color: colors.muted, fontSize: 11 }, 1),
      text(preview.title, { color: colors.text, fontSize: 13, fontWeight: 'bold' }, 2)
    ])
    if (preview.description !== null) {
      about.appendChild(text(preview.description, { color: colors.soft, fontSize: 12 }, 2))
    }
    const row = view(
      {
        flexDirection: 'row',
        gap: 10,
        padding: 8,
        width: '100%',
        maxWidth: 300,
        alignSelf: mine ? 'flex-end' : 'flex-start',
        ...card
      },
      [about]
    )
    if (preview.image !== null) row.insertBefore(picture(preview.image, 56, 56, 'cover'), about)
    return press(row, open)
  }

  // A sound or a video: a card to tap, then the player in its place, in a
  // web view, as each platform plays any format its browser does.
  _media(url: string, kind: Media, mine: boolean): any {
    const name = decodeURIComponent(
      url
        .replace(/[?#].*$/, '')
        .split('/')
        .pop()!
    )
    const card = (children: any[]) =>
      view(
        {
          gap: 6,
          padding: 8,
          width: '100%',
          maxWidth: 300,
          alignSelf: mine ? 'flex-end' : 'flex-start',
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 6,
          backgroundColor: colors.panel
        },
        children
      )
    const about = text(
      (kind === 'audio' ? 'sound' : 'video') + ' · ' + host(url) + ' · ' + name,
      {
        color: colors.muted,
        fontSize: 11
      },
      1
    )

    const player = this._playing.get(url)
    if (player === undefined) {
      return press(
        card([
          text('▶ play ' + (kind === 'audio' ? 'sound' : 'video'), {
            color: colors.accent,
            fontSize: 13,
            fontWeight: 'bold'
          }),
          about
        ]),
        () => this._play(url, kind)
      )
    }
    detach(player)
    return card([
      player,
      view({ flexDirection: 'row', alignItems: 'center', gap: 8 }, [
        view({ flex: 1 }, [about]),
        button('■ stop', () => this._stop(url), { ...chip(colors.muted), fontSize: 11 }),
        button('↗', () => this.ui.actions.openUrl(url), { ...chip(colors.accent), fontSize: 11 })
      ])
    ])
  }

  _play(url: string, kind: Media): void {
    const player = new WebView()
    player.style = { width: '100%', height: kind === 'audio' ? 56 : 158, borderRadius: 4 }
    player.html = page(url, kind)
    this._playing.set(url, player)
    this._shown = ''
    this.ui.schedule()
  }

  _stop(url: string): void {
    this._playing.get(url).html = ''
    this._playing.delete(url)
    this._shown = ''
    this.ui.schedule()
  }

  // A preview came in: show it. Its card is taller than the link it
  // replaces, so if it's on one of the last messages, the list goes to the
  // end again rather than leaving the newest under the box.
  // Null: a translation came in, which changes no card.
  invalidate(url: string | null): void {
    this._shown = ''
    const contact = this.ui.selected
    if (contact === null || url === null) return
    const recent = this.ui.messenger.thread(contact).slice(-3)
    if (recent.some((m) => links(m.text).includes(url))) this._settling = Date.now() + 400
  }

  // Hold a message for what to do with it: reply, react, copy, retry.
  _hold(msg: Message): void {
    this._open = msg
    this._emoji.value = ''
    this._renderDetail(this.ui.selected!)
    this._shown = ''
    this.render()
  }

  // Answer a message: the box says which, and the reply quotes it.
  _reply(msg: Message | null): void {
    this._replyTo = msg
    this._open = null
    this._shown = ''
    this.render()
    if (msg !== null) this._input.focus()
  }

  _renderReplying(): void {
    clear(this._replying)
    const msg = this._replyTo
    if (msg === null) {
      this._replying.style = { display: 'none' }
      return
    }
    this._replying.style = { flexDirection: 'row', alignItems: 'center', gap: 8 }
    this._replying.appendChild(
      text(
        '↩️ replying to ' + this.ui.messenger.replyTo(msg).slice(3, -2),
        {
          color: colors.soft,
          fontSize: 12,
          flex: 1
        },
        1
      )
    )
    this._replying.appendChild(link('cancel', () => this._reply(null)))
  }

  // What's in the brackets: `lora · 2 hops`, `lora · direct`, `irc`.
  _path(msg: Message): string {
    if (msg.also !== undefined) return msg.via + ' + ' + msg.also
    if (msg.via === 'irc') return 'irc'
    if (msg.address !== null && msg.address.startsWith('channel')) return 'lora · channel'
    if (msg.hops) return 'lora · ' + msg.hops + (msg.hops === 1 ? ' hop' : ' hops')
    return 'lora · direct'
  }

  // `route: auto · lora (ivan heard 2m ago)`
  _renderRoute(contact: Contact): void {
    const via = this._via(contact)
    const { messenger } = this.ui
    let why: string
    if (contact.channel && messenger.radioChannel(contact) === null) {
      why = 'irc only'
    } else if (via === 'irc') {
      why = messenger.radio === null ? 'radio not connected' : 'no nodes heard'
    } else {
      const heard = contact.nodes.map((n) => messenger.heard.since(n)).sort((a, b) => a - b)[0]
      why =
        heard !== undefined && heard !== Infinity
          ? displayName(contact) + ' heard ' + ago(heard)
          : messenger.heard.count() + ' nodes heard'
    }
    this._route.text = 'route: auto · ' + via + ' (' + why + ')'
    this._route.style = { color: via === 'irc' ? colors.irc : colors.lora, fontSize: 11 }
  }

  _via(contact: Contact): 'lora' | 'irc' {
    const { messenger } = this.ui
    if (contact.channel && messenger.radioChannel(contact) === null) return 'irc'
    return messenger.route()
  }

  // Room left: LoRa packets and motaba's bridge both have a byte limit.
  _limit(): number {
    const contact = this.ui.selected
    if (contact === null || this._via(contact) === 'lora') return LIMIT.lora
    return LIMIT.irc
  }

  // The switch to send in Bulgarian, the Bulgarian above the box, and the
  // send button, which turns amber and says so.
  renderCompose(): void {
    // Emptied by sending, which says nothing: back to one line.
    this._grow()
    const tr = this.ui.toBulgarian
    clear(this._toBg)
    if (tr !== null) {
      this._toBg.appendChild(
        button('→ bg', () => this._switchBulgarian(), {
          ...chip(this._inBulgarian ? colors.irc : colors.muted),
          fontSize: 11,
          paddingVertical: 3,
          paddingHorizontal: 8
        })
      )
    }
    const on = tr !== null && this._inBulgarian
    const value = this._input.value.trim()
    let shown = ''
    if (on && tr.state === 'downloading') {
      shown = 'bg: getting the model, ' + Math.round(tr.progress * 100) + '%'
    } else if (on && tr.state === 'failed') shown = 'bg: failed: ' + tr.error
    else if (on && value !== '') shown = 'bg: ' + (tr.translation(value) ?? '…')
    else if (on) shown = 'bg: type in English, it goes out in Bulgarian'
    this._preview.text = shown
    this._preview.style = {
      color: shown.startsWith('bg: failed') ? colors.failed : colors.irc,
      fontSize: 13,
      display: on ? 'flex' : 'none'
    }
    const color = on ? colors.irc : colors.accent
    this._sendLabel.text = on ? 'bg ➤' : '➤'
    this._sendBox.style = {
      backgroundColor: color,
      borderColor: color,
      borderWidth: 1,
      alignSelf: 'flex-end',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: INPUT_LINE + 2 * INPUT_PAD + 2,
      minWidth: INPUT_LINE + 2 * INPUT_PAD + 2,
      paddingHorizontal: 10,
      borderRadius: 8,
      cursor: 'pointer'
    }
    this._renderCount()
  }

  _switchBulgarian(): void {
    const tr = this.ui.toBulgarian!
    this._inBulgarian = !this._inBulgarian
    if (this._inBulgarian && (tr.state === 'off' || tr.state === 'failed')) tr.start()
    this._translateSoon()
    this.renderCompose()
  }

  // Once typing pauses, what's typed is translated for the preview.
  _translateSoon(): void {
    if (!this._inBulgarian) return
    if (this._typing !== null) clearTimeout(this._typing)
    this._typing = setTimeout(() => {
      this._typing = null
      const value = this._input.value.trim()
      if (value !== '') this.ui.toBulgarian!.translate(value)
      this.renderCompose()
    }, 400)
  }

  // What goes out: what's typed, or its Bulgarian; null while that's on
  // its way.
  _outgoing(): string | null {
    const value = this._input.value.trim()
    if (!this._inBulgarian || this.ui.toBulgarian === null) return value
    return this.ui.toBulgarian.translation(value)
  }

  _renderCount(): void {
    const used = bytes(
      (this._replyTo === null ? '' : this.ui.messenger.replyTo(this._replyTo)) +
        (this._outgoing() ?? this._input.value)
    )
    const limit = this._limit()
    this._count.text = used + '/' + limit
    this._count.style = { color: used > limit ? colors.failed : colors.muted, fontSize: 11 }
  }

  // As tall as the message needs, from one line up to MAX_LINES, by how
  // many characters of the monospace font fit across.
  _grow(): void {
    const value = this._input.value
    const lines =
      this._perLine === 0 || !this._input.multiline
        ? 1
        : Math.min(MAX_LINES, Math.max(1, Math.ceil(value.length / this._perLine)))
    this._input.style = {
      fontFamily: font,
      color: colors.text,
      fontSize: INPUT_SIZE,
      flex: 1,
      paddingHorizontal: INPUT_PAD,
      paddingVertical: INPUT_PAD,
      height: lines * INPUT_LINE + 2 * INPUT_PAD
    }
  }

  _send(): void {
    const value = this._outgoing()
    const contact = this.ui.selected
    // In Bulgarian, nothing goes until its translation is shown.
    if (value === null || value === '' || contact === null) return
    const prefix = this._replyTo === null ? '' : this.ui.messenger.replyTo(this._replyTo)
    // Too long to go out in one piece: the counter is already red.
    if (bytes(prefix + value) > this._limit()) return

    const sent =
      this._replyTo === null
        ? this.ui.messenger.send(contact, value)
        : this.ui.messenger.reply(this._replyTo, value)
    this._input.value = ''
    this._reply(null)
    // Their node unknown to the radio: it fails at once, and its choices
    // (send via IRC) open, rather than waiting for a tap.
    if (sent.state === 'failed' && sent.reason === 'NO_NODE') this._open = sent
    this.renderCompose()
    this.render()
  }
}

// The message input: its font size, the height of one of its lines, its
// padding, and the most lines it grows to before scrolling.
const INPUT_SIZE = 14
const INPUT_LINE = 19
const INPUT_PAD = 7
const MAX_LINES = 3

// A picture in a box of a fixed size it never draws outside of. bare-native
// doesn't clip a view's contents (as on the web), and on Android a picture
// filling its box (cover) is drawn larger than the box, over everything
// around it; the box clips it.
function picture(file: string, width: number, height: number, fit: 'cover' | 'contain'): any {
  const image = new Image()
  image.style = { width, height, resizeMode: fit }
  image.source = file
  fitOnApple(image)
  // Undecodable: an empty box.
  image.on('error', () => {})
  return view({ width, height, borderRadius: 4, overflow: 'hidden' }, [image])
}

// bare-native 0.3.8's image view on macOS and iOS doesn't record its own
// size, so a picture filling it is drawn at no size, leaving a blank box.
// Recorded here until it's fixed upstream (lib/image/darwin.js, ios.js).
function fitOnApple(image: any): void {
  if (Bare.platform !== 'darwin' && Bare.platform !== 'ios') return
  const resized = image._resized
  image._resized = function (width: number, height: number) {
    resized.call(this, width, height)
    this._box = { width, height }
    this._fitted()
  }
}

// The page a sound or video plays in: the player filling it, on the card's
// colour. Android reads the page as a data URL, so it's escaped as one there.
function page(url: string, kind: Media): string {
  const src = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const html =
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{margin:0;height:100%;background:' +
    colors.panel +
    '}audio,video{display:block;width:100%;height:100%}</style>' +
    '<' +
    kind +
    ' controls autoplay playsinline src="' +
    src +
    '"></' +
    kind +
    '>'
  return Bare.platform === 'android' ? encodeURIComponent(html) : html
}
