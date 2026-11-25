import native from 'bare-native'
import tls from 'bare-tls'
import Messenger from './lib/messenger.ts'
import Irc from './lib/irc.ts'
import Ui from './lib/ui.ts'
import connectRadio from './lib/radio.ts'

const { Window } = native

// The community IRC server; it bridges IRC to the mesh both ways.
const IRC_HOST = 'irc.motaba.net'
const IRC_PORT = 6697
// The IRC channel motaba mirrors the mesh channel to. Not confirmed yet.
const IRC_CHANNEL = '#mesh'

// Below this width, show the chats or the conversation, one at a time.
const COMPACT = 700

const messenger = new Messenger({ ircChannel: IRC_CHANNEL })

const ui = new Ui(messenger, {
  connectRadio() {
    connectRadio().then(
      ({ client }) => {
        messenger.node = client.id
        messenger.setRadio(client)
      },
      (err: Error) => console.error('radio:', err.message)
    )
  },

  connectIrc({ nick, password, register }) {
    const socket = tls.connect({ host: IRC_HOST, port: IRC_PORT })
    const irc = new Irc(socket, { nick, password, channels: [IRC_CHANNEL] })

    irc.on('error', (err: Error) => console.error('irc:', err.message))
    irc.on('notice', (n: { from: string; text: string }) => console.log(n.from + ':', n.text))
    if (register) irc.once('ready', () => irc.register())

    messenger.setIrc(irc)
    irc.connect()
  }
})

const window = new Window(1100, 720)

window.content(ui.root)
window.show()

ui.setCompact(window.size.width < COMPACT)
window.on('resize', () => ui.setCompact(window.size.width < COMPACT))
