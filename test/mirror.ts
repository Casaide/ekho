import tap from 'bare-tap'
import Irc from '../lib/irc.ts'
import Messenger from '../lib/messenger.ts'
import Hub from '../lib/hub.ts'
import type { Entry } from '../lib/hub.ts'
import Mirror from '../lib/mirror.ts'
import type { Command } from '../lib/types.ts'
import { FakeLog, FakeRadio, FakeStream, settle } from './helpers.ts'

const { test } = tap

// The phone, holding IRC, with a conversation from before it was linked.
function phone() {
  const stream = new FakeStream()
  const messenger = new Messenger({ ircChannel: '#bulgaria' })
  messenger.setIrc(new Irc(stream as never, { nick: 'dom' }))
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')
  stream.serve(':georgi!u@h PRIVMSG dom :are you up?\r\n')
  stream.lines.length = 0
  return { stream, messenger }
}

async function linked() {
  const { stream, messenger } = phone()
  const feed = new FakeLog<Entry>()
  const outbox = new FakeLog<Command>()
  const hub = new Hub(messenger, feed)
  await hub.ready()
  hub.follow(outbox, 'mac')

  const mac = new Messenger({ ircChannel: '#bulgaria' })
  const mirror = new Mirror(mac, feed, outbox)
  await mirror.update()

  return { stream, messenger, feed, outbox, hub, mac, mirror }
}

test('a linked device starts with the whole history, and follows what arrives', async (t) => {
  const { stream, mac } = await linked()

  const georgi = mac.contacts.byNick('georgi')!
  t.deepStrictEqual(
    mac.thread(georgi).map((m) => m.text),
    ['are you up?']
  )
  t.equal(mac.route(), 'irc', 'the route is the phone’s')

  stream.serve(':georgi!u@h PRIVMSG dom :the hut has power\r\n')
  await settle()
  t.deepStrictEqual(
    mac.thread(georgi).map((m) => m.text),
    ['are you up?', 'the hut has power']
  )
})

test('sending on a linked device goes out the phone, and shows as the phone sent it', async (t) => {
  const { stream, mac, outbox } = await linked()
  const georgi = mac.contacts.byNick('georgi')!

  const msg = mac.send(georgi, 'yes, leaving now')
  t.equal(msg.state, 'sending')
  await settle()

  t.equal(outbox.length, 1)
  t.deepStrictEqual(stream.lines, ['PRIVMSG georgi :yes, leaving now'])
  t.equal(mac.thread(georgi).length, 2, 'one copy, not two')
  t.equal(msg.state, 'sent')
  t.ok(msg.ref !== undefined, 'numbered by the phone')
})

test('a failed LoRa message is retried or sent over IRC from the linked device', async (t) => {
  const { messenger, mac } = await linked()
  const radio = new FakeRadio()
  messenger.setRadio(radio as never)
  radio.emit('position', { from: '!a7c3e91f' })
  const ivan = messenger.addContact({ name: 'ivan', node: '!a7c3e91f', nick: 'ivanp' })

  const sent = messenger.send(ivan, 'take the spare cable')
  radio.emit('ack', { id: sent.id, delivered: false, reason: 'MAX_RETRANSMIT' })
  await settle()

  const copy = mac.thread(mac.contacts.get(ivan.id)!)[0]
  t.equal(copy.state, 'failed')

  mac.sendViaIrc(copy)
  await settle()
  t.equal(sent.via, 'irc')
  t.equal(copy.state, 'sent')
})

test('the phone restarting keeps numbering where it was, without a new snapshot', async (t) => {
  const { messenger, feed } = await linked()
  const before = feed.length

  const again = new Messenger({ ircChannel: '#bulgaria', state: messenger.toJSON() })
  await new Hub(again, feed).ready()

  t.equal(feed.length, before)
})
