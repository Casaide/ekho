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
  const ui = new Ui(messenger, { connectRadio() {}, connectIrc() {} }, { compact: true })

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

test('the crash screen renders an error', (t) => {
  const window = showCrash(new Error('boom'))
  t.teardown(() => window.hide())
  t.ok(window)
})
