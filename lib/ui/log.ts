import native from 'bare-native'
import type Ui from './index.ts'
import { line } from '../log.ts'
import type { Entry } from '../log.ts'
import { colors, view, text, scroll, button, chip, link, clear, rule } from './kit.ts'

const { Clipboard } = native

// Everything the app reported, oldest first, to read or copy and share.
export default class LogScreen {
  ui: Ui
  root: any

  _list: any
  _shown: boolean

  constructor(ui: Ui) {
    this.ui = ui
    this._shown = false
    this._list = scroll({ padding: 14, gap: 6 })

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
          link('‹', () => this.ui.back(), { fontSize: 22, color: colors.text }),
          text('~/log', { color: colors.text, fontSize: 15, fontWeight: 'bold', flex: 1 }),
          button('copy', () => this.copy(), chip(colors.accent))
        ]
      ),
      text('// info, warnings and errors · copy to share', {
        color: colors.muted,
        fontSize: 11,
        paddingHorizontal: 14,
        paddingBottom: 8
      }),
      rule(),
      this._list
    ])

    this.ui.log.on('entry', (entry: Entry) => {
      if (this._shown) this._list.content.appendChild(entryLine(entry))
    })
  }

  // Nothing to redraw: entries are added as they arrive.
  render(): void {}

  // Filled once when opened, then appended to as entries arrive.
  show(shown: boolean): void {
    if (shown === this._shown) return
    this._shown = shown
    clear(this._list.content)
    if (!shown) return
    for (const entry of this.ui.log.entries) this._list.content.appendChild(entryLine(entry))
    this._list.contentOffset = { y: Number.MAX_SAFE_INTEGER }
  }

  copy(): void {
    Clipboard.setString(this.ui.log.toString())
    this.ui.log.info('log copied to the clipboard')
  }
}

function entryLine(entry: Entry): any {
  const color =
    entry.level === 'error' ? colors.failed : entry.level === 'warn' ? colors.irc : colors.soft
  return text(line(entry), { color, fontSize: 11 })
}
