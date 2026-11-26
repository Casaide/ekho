import native from 'bare-native'
import type Ui from './index.ts'
import type { Contact, Message } from '../types.ts'
import { displayName } from '../contacts.ts'
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
  NO_NODE: 'no node known for them',
  IRC_OFFLINE: 'irc not connected',
  NO_NICK: 'no irc nick for them',
  NO_RADIO_CHANNEL: 'not a channel on the radio',
  INTERRUPTED: 'interrupted'
}

const { Clipboard } = native

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
  _detail: any
  _open: Message | null
  // The conversation and its length when last scrolled to the end.
  _end: string
  _emoji: any

  constructor(ui: Ui) {
    this.ui = ui

    this._back = back(() => this.ui.back())
    this._title = text('', { color: colors.text, fontSize: 15, fontWeight: 'bold' }, 1)
    this._sub = text('', { color: colors.muted, fontSize: 11 }, 1)
    this._list = scroll({ padding: 16, gap: 14 })
    this._route = text('', { color: colors.muted, fontSize: 11 })
    this._count = text('', { color: colors.muted, fontSize: 11 })
    // A message's details, when one is tapped.
    this._detail = view({ display: 'none' })
    this._open = null
    this._end = ''
    // Lives across redraws, so a message arriving doesn't wipe what's typed.
    this._emoji = input('or type any emoji')
    this._emoji.returnKeyType = 'send'
    this._emoji.on('submit', () => {
      const emoji = this._emoji.value.trim()
      const msg = this._open
      if (emoji === '' || msg === null) return
      this._act(() => this.ui.messenger.react(msg, emoji))
    })

    this._input = input('message')
    this._input.returnKeyType = 'send'
    this._input.style = { color: colors.text, fontSize: 13, flex: 1, padding: 8 }
    this._input.on('submit', () => this._send())
    this._input.on('change', () => this._renderCount())

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
          button('info', () => this.ui.open('contact'), chip(colors.text))
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
          this._count
        ]),
        view(
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingBottom: 10
          },
          [
            view(
              {
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 6,
                paddingLeft: 10
              },
              [text('>', { color: colors.accent, fontSize: 14 }), this._input]
            ),
            button('send', () => this._send(), primary())
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

    // Where the reader was, to stay there after the rebuild.
    const was = this._list.contentOffset.y
    clear(this._list.content)
    const now = this.ui.messenger.now()
    let day = -1
    for (const msg of this.ui.messenger.thread(contact)) {
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
      this._list.content.appendChild(this._message(contact, msg))
    }
    // Room under the last message: scrolled to the end, Android stops at the
    // last child, leaving the content's bottom padding out of view.
    this._list.content.appendChild(view({ height: 20 }))
    // To the end on opening a conversation and when a message is added, but
    // not on every redraw, so reading back up stays put. The offset is
    // clamped to the content as last laid out, which doesn't have the new
    // message yet: scroll again once the layout has caught up.
    const at = contact.id + ':' + this.ui.messenger.thread(contact).length
    const y = at === this._end ? was : Number.MAX_SAFE_INTEGER
    this._end = at
    const place = () => (this._list.contentOffset = { y })
    place()
    setTimeout(place, 50)
    setTimeout(place, 250)

    this._renderRoute(contact)
    this._renderCount()
    this._renderDetail(contact)
  }

  // To the latest message, as when the keyboard opens and the list shrinks:
  // the offset stays put, which would leave older messages in view.
  toEnd(): void {
    const end = () => (this._list.contentOffset = { y: Number.MAX_SAFE_INTEGER })
    end()
    setTimeout(end, 50)
    setTimeout(end, 250)
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
    if (msg.state === 'failed') {
      actions.push(
        button(
          'retry on lora',
          () => this._act(() => this.ui.messenger.retry(msg)),
          chip(colors.text)
        )
      )
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
      head.push(
        text(msg.from ?? displayName(contact), {
          color: colors.text,
          fontSize: 11,
          fontWeight: 'bold'
        })
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
    const body = text(msg.text, { color: colors.text, fontSize: 14, lineHeight: 20, flexShrink: 1 })
    const children = [
      view(
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          justifyContent: mine ? 'flex-end' : 'flex-start'
        },
        head
      ),
      view(
        { flexDirection: 'row', gap: 10, justifyContent: mine ? 'flex-end' : 'flex-start' },
        mine ? [body, bar] : [bar, body]
      )
    ]

    // Only something that needs doing gets a line of its own.
    if (failed) {
      children.push(
        text('tap for retry or irc', {
          color: colors.failed,
          fontSize: 11,
          paddingHorizontal: 12,
          textAlign: mine ? 'right' : 'left'
        })
      )
    }

    const selected = this._open !== null && this._open.id === msg.id
    return press(
      view(
        {
          gap: 6,
          padding: 6,
          borderRadius: 6,
          alignSelf: mine ? 'flex-end' : 'flex-start',
          maxWidth: '85%',
          backgroundColor: selected ? colors.panel : colors.ground,
          cursor: 'pointer'
        },
        children
      ),
      () => this._toggle(msg)
    )
  }

  // What's in the brackets: `lora · 2 hops`, `lora · direct`, `irc`.
  _path(msg: Message): string {
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

  _renderCount(): void {
    const used = bytes(this._input.value)
    const limit = this._limit()
    this._count.text = used + '/' + limit
    this._count.style = { color: used > limit ? colors.failed : colors.muted, fontSize: 11 }
  }

  _send(): void {
    const value = this._input.value.trim()
    const contact = this.ui.selected
    if (value === '' || contact === null) return
    // Too long to go out in one piece: the counter is already red.
    if (bytes(value) > this._limit()) return

    this.ui.messenger.send(contact, value)
    this._input.value = ''
    this._renderCount()
  }
}
