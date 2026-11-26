import native from 'bare-native'
import b4a from 'b4a'
import theme from '../theme.ts'
import type Link from '../link.ts'

const { View, Text, TextInput, ScrollView, ActivityIndicator } = native
export const { colors, font } = theme

// The small set of pieces every screen is built from, in the mockups' style:
// dark, monospace, boxes with one-point borders.

export function view(style: object, children: any[] = []): any {
  const v = new View()
  v.style = style
  for (const child of children) v.appendChild(child)
  return v
}

export function text(value: string, style: object, lines = 0): any {
  const t = new Text(value)
  t.style = { fontFamily: font, ...style }
  if (lines) t.numberOfLines = lines
  return t
}

export function input(placeholder: string, opts: { secureTextEntry?: boolean } = {}): any {
  const i = new TextInput(opts)
  i.placeholder = placeholder
  i.autoCapitalize = 'none'
  i.autoCorrect = false
  i.style = field()
  return i
}

// A text field's look; `box` is the same for a view holding text.
export function field(): object {
  return { fontFamily: font, fontSize: 13, color: colors.text, ...box() }
}

export function box(): object {
  return {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.edge,
    borderRadius: 6,
    padding: 10
  }
}

export function scroll(contentStyle: object, style: object = { flex: 1 }): any {
  const s = new ScrollView()
  s.style = style
  s.contentStyle = contentStyle
  return s
}

export function chip(color: string): { color: string } & object {
  return {
    color,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: color,
    borderRadius: 4
  }
}

export function chipBox(color: string): object {
  const { color: _, ...box } = chip(color)
  return box
}

export function primary(): { color: string } & object {
  return {
    ...chip(colors.ground),
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    fontWeight: 'bold'
  }
}

// A label in a box that acts on a tap or click. Pointer events arrive on
// views, so the text sits inside one.
export function button(
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

// Plain text that acts on a tap, for links in running text: ‹, info, edit.
export function link(label: string, onpress: () => void, style: object = {}): any {
  return press(
    view({ cursor: 'pointer', paddingVertical: 4 }, [
      text(label, { color: colors.muted, fontSize: 13, ...style })
    ]),
    onpress
  )
}

// How far a finger may drift and still tap; how far right a swipe must go,
// mostly sideways, to go back.
const SLOP = 12
const SWIPE = 70

// What a swipe right does: set by the app shell, which knows where back is.
let swipeBack: () => void = () => {}

export function setSwipeBack(fn: () => void): void {
  swipeBack = fn
}

// Acts on a tap or click, and dims while pressed so the touch shows. A finger
// that moves isn't a tap (it was scrolling), and a swipe right goes back.
//
// The action runs after the event, not during it: it often rebuilds the
// screen, and destroying the view being touched while it handles the touch
// can crash the app.
export function press(node: any, onpress: () => void): any {
  const dim = (opacity: number) => (node.style = { ...node.style, opacity })
  gesture(node, {
    down: () => dim(0.5),
    cancel: () => dim(1),
    tap: () => {
      dim(1)
      setTimeout(onpress, 0)
    }
  })
  return node
}

// Swipe right to go back, on a view that is otherwise inert: the empty space
// of a screen.
export function swipeable(node: any): any {
  gesture(node, {})
  return node
}

function gesture(
  node: any,
  on: { down?: () => void; cancel?: () => void; tap?: () => void }
): void {
  let start: { x: number; y: number } | null = null
  let moved = false

  node.on('pointerdown', (e: { x: number; y: number }) => {
    start = { x: e.x, y: e.y }
    moved = false
    on.down?.()
  })
  node.on('pointermove', (e: { x: number; y: number }) => {
    if (start === null) return
    if (Math.abs(e.x - start.x) > SLOP || Math.abs(e.y - start.y) > SLOP) {
      if (!moved) on.cancel?.()
      moved = true
    }
  })
  node.on('pointercancel', () => {
    start = null
    on.cancel?.()
  })
  node.on('pointerup', (e: { x: number; y: number }) => {
    if (start === null) return
    const dx = e.x - start.x
    const dy = e.y - start.y
    start = null
    if (dx > SWIPE && Math.abs(dy) < dx / 2) {
      on.cancel?.()
      setTimeout(swipeBack, 0)
      return
    }
    if (!moved) on.tap?.()
  })
}

// Destroying a child removes it from its parent, so walk a copy.
export function clear(node: any): void {
  for (const child of [...node.children]) child.destroy()
}

// Take a node out of wherever it is, to place it again.
export function detach(node: any): void {
  if (node.parent !== null) node.parent.removeChild(node)
}

// A one-point line between sections.
export function rule(color = colors.line): any {
  return view({ height: 1, backgroundColor: color })
}

// `~/chats`: a path-like heading, the prefix muted.
export function heading(prefix: string, name: string): any {
  return view({ flexDirection: 'row', alignItems: 'baseline' }, [
    text(prefix, { color: colors.muted, fontSize: 18, fontWeight: 'bold' }),
    text(name, { color: colors.text, fontSize: 18, fontWeight: 'bold' })
  ])
}

// `// section`: a muted comment line above a group.
export function label(value: string): any {
  return text('// ' + value, { color: colors.muted, fontSize: 11 })
}

// A square with initials, or `#` for a channel.
export function avatar(name: string, size = 38): any {
  return view(
    {
      width: size,
      height: size,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.edge,
      backgroundColor: colors.panel,
      alignItems: 'center',
      justifyContent: 'center'
    },
    [
      text(initials(name), {
        color: colors.text,
        fontSize: size > 40 ? 16 : 12,
        fontWeight: 'bold'
      })
    ]
  )
}

export function initials(name: string): string {
  if (name.startsWith('#')) return '#'
  const words = name.split(/[\s._-]+/).filter(Boolean)
  const first = words[0] ?? name
  const letters = words.length > 1 ? first[0] + words[1][0] : first.slice(0, 2)
  return letters.toUpperCase()
}

// A dot that glows in the accent when on.
export function dot(on: boolean, color = colors.accent): any {
  return view({
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: on ? color : colors.edge
  })
}

export function spinner(): any {
  const wheel = new ActivityIndicator()
  wheel.style = { color: colors.accent, display: 'none' }
  return wheel
}

// A link's state on a line: a spinner while it works, amber while waiting to
// retry, red when it needs the user.
export function status(label: any, wheel: any, link: Link, value: string): void {
  const busy = link.state === 'connecting'
  wheel.animating = busy
  wheel.style = { color: colors.accent, display: busy ? 'flex' : 'none' }
  label.text = value
  label.style = {
    color:
      link.state === 'failed'
        ? colors.failed
        : link.state === 'waiting'
          ? colors.irc
          : colors.muted,
    fontFamily: font,
    fontSize: 12,
    flex: 1
  }
}

// The ekho mark, a node and its echo: a dot and three widening bars.
export function mark(): any {
  const bar = (height: number, opacity: number) =>
    view({ width: 3, height, borderRadius: 2, backgroundColor: colors.accent, opacity })
  return view({ flexDirection: 'row', alignItems: 'center', gap: 3 }, [
    view({ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent }),
    bar(9, 1),
    bar(14, 0.6),
    bar(19, 0.3)
  ])
}

export function ago(ms: number): string {
  if (ms === Infinity) return 'not heard'
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return Math.round(ms / 60_000) + 'm ago'
  if (ms < 86_400_000) return Math.round(ms / 3_600_000) + 'h ago'
  return Math.round(ms / 86_400_000) + 'd ago'
}

export function clock(ms: number): string {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// A message time in a list: the clock today, `yday`, or the date.
export function when(ms: number, now: number): string {
  const days = dayIndex(now) - dayIndex(ms)
  if (days === 0) return clock(ms)
  if (days === 1) return 'yday'
  const d = new Date(ms)
  return d.getDate() + '/' + (d.getMonth() + 1)
}

// `── today ──` and friends, between days in a thread.
export function dayLabel(ms: number, now: number): string {
  const days = dayIndex(now) - dayIndex(ms)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return new Date(ms).toDateString().toLowerCase()
}

export function dayIndex(ms: number): number {
  const d = new Date(ms)
  return Math.floor((ms - d.getTimezoneOffset() * 60_000) / 86_400_000)
}

export function bytes(value: string): number {
  return b4a.byteLength(value)
}
