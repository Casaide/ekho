import native from 'bare-native'
import tls from 'bare-tls'
import os from 'bare-os'
import path from 'bare-path'
import Messenger from './lib/messenger.ts'
import Irc from './lib/irc.ts'
import Store from './lib/store.ts'
import Ui from './lib/ui/index.ts'
import connectRadio from './lib/radio.ts'
import type { RadioConnection } from './lib/radio.ts'
import Link, { FatalError } from './lib/link.ts'
import Presence from './lib/presence.ts'
import Notifier from './lib/notifier.ts'
import Linker from './lib/linker.ts'
import type { RadioState } from './lib/types.ts'
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

// The community IRC server; it bridges IRC to the mesh both ways.
const IRC_HOST = 'irc.motaba.net'
const IRC_PORT = 6697
// The country-wide channel motaba bridges to the mesh, and joins everyone to.
// Regional ones are listed on the IRC setup screen to join.
const IRC_CHANNEL = '#bulgaria'

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

// The IRC login, and whether each link should be kept up: set by connecting
// or logging in, cleared by disconnecting or logging out. On start, and on
// coming back to the app, wanted links reconnect by themselves.
const settings = { nick: '', password: '', ...saved?.irc }
let wanted: { radio: boolean; irc: boolean } = {
  radio: saved?.wanted?.radio ?? false,
  irc: saved?.wanted?.irc ?? settings.nick !== ''
}
// Set once the first-run page is done; until then ekho opens on it.
let onboarded: boolean = saved?.onboarded ?? false
// Bridged channels joined beyond IRC_CHANNEL, such as regional ones.
let channels: string[] = saved?.channels ?? []
let serverChannels: { name: string; users: number; topic: string }[] | null = null
const messenger = new Messenger({
  ircChannel: IRC_CHANNEL,
  ircChannels: channels,
  state: saved?.messenger ?? null
})
// Who's around on the radio and IRC, for the contacts screen.
const presence = new Presence(messenger.heard)
// Our radio's names, to notice channel lines meant for us.
let radioNames: string[] = []
// Asked once for permission to notify; Android won't show the dialog often.
let askedNotifications: boolean = saved?.askedNotifications ?? false
// Ask for it: set where notifications exist, on Android.
let askToNotify = () => {}

// Other devices linked to this one, or the one this is linked to: then that
// device holds the radio and IRC, and this one mirrors it (lib/linker.ts).
const linker = new Linker(messenger, path.join(DATA, 'p2p'), saved?.link ?? null, {
  name: Bare.platform === 'darwin' ? 'mac' : Bare.platform === 'android' ? 'phone' : Bare.platform
})

// Save a second after the last change, not on every message.
let timer: ReturnType<typeof setTimeout> | null = null
function save() {
  if (timer !== null) return
  timer = setTimeout(() => {
    timer = null
    try {
      // The open conversation too, to reopen on start.
      const open = ui.selected?.id ?? null
      store.save({
        messenger,
        irc: settings,
        wanted,
        onboarded,
        channels,
        open,
        askedNotifications,
        link: linker.devices.saved
      })
    } catch (err) {
      console.error('save:', (err as Error).message)
    }
  }, 1000)
}

messenger.on('message', save)
messenger.on('update', save)
messenger.on('contacts', save)

let irc: Irc | null = null
// Set by the register button, for the next IRC attempt only.
let registering = false

// Open one IRC connection, for the IRC link: resolves once the server has
// let us in, rejects with a FatalError for what only the user can fix.
function openIrc(detail: (text: string) => void): Promise<Irc> {
  const register = registering
  registering = false

  const socket = tls.connect({ host: IRC_HOST, port: IRC_PORT })
  const current = new Irc(socket, {
    nick: settings.nick,
    password: settings.password,
    channels: [IRC_CHANNEL, ...channels]
  })

  log.info('irc: connecting to ' + IRC_HOST + ':' + IRC_PORT + ' as ' + settings.nick)
  detail('connecting as ' + settings.nick)

  // Every line the server sends, so the log reads like a terminal. Lines we
  // send aren't logged, as they carry the password.
  current.on('line', (line: string) => log.info('irc <', line))
  current.on('login', (account: string) => log.info('irc: logged in to account ' + account))
  current.on('reclaim', (account: string) => {
    log.warn('irc: ' + account + ' is held by an old connection; reclaiming it')
    detail(account + ' is held by an old connection, reclaiming it')
  })
  current.on('nick', (nick: string) => {
    log.info('irc: now ' + nick)
    ui.render()
  })
  current.on('notice', (n: { from: string; text: string }) => {
    if (n.from === 'NickServ') ui.setIrcNotice(n.text)
  })
  // Who's in our channels, for the contacts screen.
  current.on('ready', () => (presence.self.nick = current.nick))
  current.on('nick', (nick: string) => (presence.self.nick = nick))
  current.on('names', (channel: string, nicks: string[]) => presence.names(channel, nicks))
  current.on('join', (e: { nick: string; channel: string }) => presence.joined(e.channel, e.nick))
  current.on('part', (e: { nick: string; channel: string }) => presence.parted(e.channel, e.nick))
  current.on('quit', (e: { nick: string }) => presence.quit(e.nick))
  current.on('rename', (e: { from: string; to: string }) => presence.renamed(e.from, e.to))
  current.on('close', () => presence.clearIrc())
  current.on('channels', (list: { name: string; users: number; topic: string }[]) => {
    serverChannels = list.sort((a, b) => b.users - a.users)
    log.info('irc: ' + list.length + ' channels on the server')
    ui.setChannels(serverChannels, channels, IRC_CHANNEL)
  })
  current.on('close', () => log.warn('irc: connection closed'))

  return new Promise((resolve, reject) => {
    const give = (err: Error) => {
      current.removeAllListeners('ready')
      current.quit()
      socket.destroy()
      reject(err)
    }

    current.on('error', (err: Error & { code?: string }) => {
      log.error('irc:', err)
      if (current.ready) return
      if (err.code === 'LOGIN_FAILED') return give(new FatalError('wrong nick or password'))
      if (err.code === 'NICK_IN_USE') {
        return give(new FatalError(settings.nick + ' is in use, and no password to reclaim it'))
      }
      give(err)
    })
    current.once('close', () => {
      if (!current.ready) reject(new Error('the server closed the connection'))
    })
    current.once('ready', () => {
      irc = current
      messenger.setIrc(current)
      if (register) current.register()
      current.list()
      resolve(current)
    })

    current.connect()
  })
}

// The first retry is immediate: a drop is most often found on coming back to
// the app, when the server has given up on us meanwhile.
const ircLink = new Link('irc', openIrc, { retry: [0, 5_000, 15_000, 60_000] })
ircLink.on('change', () => {
  log.info('irc: ' + ircLink.state + (ircLink.detail ? ' · ' + ircLink.detail : ''))
  if (ircLink.state !== 'on') irc = null
  ui.render()
})

// Open the radio, for the radio link.
function openRadio(detail: (text: string) => void): Promise<RadioConnection> {
  detail('looking for your radio: keep it close and on')
  return connectRadio({
    onstatus: (status) => {
      log.info('radio:', status)
      detail(status)
    },
    onlog: (line) => log.info('radio:', line)
  }).then((connection) => {
    const client = connection.client
    const state = client as unknown as RadioState
    messenger.node = client.id
    messenger.setRadio(client)
    log.info('radio: connected as', client.id)

    // What the radio knows: its channels, paired with IRC ones by name;
    // the nodes it has heard of, by name, for contacts; and itself.
    const channels = [...state.channels.values()]
    messenger.setRadioChannels(channels)
    presence.self.node = client.id
    for (const node of state.nodes.values()) presence.node(nodeOf(node))
    client.on('node', (node: { num: number; user: any }) => presence.node(nodeOf(node)))

    const self = state.nodes.get(state.nodeNum)?.user ?? null
    radioNames = [self?.longName, self?.shortName].filter((n): n is string => !!n)
    ui.setRadioInfo({
      longName: self?.longName ?? null,
      shortName: self?.shortName ?? null,
      region: state.config?.region ?? null,
      preset: state.config?.preset ?? null,
      channels
    })
    log.info(
      'radio: channels ' +
        channels
          .filter((c) => c.role !== 0)
          .map((c) => c.index + ':' + (c.name || 'primary'))
          .join(', ')
    )
    return connection
  })
}

// A node from the radio's list, with its names, as presence keeps it.
function nodeOf(node: {
  num: number
  user: { longName: string | null; shortName: string | null } | null
}) {
  return {
    id: '!' + node.num.toString(16).padStart(8, '0'),
    longName: node.user?.longName ?? null,
    shortName: node.user?.shortName ?? null
  }
}

const radioLink = new Link('radio', openRadio)
radioLink.on('change', () => {
  log.info('radio: ' + radioLink.state + (radioLink.detail ? ' · ' + radioLink.detail : ''))
  ui.render()
})

function want(link: 'radio' | 'irc', on: boolean) {
  wanted = { ...wanted, [link]: on }
  save()
}

// Android pauses the app when it leaves the screen. IRC stays connected
// through it: the system keeps the connection and buffers what the server
// sends, so a short pause loses nothing, and motaba has no history to fetch
// it back from. On return a PING checks the server is still there; if it gave
// up on us meanwhile, IRC reconnects at once, reclaiming the nick. The radio's
// Bluetooth link outlives a pause too, and the radio queues what arrives.
Bare.on('suspend', () => {
  log.info('app: paused')
  ui.setVisible(false)
})
Bare.on('resume', () => {
  log.info('app: back')
  ui.setVisible(true)
  if (irc === null) return
  irc
    .probe()
    .then((alive) =>
      log.info('irc: ' + (alive ? 'still connected' : 'gone while paused, reconnecting'))
    )
})
Bare.on('exit', () => irc?.quit('closed'))

const ui = new Ui(
  messenger,
  {
    connectRadio() {
      want('radio', true)
      radioLink.start()
    },

    disconnectRadio() {
      want('radio', false)
      radioLink.stop()
    },

    toggleChannel(name: string) {
      if (channels.includes(name)) {
        channels = channels.filter((c) => c !== name)
        irc?.part(name)
        messenger.removeChannel(name)
        log.info('irc: left ' + name)
      } else {
        channels = [...channels, name]
        irc?.join(name)
        messenger.addChannel(name)
        log.info('irc: joined ' + name)
      }
      save()
      ui.setChannels(serverChannels, channels, IRC_CHANNEL)
    },

    openLink() {
      linker.open()
    },

    closeLink() {
      linker.close()
    },

    joinLink(code: string) {
      log.info('link: linking to a phone')
      linker.join(code)
    },

    unlink() {
      log.info('link: unlinked')
      linker.unlink()
    },

    forgetDevice(name: string) {
      linker.forget(name)
    },

    finishOnboarding() {
      onboarded = true
      save()
      askToNotify()
    },

    connectIrc({ nick, password, register }) {
      settings.nick = nick
      settings.password = password
      registering = register
      want('irc', true)
      // New details: close what's open and start over with them.
      ircLink.stop()
      ircLink.start()
    },

    logOutIrc() {
      want('irc', false)
      ircLink.stop()
    }
  },
  {
    nick: settings.nick,
    password: settings.password,
    log,
    onboarded,
    radio: radioLink,
    irc: ircLink,
    presence
  }
)

// `--size=390x844` opens the window at that size, for screenshots at phone
// size on a desktop.
const sized = Bare.argv.map((a) => /^--size=(\d+)x(\d+)$/.exec(a)).find((m) => m !== null)
const window = sized ? new Window(Number(sized[1]), Number(sized[2])) : new Window(1100, 720)

window.content(ui.root)
window.show()
shownUi = ui
shownWindow = window

ui.setWidth(window.size.width)
window.on('resize', () => ui.setWidth(window.size.width))

// Reopen the conversation that was open last time.
ui.on('select', save)
const reopen = onboarded && saved?.open ? messenger.contacts.get(saved.open) : null
if (reopen) ui.select(reopen)

// Bring back what was up last time, unless another device holds the radio
// and IRC for this one.
function startLinks() {
  if (wanted.radio) radioLink.start()
  if (wanted.irc && settings.nick) ircLink.start()
}
if (!linker.linked) startLinks()

linker.on('change', () => {
  save()
  ui.setLinking(linker.state())
})
// Linked: the radio and IRC are the hub's, and our own would fight it for
// them (one connection per nick on motaba). Unlinked: ours come back.
linker.on('role', (role: string) => {
  log.info('link: ' + role)
  if (role === 'linked') {
    radioLink.stop()
    ircLink.stop()
  } else {
    startLinks()
  }
})
linker.ready().then(
  () => {
    log.info('link: ready' + (linker.linked ? ', linked to a phone' : ''))
    ui.setLinking(linker.state())
  },
  (err: Error) => log.error('link:', err)
)
Bare.on('exit', () => linker.destroy())

// Paused by the OS: linking sleeps too, unless something keeps ekho running
// in the background (on Android, the foreground service below). Then it
// stays up, so a linked Mac still gets the phone's messages while it's in
// a pocket.
let keptRunning = () => false
let asleep = false
Bare.on('suspend', () => {
  if (keptRunning()) return
  asleep = true
  linker.suspend().then(() => log.info('link: asleep'))
})
Bare.on('resume', () => {
  if (!asleep) return
  asleep = false
  linker.resume().then(() => log.info('link: awake'))
})

// Android's back button and edge swipe: back within ekho, and out of the app
// only from chats. Android only, so loaded only there; the macOS build defers
// it (scripts/build-macos.sh).
if (Bare.platform === 'android') {
  const { default: back } = await import('bare-navigation-android')
  back.on('back', () => {
    if (!ui.goBack()) back.close()
  })
}

// While ekho is off screen on Android: a foreground service keeps it running,
// so the radio and IRC stay connected and messages still arrive, and a
// notification says when one is for you. Both are our own addons
// (packages/), built for Android only; the macOS build defers them.
if (Bare.platform === 'android') {
  const { default: notifications } = await import('bare-notifications-android')
  const service = await import('bare-foreground-service-android')

  const notifier = new Notifier(messenger, notifications, {
    names: () => [settings.nick, ...radioNames]
  })
  notifications.on('open', (id: number) => {
    const contact = notifier.contact(id)
    if (contact !== null) ui.select(contact)
  })

  askToNotify = () => {
    if (askedNotifications || notifications.granted) return
    askedNotifications = true
    save()
    notifications
      .request()
      .then((granted: boolean) => log.info('app: notifications ' + (granted ? 'on' : 'off')))
  }
  if (onboarded) askToNotify()

  // What the service's notification says, or null to stop it: running only
  // while a link is wanted.
  const running = () => {
    if (!wanted.radio && !wanted.irc) return null
    const parts = []
    const state = (link: Link) => (link.state === 'on' ? 'connected' : link.state)
    if (wanted.radio) parts.push('radio ' + state(radioLink))
    if (wanted.irc) parts.push('irc ' + state(ircLink))
    return parts.join(' · ')
  }
  let shown: string | null = null
  let onScreen = true
  // Android lets only an app on screen start or change the service, so it
  // catches up on coming back.
  const keepRunning = () => {
    if (!onScreen) return
    const text = running()
    if (text === shown) return
    try {
      if (text === null) service.stop()
      else service.start({ title: 'ekho is listening for messages', body: text })
      shown = text
    } catch (err) {
      log.warn('app: background service: ' + (err as Error).message)
    }
  }
  keptRunning = () => shown !== null
  radioLink.on('change', keepRunning)
  ircLink.on('change', keepRunning)
  keepRunning()

  Bare.on('suspend', () => {
    onScreen = false
    notifier.foreground = false
  })
  Bare.on('resume', () => {
    onScreen = true
    notifier.foreground = true
    keepRunning()
  })
  Bare.on('exit', () => service.stop())
}
