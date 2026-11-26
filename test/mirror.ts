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

test('numbering carries on from the feed when the saved state is older', async (t) => {
  const { stream, messenger, feed } = await linked()
  const stale = messenger.toJSON()
  stream.serve(':georgi!u@h PRIVMSG dom :one more\r\n')
  await settle()
  const last = messenger.thread(messenger.contacts.byNick('georgi')!).at(-1)!

  // Restarted before saving: the state on disk doesn't have the last message.
  const again = new Messenger({ ircChannel: '#bulgaria', state: JSON.parse(JSON.stringify(stale)) })
  const hub = new Hub(again, feed)
  await hub.ready()
  const georgi = again.contacts.byNick('georgi')!
  again.receive(georgi, { ...last, ref: undefined, id: 1 })
  t.ok(again.thread(georgi).at(-1)!.ref! > last.ref!, 'a new number, not one already used')
})

test('applying the feed again from the start changes nothing', async (t) => {
  const { feed, outbox, mac } = await linked()
  const before = JSON.stringify(mac.toJSON().threads)

  const again = new Mirror(mac, feed, outbox)
  await again.update()

  t.equal(JSON.stringify(mac.toJSON().threads), before)
})

test('the phone skips what isn’t a request from a linked device', async (t) => {
  const { stream, outbox } = await linked()
  stream.lines.length = 0

  await outbox.append({ type: 'send', contact: 'irc:georgi', text: 7 } as never)
  await outbox.append({ type: 'wipe' } as never)
  await outbox.append({ type: 'send', local: 1, contact: 'irc:georgi', text: 'ok', via: null })
  await settle()

  t.deepStrictEqual(stream.lines, ['PRIVMSG georgi :ok'])
})

test('a feed from a newer ekho stops being applied, and says so', async (t) => {
  const { feed, mac, mirror } = await linked()
  let newer = false
  mirror.on('newer', () => (newer = true))
  const at = mirror.applied

  await feed.append({ format: 99, type: 'status', status: mac.status() } as never)
  await settle()

  t.ok(newer)
  t.equal(mirror.applied, at)
})

test('a linked device that missed the whole state asks for it, and gets every conversation', async (t) => {
  const { stream, messenger, feed, outbox } = await linked()
  stream.serve(':maria!u@h PRIVMSG dom :from before\r\n')
  await settle()

  // A device that only follows from here on: the start of the feed is lost to it.
  const late = new Messenger({ ircChannel: '#bulgaria' })
  const mirror = new Mirror(late, feed, outbox, { applied: feed.length })
  let synced = false
  mirror.on('synced', () => (synced = true))
  await mirror.update()
  t.equal(late.contacts.byNick('maria'), null)

  mirror.sync()
  await settle()

  t.ok(synced)
  t.deepStrictEqual(
    late.thread(late.contacts.byNick('maria')!).map((m) => m.text),
    ['from before']
  )
  t.ok(messenger.contacts.byNick('georgi') !== null && late.contacts.byNick('georgi') !== null)
})
