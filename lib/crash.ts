import native from 'bare-native'
import theme from './theme.ts'

const { Window, View, ScrollView, Text } = native
const { colors, font } = theme

// Shows an error that the app couldn't show itself, so it can be read on the
// device and sent as a screenshot. Kept to plain text and the fewest styles,
// since the UI may be what failed. On Android there is one window, so a window
// passed in has its content replaced; otherwise a new one opens.
export default function showCrash(
  message: string,
  window: InstanceType<typeof Window> | null = null
): InstanceType<typeof Window> {
  const body = new Text('ekho stopped with an error\n\n' + message)
  body.style = { color: colors.failed, fontFamily: font, fontSize: 12 }

  const scroll = new ScrollView()
  scroll.style = { flex: 1 }
  scroll.contentStyle = { padding: 16 }
  scroll.content.appendChild(body)

  // A plain view at the root fills the window; a scroll view alone may not.
  const root = new View()
  root.style = {
    flex: 1,
    backgroundColor: colors.ground,
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)'
  }
  root.appendChild(scroll)

  const target = window ?? new Window(800, 600)
  target.content(root)
  target.show()
  return target
}
