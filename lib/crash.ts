import native from 'bare-native'
import theme from './theme.ts'

const { Window, ScrollView, Text } = native
const { colors, font } = theme

// Shows an error that would otherwise close the app, so it can be read on the
// device and sent as a screenshot. Kept to plain text and the fewest styles,
// since the UI itself may be what failed.
export default function showCrash(err: unknown): InstanceType<typeof Window> {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error(message)

  const body = new Text('ekho stopped with an error\n\n' + message)
  body.style = { color: colors.failed, fontFamily: font, fontSize: 12 }

  const scroll = new ScrollView()
  scroll.style = { flex: 1, backgroundColor: colors.ground }
  scroll.contentStyle = {
    paddingTop: 'env(safe-area-inset-top)',
    paddingHorizontal: 16,
    paddingBottom: 16
  }
  scroll.content.appendChild(body)

  const window = new Window(800, 600)
  window.content(scroll)
  window.show()
  return window
}
