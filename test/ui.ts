import tap from 'bare-tap'
import native from 'bare-native'
import Messenger from '../lib/messenger.ts'
import Irc from '../lib/irc.ts'
import Ui from '../lib/ui.ts'
import showCrash from '../lib/crash.ts'
import { FakeRadio, FakeStream } from './helpers.ts'

const { test } = tap
const { Window } = native

// Renders on the real bare-native, which throws on any style a node doesn't
// accept, so this catches layout mistakes before they crash the app.
test('every screen renders: chats, thread, contact info, join, compact', (t) => {
  const messenger = new Messenger({ ircChannel: '#sofia' })
  const ui = new Ui(
    messenger,
    { connectRadio() {}, disconnectRadio() {}, connectIrc() {}, finishOnboarding() {} },
    { compact: true }
  )

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

test('errors show as a banner, the radio says what went wrong, and the log copies', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, {
    connectRadio() {},
    disconnectRadio() {},
    connectIrc() {},
    finishOnboarding() {}
  })

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  ui.setRadioStatus('looking for your radio…')
  ui.setRadioStatus('turn bluetooth on, then try again', true)
  ui.setRadioBusy(true)
  ui.setRadioStatus('syncing: 37 nodes so far')
  ui.setRadioBusy(false)
  ui.setRadioConnected('!0e8666a6')
  ui.setRadioConnected(null)
  ui.setIrcStatus('logged in as dom')
  ui.setIrcStatus('that nick is in use', true)
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
    {
      connectRadio() {},
      disconnectRadio() {},
      connectIrc() {},
      finishOnboarding() {
        finished = true
      }
    },
    { onboarded: false }
  )

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  t.equal(ui.page, 'onboarding')
  ui.finishOnboarding()
  t.ok(finished)
  t.equal(ui.page, 'chats')
  ui.show('settings')
  t.equal(ui.page, 'settings')
  ui.show('chats')
})
