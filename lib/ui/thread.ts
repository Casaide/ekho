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
  clear,
  rule,
  ago,
  clock,
  dayLabel,
  dayIndex,
  bytes
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

  constructor(ui: Ui) {
    this.ui = ui

    this._back = link('‹', () => this.ui.back(), { fontSize: 22, color: colors.text })
    this._title = text('', { color: colors.text, fontSize: 15, fontWeight: 'bold' }, 1)
    this._sub = text('', { color: colors.muted, fontSize: 11 }, 1)
    this._list = scroll({ padding: 16, gap: 14 })
    this._route = text('', { color: colors.muted, fontSize: 11 })
    this._count = text('', { color: colors.muted, fontSize: 11 })

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
    this._list.contentOffset = { y: Number.MAX_SAFE_INTEGER }

    this._renderRoute(contact)
    this._renderCount()
  }

  _message(contact: Contact, msg: Message): any {
    const mine = msg.state !== 'received'
    const failed = msg.state === 'failed'
    const pathColor = msg.via === 'irc' ? colors.irc : colors.lora

    const head = [
      text(clock(msg.time), { color: colors.muted, fontSize: 11 }),
      text(mine ? 'you' : (msg.from ?? displayName(contact)), {
        color: mine ? colors.accent : colors.text,
        fontSize: 11,
        fontWeight: 'bold'
      }),
      text('[' + this._path(msg) + ']', { color: pathColor, fontSize: 11 })
    ]
    if (mine) {
      head.push(
        text(failed ? 'failed · ' + (REASONS[msg.reason ?? ''] ?? msg.reason) : msg.state, {
          color: failed ? colors.failed : msg.state === 'delivered' ? colors.accent : colors.muted,
          fontSize: 11
        })
      )
    }

    const children = [
      view({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, head),
      view({ flexDirection: 'row', gap: 10 }, [
        view({
          width: 2,
          backgroundColor: failed ? colors.failed : mine ? colors.accent : colors.edge
        }),
        text(msg.text, { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 })
      ])
    ]

    if (mine && msg.via === 'irc' && msg.state === 'sent') {
      children.push(text('// no delivery receipt over irc', { color: colors.muted, fontSize: 11 }))
    }

    if (msg.state === 'received') {
      children.push(
        view({ flexDirection: 'row', gap: 8, paddingLeft: 12 }, [
          button('♥', () => this.ui.messenger.react(msg, '♥'), chip(colors.muted)),
          button('+1', () => this.ui.messenger.react(msg, '👍'), chip(colors.muted))
        ])
      )
    }

    if (failed) {
      const actions = [
        button('retry on lora', () => this.ui.messenger.retry(msg), chip(colors.text))
      ]
      if (contact.nicks.length > 0) {
        actions.push(
          button('send via irc', () => this.ui.messenger.sendViaIrc(msg), chip(colors.irc))
        )
      }
      children.push(view({ flexDirection: 'row', gap: 8, paddingLeft: 12 }, actions))
    }

    return view({ gap: 6 }, children)
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

  // Room left: LoRa packets and motaba's bridge both have a byte limit, and
  // over IRC our node tag takes some of it.
  _limit(): number {
    const contact = this.ui.selected
    if (contact === null) return LIMIT.lora
    if (this._via(contact) === 'lora') return LIMIT.lora
    const node = this.ui.messenger.node
    return LIMIT.irc - (node ? bytes(' [' + node + ']') : 0)
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
