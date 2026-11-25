import native from 'bare-native'
import tls from 'bare-tls'
import os from 'bare-os'
import path from 'bare-path'
import Messenger from './lib/messenger.ts'
import Irc from './lib/irc.ts'
import Store from './lib/store.ts'
import Ui from './lib/ui.ts'
import connectRadio from './lib/radio.ts'
import showCrash from './lib/crash.ts'
import Log from './lib/log.ts'

const { Window } = native

// Everything printed goes into the log too, readable and copyable in the app.
const log = new Log()
log.capture()
log.info('ekho starting on ' + Bare.platform + '-' + Bare.arch)

// Show any error on screen rather than closing: as a banner over the working
// app when it's up, as a screen of its own when the app itself is what failed.
let shownUi: Ui | null = null
let shownWindow: InstanceType<typeof Window> | null = null

function crash(err: unknown) {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
  log.error('uncaught:', message)
  try {
    shownUi!.showError(message)
  } catch {
    showCrash(message, shownWindow)
  }
}

Bare.on('uncaughtException', crash)
Bare.on('unhandledRejection', crash)

// Bluetooth failures, in words someone can act on.
function explainRadio(err: Error): string {
  const text = err.message
  if (/SecurityException|permission/i.test(text)) {
    return 'bluetooth is blocked: open Settings › Apps › ekho › Permissions, allow Nearby devices, then try again'
  }
  if (/not turned on|poweredOff|BT Adapter/i.test(text)) return 'turn bluetooth on, then try again'
  return 'radio: ' + text
}

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

  log.info('irc: connecting to ' + IRC_HOST + ':' + IRC_PORT + ' as ' + settings.nick)

  // Every line the server sends, so the log reads like a terminal. Lines we
  // send aren't logged, as they carry the password.
  irc.on('line', (line: string) => log.info('irc <', line))
  irc.on('ready', () => log.info('irc: logged in as ' + settings.nick))
  irc.on('close', () => log.warn('irc: connection closed'))
  irc.on('error', (err: Error) => {
    log.error('irc:', err)
    ui.showError('irc: ' + err.message)
  })
  if (register) irc.once('ready', () => irc.register())

  messenger.setIrc(irc)
  irc.connect()
}

let radioBusy = false

const ui = new Ui(
  messenger,
  {
    connectRadio() {
      // One attempt at a time: a second would scan while the first holds the
      // radio, and never find it.
      if (radioBusy) return log.warn('radio: already connecting')
      radioBusy = true

      ui.setRadioStatus('looking for your radio… keep it close and on')
      log.info('radio: connecting')
      connectRadio({
        onstatus: (status) => {
          log.info('radio:', status)
          ui.setRadioStatus(status)
        }
      }).then(
        ({ client }) => {
          radioBusy = false
          messenger.node = client.id
          messenger.setRadio(client)
          ui.setRadioStatus('connected as ' + client.id)
          log.info('radio: connected as', client.id)
          client.on('close', () => {
            log.warn('radio: disconnected')
            ui.setRadioStatus('disconnected: press connect to try again', true)
          })
        },
        (err: Error) => {
          radioBusy = false
          log.error('radio:', err)
          ui.setRadioStatus(explainRadio(err), true)
        }
      )
    },

    connectIrc({ nick, password, register }) {
      settings.nick = nick
      settings.password = password
      save()
      connectIrc(register)
    }
  },
  { nick: settings.nick, password: settings.password, log }
)

const window = new Window(1100, 720)

window.content(ui.root)
window.show()
shownUi = ui
shownWindow = window

ui.setCompact(window.size.width < COMPACT)
window.on('resize', () => ui.setCompact(window.size.width < COMPACT))

// Log back in to IRC with the saved nick.
if (settings.nick) connectIrc(false)
