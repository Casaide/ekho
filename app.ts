import native from 'bare-native'
import tls from 'bare-tls'
import os from 'bare-os'
import path from 'bare-path'
import Messenger from './lib/messenger.ts'
import Irc from './lib/irc.ts'
import Store from './lib/store.ts'
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

// Where state is kept: the app's private storage on Android, ~/.ekho elsewhere.
const DATA =
  Bare.platform === 'android'
    ? '/data/data/casa.cassidy.ekho/files'
    : path.join(os.homedir(), '.ekho')

const store = new Store(path.join(DATA, 'state.json'))

let saved: any = null
try {
  saved = store.load()
} catch (err) {
  // A damaged file shouldn't stop the app; start fresh and say so.
  console.error('state:', (err as Error).message)
}

const settings = { nick: '', password: '', ...saved?.irc }
const messenger = new Messenger({ ircChannel: IRC_CHANNEL, state: saved?.messenger ?? null })

// Save a second after the last change, not on every message.
let timer: ReturnType<typeof setTimeout> | null = null
function save() {
  if (timer !== null) return
  timer = setTimeout(() => {
    timer = null
    try {
      store.save({ messenger, irc: settings })
    } catch (err) {
      console.error('save:', (err as Error).message)
    }
  }, 1000)
}

messenger.on('message', save)
messenger.on('update', save)
messenger.on('contacts', save)

function connectIrc(register: boolean) {
  const socket = tls.connect({ host: IRC_HOST, port: IRC_PORT })
  const irc = new Irc(socket, {
    nick: settings.nick,
    password: settings.password,
    channels: [IRC_CHANNEL]
  })

  irc.on('error', (err: Error) => console.error('irc:', err.message))
  irc.on('notice', (n: { from: string; text: string }) => console.log(n.from + ':', n.text))
  if (register) irc.once('ready', () => irc.register())

  messenger.setIrc(irc)
  irc.connect()
}

const ui = new Ui(
  messenger,
  {
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
      settings.nick = nick
      settings.password = password
      save()
      connectIrc(register)
    }
  },
  { nick: settings.nick, password: settings.password }
)

const window = new Window(1100, 720)

window.content(ui.root)
window.show()

ui.setCompact(window.size.width < COMPACT)
window.on('resize', () => ui.setCompact(window.size.width < COMPACT))

// Log back in to IRC with the saved nick.
if (settings.nick) connectIrc(false)
