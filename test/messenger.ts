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

test('linking a nick merges that IRC contact into the person', (t) => {
  const { c, radio, stream, messenger } = setup()

  stream.serve(':georgi!u@host PRIVMSG dom :from irc\r\n')
  c.tick(1000)
  radio.emit('message', {
    from: '!1b2c3d4e',
    name: 'GEO',
    text: 'from lora',
    snr: 1,
    rssi: -100,
    hops: 1,
    direct: true
  })

  const node = messenger.contacts.byNode('!1b2c3d4e')!
  messenger.link(node, { nick: 'georgi' })

  t.equal(messenger.contacts.byNick('georgi'), node)
  t.equal(messenger.contacts.get('irc:georgi'), null, 'the IRC-only contact is gone')
  t.deepStrictEqual(
    messenger.thread(node).map((m) => m.text),
    ['from irc', 'from lora']
  )
})

test('a reaction goes as a short text message on the current route', (t) => {
  const { stream, messenger, ivan } = setup()

  const original = messenger.send(ivan, 'take the spare cable')
  messenger.react(original, '♥')

  t.equal(stream.lines[1], 'PRIVMSG ivanp :♥ re: "take the spare cable" [!e2f4a910]')
})

test('state survives a restart, and unanswered sends come back failed', (t) => {
  const { radio, messenger, ivan } = setup()

  hearIvan(radio)
  messenger.send(ivan, 'still waiting for an ack')

  const restarted = new Messenger({
    ircChannel: '#sofiamesh',
    state: JSON.parse(JSON.stringify(messenger))
  })
  const thread = restarted.thread(restarted.contacts.byNode(IVAN)!)

  t.equal(thread.length, 2)
  t.equal(thread[1].state, 'failed')
  t.equal(thread[1].reason, 'INTERRUPTED')
  t.equal(restarted.channel.nicks[0], '#sofiamesh')
})

test('a replaced radio is let go', (t) => {
  const { radio, messenger, ivan } = setup()

  const fresh = new FakeRadio()
  messenger.setRadio(fresh as never)

  radio.emit('message', {
    from: IVAN,
    name: 'ivan',
    text: 'old radio',
    snr: 1,
    rssi: -100,
    hops: 0,
    direct: true
  })

  t.equal(messenger.thread(ivan).length, 0)
})

test('two contacts joined as one person keep every address, with an alias', (t) => {
  const { radio, stream, messenger } = setup()

  hearIvan(radio)
  stream.serve(':ivan_irc!u@host PRIVMSG dom :hi from irc\r\n')

  const lora = messenger.contacts.byNode(IVAN)!
  const irc = messenger.contacts.byNick('ivan_irc')!

  messenger.join(lora, irc)
  messenger.rename(lora, 'Ivan P')

  t.equal(messenger.contacts.byNick('ivan_irc'), lora)
  t.deepStrictEqual(lora.nicks, ['ivanp', 'ivan_irc'])
  t.equal(lora.alias, 'Ivan P')
  t.deepStrictEqual(
    messenger.thread(lora).map((m) => [m.via, m.address]),
    [
      ['lora', IVAN],
      ['irc', 'ivan_irc']
    ]
  )
})

test('a person with two nodes is sent to the one heard most recently', (t) => {
  const { c, radio, messenger, ivan } = setup()

  messenger.link(ivan, { node: '!5d02b7aa' })
  hearIvan(radio)
  c.tick(1000)
  radio.emit('position', { from: '!5d02b7aa' })

  const msg = messenger.send(ivan, 'which radio?')

  t.equal(msg.address, '!5d02b7aa')
  t.equal(radio.sent[0].opts.to, 0x5d02b7aa)
})

test('a channel saved under an old name is dropped for the current one', (t) => {
  const before = new Messenger({ ircChannel: '#mesh' })
  const state = JSON.parse(JSON.stringify(before))

  const after = new Messenger({ ircChannel: '#bulgaria', state })
  const channels = after.contacts.all().filter((c) => c.channel)

  t.deepStrictEqual(
    channels.map((c) => c.id),
    ['#bulgaria']
  )
})

test('regional channels are kept across restarts and go over IRC', (t) => {
  const radio = new FakeRadio()
  const stream = new FakeStream()
  const { now } = clock()
  const heard = new Heard({ now })

  const before = new Messenger({ ircChannel: '#bulgaria', heard, now })
  before.addChannel('#sofia')
  const state = JSON.parse(JSON.stringify(before))

  const m = new Messenger({ ircChannel: '#bulgaria', ircChannels: ['#sofia'], heard, now, state })
  m.setRadio(radio as never)
  radio.emit('position', { from: '!a1b2c3d4' })
  const irc = new Irc(stream as never, { nick: 'dom' })
  m.setIrc(irc)
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')

  const sofia = m.contacts.get('#sofia')!
  t.ok(sofia.channel)

  // LoRa is the route, yet a regional channel is IRC only.
  const msg = m.send(sofia, 'hello sofia')
  t.equal(msg.via, 'irc')
  t.equal(stream.lines.at(-1), 'PRIVMSG #sofia :hello sofia')

  m.removeChannel('#sofia')
  t.equal(m.contacts.get('#sofia'), null)
})
