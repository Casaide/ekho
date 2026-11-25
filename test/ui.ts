import tap from 'bare-tap'
import native from 'bare-native'
import Messenger from '../lib/messenger.ts'
import Irc from '../lib/irc.ts'
import Ui from '../lib/ui.ts'
import showCrash from '../lib/crash.ts'
import Link, { FatalError } from '../lib/link.ts'
import EventEmitter from 'bare-events'
import { FakeRadio, FakeStream } from './helpers.ts'

const { test } = tap
const { Window } = native

// Actions that do nothing, with any overridden.
function actions(own = {}) {
  return {
    connectRadio() {},
    disconnectRadio() {},
    connectIrc() {},
    logOutIrc() {},
    finishOnboarding() {},
    toggleChannel() {},
    ...own
  }
}

// Renders on the real bare-native, which throws on any style a node doesn't
// accept, so this catches layout mistakes before they crash the app.
test('every screen renders: chats, thread, contact info, join, compact', (t) => {
  const messenger = new Messenger({ ircChannel: '#sofia' })
  const ui = new Ui(messenger, actions(), { compact: true })

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  const radio = new FakeRadio()
  messenger.setRadio(radio as never)
  const stream = new FakeStream()
  messenger.setIrc(new Irc(stream as never, { nick: 'dom' }))
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')

  radio.emit('message', {
    from: '!a1b2c3d4',
    name: 'ivan',
    text: 'hello',
    snr: 1,
    rssi: -90,
    hops: 2,
    direct: true
  })
  stream.serve(':georgi!u@host PRIVMSG dom :over irc\r\n')

  const [ivan, georgi] = messenger.contacts.all().filter((c) => !c.channel)

  ui.select(ivan)
  messenger.send(ivan, 'reply')
  radio.emit('ack', { id: radio.sent[0].opts.id, delivered: false, reason: 'MAX_RETRANSMIT' })

  ui.toggleInfo()
  ui.render()
  messenger.rename(ivan, 'Ivan P')
  messenger.join(ivan, georgi)
  ui.toggleInfo()

  ui.setCompact(false)
  ui.select(null)

  t.equal(messenger.contacts.get(ivan.id)!.alias, 'Ivan P')
  t.equal(messenger.contacts.get(georgi.id), null)
})

test('errors show as a banner, NickServ notices show, and the log copies', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions())

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  ui.setIrcNotice('You are now logged in as dom')
  ui.setChannels(
    [
      { name: '#bulgaria', users: 140, topic: '' },
      { name: '#sofia', users: 12, topic: 'Sofia mesh' },
      { name: '#varna', users: 3, topic: '' }
    ],
    ['#sofia'],
    '#bulgaria'
  )
  ui.showError('Error: boom')
  ui.hideError()
  ui.showError('Error: again')

  ui.log.warn('something odd')
  ui.show('settings')
  ui.show('log')
  ui.log.error('while the log is open')
  ui.copyLog()
  ui.show('chats')

  t.equal(ui.log.entries.at(-1)!.text, 'log copied to the clipboard')
})

test('the crash screen renders an error', (t) => {
  const window = showCrash('Error: boom')
  t.teardown(() => window.hide())
  t.ok(window.contentView)
})

test('first run opens on onboarding, then chats; settings holds the same controls', (t) => {
  let finished = false
  const ui = new Ui(
    new Messenger(),
    actions({
      finishOnboarding() {
        finished = true
      }
    }),
    { onboarded: false }
  )

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  t.equal(ui.page, 'onboarding')
  ui.show('log')
  ui.back()
  t.equal(ui.page, 'onboarding', 'the log closes back to onboarding')
  ui.finishOnboarding()
  t.ok(finished)
  t.equal(ui.page, 'chats')
  ui.show('settings')
  t.equal(ui.page, 'settings')
  ui.show('chats')
})

test('the radio and IRC sections follow their links through every state', async (t) => {
  const pending: {
    detail: (text: string) => void
    resolve: (c: unknown) => void
    reject: (e: Error) => void
  }[] = []
  const connect = (detail: (text: string) => void) =>
    new Promise<any>((resolve, reject) => pending.push({ detail, resolve, reject }))
  const radio = new Link('radio', connect)
  const irc = new Link('irc', connect, { retry: [10] })

  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { radio, irc })

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => {
    radio.stop()
    irc.stop()
    window.hide()
  })
  ui.show('settings')

  radio.start()
  pending[0].detail('syncing: 37 nodes so far')
  pending[0].reject(new FatalError('turn Bluetooth on, then connect'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  t.equal(radio.state, 'failed')

  irc.start()
  const connection = new EventEmitter() as EventEmitter & { close(): void }
  connection.close = () => {}
  pending[1].resolve(connection)
  await new Promise((resolve) => setTimeout(resolve, 0))
  t.equal(irc.state, 'on')

  connection.emit('close')
  t.equal(irc.state, 'waiting')

  irc.pause()
  t.equal(irc.detail, 'paused')
  ui.show('chats')
})
