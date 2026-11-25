import tap from 'bare-tap'
import Irc from '../lib/irc.ts'
import { FakeStream } from './helpers.ts'

const { test } = tap

function client(opts = {}) {
  const stream = new FakeStream()
  const irc = new Irc(stream as never, { nick: 'dom', ...opts })
  return { stream, irc }
}

test('logs in, identifies and joins once the server welcomes the nick', (t) => {
  const { stream, irc } = client({ password: 'secret', channels: ['#sofiamesh'] })

  let ready = false
  irc.on('ready', () => (ready = true))

  irc.connect()
  t.deepStrictEqual(stream.lines, ['NICK dom', 'USER dom 0 * :dom'])

  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')

  t.ok(ready)
  t.ok(irc.ready)
  t.deepStrictEqual(stream.lines.slice(2), ['PRIVMSG NickServ :IDENTIFY secret', 'JOIN #sofiamesh'])
})

test('answers PING', (t) => {
  const { stream } = client()

  stream.serve('PING :irc.motaba.net\r\n')

  t.deepStrictEqual(stream.lines, ['PONG :irc.motaba.net'])
})

test('emits direct and channel messages, across split chunks', (t) => {
  const { stream, irc } = client()
  const messages: unknown[] = []
  irc.on('message', (m) => messages.push(m))

  stream.serve(':ivanp!u@host PRIVMSG dom :hello the')
  stream.serve('re\r\n:georgi!u@host PRIVMSG #sofiamesh :new node up\r\n')

  t.deepStrictEqual(messages, [
    { from: 'ivanp', to: 'dom', text: 'hello there', direct: true },
    { from: 'georgi', to: '#sofiamesh', text: 'new node up', direct: false }
  ])
})

test('registers with NickServ', (t) => {
  const { stream, irc } = client({ password: 'secret' })

  irc.register('dom@example.com')

  t.deepStrictEqual(stream.lines, ['PRIVMSG NickServ :REGISTER secret dom@example.com'])
})

test('reports a nick in use as an error', (t) => {
  const { stream, irc } = client()
  let code = null
  irc.on('error', (err: Error & { code: string }) => (code = err.code))

  stream.serve(':irc.motaba.net 433 * dom :Nickname is already in use\r\n')

  t.equal(code, 'NICK_IN_USE')
})

test('splits long text across lines', (t) => {
  const { stream, irc } = client()

  t.equal(irc.privmsg('ivanp', 'x'.repeat(450)), 2)
  t.equal(stream.lines.length, 2)
})

test('emits every line the server sends', (t) => {
  const { stream, irc } = client()
  const lines: string[] = []
  irc.on('line', (line: string) => lines.push(line))

  stream.serve(':irc.motaba.net 900 dom dom!~dom@host dom :You are now logged in as dom\r\n')

  t.deepStrictEqual(lines, [
    ':irc.motaba.net 900 dom dom!~dom@host dom :You are now logged in as dom'
  ])
})

test('reclaims a nick left behind by a dropped connection', async (t) => {
  const { stream, irc } = client({ password: 'secret' })
  const nicks: string[] = []
  irc.on('nick', (nick: string) => nicks.push(nick))

  irc.connect()
  stream.serve(':irc.motaba.net 433 * dom :Nickname is already in use\r\n')
  t.equal(stream.lines.at(-1), 'NICK dom_')

  stream.serve(':irc.motaba.net 001 dom_ :Welcome\r\n')
  t.deepStrictEqual(stream.lines.slice(-2), [
    'PRIVMSG NickServ :IDENTIFY dom secret',
    'PRIVMSG NickServ :GHOST dom secret'
  ])

  await new Promise((resolve) => setTimeout(resolve, 2100))
  t.equal(stream.lines.at(-1), 'NICK dom')

  stream.serve(':dom_!~dom@host NICK :dom\r\n')
  t.equal(irc.nick, 'dom')
  t.deepStrictEqual(nicks, ['dom'])
})

test('without a password, a nick in use is an error', (t) => {
  const { stream, irc } = client()
  let code = null
  irc.on('error', (err: Error & { code: string }) => (code = err.code))

  irc.connect()
  stream.serve(':irc.motaba.net 433 * dom :Nickname is already in use\r\n')

  t.equal(code, 'NICK_IN_USE')
})
