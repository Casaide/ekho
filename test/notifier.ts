import tap from 'bare-tap'
import Irc from '../lib/irc.ts'
import Messenger from '../lib/messenger.ts'
import Notifier from '../lib/notifier.ts'
import { FakeStream } from './helpers.ts'

const { test } = tap

function setup() {
  const stream = new FakeStream()
  const messenger = new Messenger({ ircChannel: '#bulgaria' })
  messenger.setIrc(new Irc(stream as never, { nick: 'dom' }))
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')

  const shown: { id: number; title: string; body: string }[] = []
  const cancelled: number[] = []
  const notifier = new Notifier(
    messenger,
    {
      show: (id, { title, body }) => shown.push({ id, title, body }),
      cancel: (id) => cancelled.push(id)
    },
    { names: () => ['dom', 'Dom'] }
  )

  return { stream, messenger, notifier, shown, cancelled }
}

test('off screen, a message to you shows one notification per conversation', (t) => {
  const { stream, messenger, notifier, shown } = setup()

  stream.serve(':georgi!u@h PRIVMSG dom :are you up?\r\n')
  t.equal(shown.length, 0, 'nothing while on screen')

  notifier.foreground = false
  stream.serve(':georgi!u@h PRIVMSG dom :the hut has power\r\n')
  stream.serve(':georgi!u@h PRIVMSG dom :bring the cable\r\n')

  t.deepStrictEqual(
    shown.map((s) => s.title + ': ' + s.body),
    ['georgi: the hut has power', 'georgi · 2: bring the cable']
  )
  t.equal(shown[0].id, shown[1].id)
  t.equal(notifier.contact(shown[0].id), messenger.contacts.byNick('georgi'))
})

test('channel lines notify only when they name you', (t) => {
  const { stream, notifier, shown } = setup()
  notifier.foreground = false

  stream.serve(':maria!u@h PRIVMSG #bulgaria :anyone near Vitosha?\r\n')
  stream.serve(':maria!u@h PRIVMSG #bulgaria :dom, are you on the ridge?\r\n')

  t.deepStrictEqual(
    shown.map((s) => s.title + ': ' + s.body),
    ['maria in mesh: dom, are you on the ridge?']
  )
})

test('reading a conversation removes its notification, and counts start over', (t) => {
  const { stream, messenger, notifier, shown, cancelled } = setup()
  notifier.foreground = false

  stream.serve(':georgi!u@h PRIVMSG dom :one\r\n')
  messenger.markRead(messenger.contacts.byNick('georgi')!)
  t.deepStrictEqual(cancelled, [shown[0].id])

  stream.serve(':georgi!u@h PRIVMSG dom :two\r\n')
  t.equal(shown.at(-1)!.title, 'georgi')
})
