// Screenshots for the README. Run by .github/workflows/screens.yml on macOS
// with bare-native-test: each case sets up a screen with demo data, prints
// `# shot <name>`, and holds it while the workflow captures the screen.
import tap from 'bare-tap'
import native from 'bare-native'
import Messenger from '../lib/messenger.ts'
import Irc from '../lib/irc.ts'
import Heard from '../lib/heard.ts'
import Ui from '../lib/ui.ts'
import Link from '../lib/link.ts'
import { FakeRadio, FakeStream } from '../test/helpers.ts'

const { test } = tap
const { Window } = native

const HOLD = 4000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// A link that stays where it's put, for showing. Its state is set once the
// window is up, as in the app: a spinner set going before then is never seen.
function link(name: string) {
  return new Link(name, () => new Promise(() => {}))
}

function put(l: Link, state: 'off' | 'connecting' | 'on', detail = '') {
  l.state = state
  l.detail = detail
  l.emit('change')
}

function actions() {
  return {
    connectRadio() {},
    disconnectRadio() {},
    connectIrc() {},
    logOutIrc() {},
    finishOnboarding() {},
    toggleChannel() {}
  }
}

// A messenger with a radio, IRC and a few conversations, as after a while.
function world() {
  let time = Date.now() - 40 * 60_000
  const now = () => time
  const tick = (minutes: number) => (time += minutes * 60_000)

  const heard = new Heard({ now })
  const messenger = new Messenger({ ircChannel: '#bulgaria', heard, now, node: '!0e8666a6' })

  const radio = new FakeRadio()
  radio.id = '!0e8666a6'
  messenger.setRadio(radio as never)

  const stream = new FakeStream()
  const irc = new Irc(stream as never, { nick: 'dom' })
  messenger.setIrc(irc)
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')

  const node = (from: string, name: string, text: string, hops = 1) =>
    radio.emit('message', { from, name, text, snr: 6, rssi: -97, hops, direct: true })
  const channel = (from: string, name: string, text: string) =>
    radio.emit('message', { from, name, text, snr: 4, rssi: -104, hops: 2, direct: false })

  for (const n of ['!a7c3e91f', '!5b0d2c44', '!91e0aa13', '!c4f2071d', '!0b7e55a2']) {
    radio.emit('position', { from: n })
  }

  channel('!5b0d2c44', 'Vitosha relay', 'relay back up after the storm, solar looks fine')
  tick(3)
  node('!a7c3e91f', 'Ivan', 'are you coming to the meetup on saturday?', 2)
  tick(2)
  const ivan = messenger.contacts.byNode('!a7c3e91f')!
  messenger.send(ivan, 'yes! bringing the spare T-Beam')
  radio.emit('ack', { id: radio.sent.at(-1)!.opts.id!, delivered: true, reason: null })
  tick(1)
  node('!a7c3e91f', 'Ivan', 'great, take the spare cable too', 2)
  tick(4)
  messenger.react(messenger.thread(ivan).at(-1)!, '👍')
  tick(1)
  messenger.send(ivan, 'leaving at 9, see you at the hut')
  radio.emit('ack', { id: radio.sent.at(-1)!.opts.id!, delivered: false, reason: 'MAX_RETRANSMIT' })

  stream.serve(
    ':georgi!~g@host PRIVMSG dom :saw your node on the map, nice coverage from there\r\n'
  )
  messenger.link(ivan, { nick: 'ivanp' })
  messenger.rename(ivan, 'Ivan P')
  tick(2)
  channel('!91e0aa13', 'Plovdiv GW', 'anyone hearing Varna tonight?')

  return { messenger, ivan }
}

// Markers in the output, so a run that dies shows where.
const step = (text: string) => console.log('# step ' + text)

async function shot(name: string, setup: (ui: Ui) => void, ui: Ui) {
  step(name + ': window')
  const window = new Window(390, 844)
  step(name + ': content')
  window.content(ui.root)
  step(name + ': show')
  window.show()
  ui.setCompact(true)
  step(name + ': wait')
  await sleep(300)
  step(name + ': setup')
  setup(ui)
  step(name + ': shown')
  await sleep(500)
  console.log('# shot ' + name)
  await sleep(HOLD)
  window.hide()
}

test('onboarding', async (t) => {
  step('onboarding: start')
  const messenger = new Messenger({ ircChannel: '#bulgaria' })
  const radio = link('radio')
  step('onboarding: ui')
  const ui = new Ui(messenger, actions(), { onboarded: false, radio, irc: link('irc') })
  await shot('onboarding', () => put(radio, 'connecting', 'syncing: 37 nodes so far'), ui)
  t.pass()
})

test('chats', async (t) => {
  const { messenger } = world()
  const radio = link('radio')
  const irc = link('irc')
  const ui = new Ui(messenger, actions(), { radio, irc })
  const up = () => {
    put(radio, 'on')
    put(irc, 'on')
  }
  await shot('chats', up, ui)
  t.pass()
})

test('conversation', async (t) => {
  const { messenger, ivan } = world()
  const radio = link('radio')
  const irc = link('irc')
  const ui = new Ui(messenger, actions(), { radio, irc })
  const up = () => {
    put(radio, 'on')
    put(irc, 'on')
  }
  await shot(
    'conversation',
    () => {
      up()
      ui.select(ivan)
    },
    ui
  )
  t.pass()
})

test('contact', async (t) => {
  const { messenger, ivan } = world()
  const radio = link('radio')
  const irc = link('irc')
  const ui = new Ui(messenger, actions(), { radio, irc })
  const up = () => {
    put(radio, 'on')
    put(irc, 'on')
  }
  await shot(
    'contact',
    () => {
      up()
      ui.select(ivan)
      ui.toggleInfo()
    },
    ui
  )
  t.pass()
})

test('settings', async (t) => {
  const { messenger } = world()
  const radio = link('radio')
  const irc = link('irc')
  const ui = new Ui(messenger, actions(), { radio, irc })
  const up = () => {
    put(radio, 'on')
    put(irc, 'on')
  }
  await shot(
    'settings',
    () => {
      up()
      ui.show('settings')
      ui.setChannels(
        [
          { name: '#bulgaria', users: 146, topic: '' },
          { name: '#sofia', users: 31, topic: '' },
          { name: '#varna', users: 12, topic: '' },
          { name: '#plovdiv', users: 9, topic: '' },
          { name: '#vt', users: 6, topic: '' }
        ],
        ['#sofia'],
        '#bulgaria'
      )
    },
    ui
  )
  t.pass()
})
