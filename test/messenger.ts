import tap from 'bare-tap'
import Irc from '../lib/irc.ts'
import Heard from '../lib/heard.ts'
import Messenger from '../lib/messenger.ts'
import { FakeRadio, FakeStream, clock } from './helpers.ts'

const { test } = tap

const IVAN = '!a7c3e91f'

function setup() {
  const c = clock()
  const radio = new FakeRadio()
  const stream = new FakeStream()
  const irc = new Irc(stream as never, { nick: 'dom' })

  const messenger = new Messenger({
    heard: new Heard({ window: 60_000, now: c.now }),
    now: c.now,
    node: '!e2f4a910',
    ircChannel: '#sofiamesh'
  })

  messenger.setRadio(radio as never)
  messenger.setIrc(irc)

  irc.connect()
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')
  stream.lines.length = 0

  const ivan = messenger.contacts.add({ name: 'ivan', node: IVAN, nick: 'ivanp' })

  return { c, radio, stream, messenger, ivan }
}

function hearIvan(radio: FakeRadio) {
  radio.emit('message', {
    from: IVAN,
    name: 'ivan',
    text: 'on the ridge',
    snr: 5,
    rssi: -90,
    hops: 1,
    direct: true
  })
}

test('with no nodes heard, sends over IRC tagged with our node', (t) => {
  const { radio, stream, messenger, ivan } = setup()

  const msg = messenger.send(ivan, 'take the spare cable')

  t.equal(msg.via, 'irc')
  t.equal(msg.state, 'sent')
  t.equal(radio.sent.length, 0)
  t.deepStrictEqual(stream.lines, ['PRIVMSG ivanp :take the spare cable [!e2f4a910]'])
})

test('with a node heard, sends over LoRa and waits for the ack', (t) => {
  const { radio, messenger, ivan } = setup()

  hearIvan(radio)

  const msg = messenger.send(ivan, 'nice')

  t.equal(msg.via, 'lora')
  t.equal(msg.state, 'sending')
  t.equal(radio.sent[0].opts.to, 0xa7c3e91f)
  t.equal(radio.sent[0].opts.id, msg.id)

  radio.emit('ack', { id: msg.id, delivered: true, reason: 'NONE' })

  t.equal(msg.state, 'delivered')
})

test('a failed LoRa message can be retried or sent via IRC', (t) => {
  const { radio, stream, messenger, ivan } = setup()

  hearIvan(radio)

  const msg = messenger.send(ivan, 'coming down before dark?')
  radio.emit('ack', { id: msg.id, delivered: false, reason: 'MAX_RETRANSMIT' })

  t.equal(msg.state, 'failed')
  t.equal(msg.reason, 'MAX_RETRANSMIT')

  messenger.retry(msg)

  t.equal(msg.state, 'sending')
  t.equal(radio.sent.length, 2)

  radio.emit('ack', { id: msg.id, delivered: false, reason: 'MAX_RETRANSMIT' })
  messenger.sendViaIrc(msg)

  t.equal(msg.via, 'irc')
  t.equal(msg.state, 'sent')
  t.equal(stream.lines.length, 1)
})

test('the route falls back to IRC once nodes go quiet', (t) => {
  const { c, radio, messenger } = setup()

  hearIvan(radio)
  t.equal(messenger.route(), 'lora')

  c.tick(60_001)
  t.equal(messenger.route(), 'irc')
})

test('one thread per person, whichever path a message took', (t) => {
  const { radio, stream, messenger, ivan } = setup()

  hearIvan(radio)
  stream.serve(':ivanp!u@host PRIVMSG dom :also on irc\r\n')

  const thread = messenger.thread(ivan)

  t.equal(thread.length, 2)
  t.deepStrictEqual(
    thread.map((m) => m.via),
    ['lora', 'irc']
  )
})

test('IRC copies of channel traffic are skipped while LoRa is up', (t) => {
  const { radio, stream, messenger } = setup()

  hearIvan(radio)
  stream.serve(':georgi!u@host PRIVMSG #sofiamesh :new node up\r\n')

  t.equal(messenger.thread(messenger.channel).length, 0)
})

test('channel messages arrive over IRC when no nodes are heard', (t) => {
  const { stream, messenger } = setup()

  stream.serve(':georgi!u@host PRIVMSG #sofiamesh :new node up\r\n')

  const [msg] = messenger.thread(messenger.channel)
  t.equal(msg.from, 'georgi')
  t.equal(msg.via, 'irc')
})

test('a message to a stranger on LoRa creates a contact', (t) => {
  const { radio, messenger } = setup()

  radio.emit('message', {
    from: '!5d02b7aa',
    name: 'MARI',
    text: 'hi',
    snr: 1,
    rssi: -100,
    hops: 2,
    direct: true
  })

  const maria = messenger.contacts.byNode('!5d02b7aa')
  t.ok(maria)
  t.equal(maria!.name, 'MARI')
  t.equal(messenger.thread(maria!).length, 1)
})

test('sending fails cleanly when no path is up', (t) => {
  const messenger = new Messenger()
  const ivan = messenger.contacts.add({ node: IVAN })

  const msg = messenger.send(ivan, 'hello?')

  t.equal(msg.state, 'failed')
  t.equal(msg.reason, 'IRC_OFFLINE')
})
