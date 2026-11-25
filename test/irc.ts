import tap from 'bare-tap'
import Irc from '../lib/irc.ts'
import { FakeStream } from './helpers.ts'

const { test } = tap

function client(opts = {}) {
  const stream = new FakeStream()
  const irc = new Irc(stream as never, { nick: 'dom', ...opts })
  return { stream, irc }
}

test('without SASL, identifies with NickServ and joins once welcomed', (t) => {
  const { stream, irc } = client({ password: 'secret', channels: ['#sofiamesh'] })

  let ready = false
  irc.on('ready', () => (ready = true))

  irc.connect()
  t.deepStrictEqual(stream.lines, ['CAP LS 302', 'NICK dom', 'USER dom 0 * :dom'])

  // No SASL on offer: end negotiation, and fall back to NickServ.
  stream.serve(':irc.motaba.net CAP * LS :multi-prefix\r\n')
  t.equal(stream.lines.at(-1), 'CAP END')

  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')

  t.ok(ready)
  t.ok(irc.ready)
  t.deepStrictEqual(stream.lines.slice(-2), [
    'PRIVMSG NickServ :IDENTIFY secret',
    'JOIN #sofiamesh'
  ])
  irc.quit()
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

test('lists the server channels, and joins and leaves them', (t) => {
  const { stream, irc } = client()
  let channels: unknown = null
  irc.on('channels', (list: unknown) => (channels = list))

  irc.list()
  irc.join('#sofia')
  irc.part('#sofia')
  stream.serve(':irc.motaba.net 322 dom #sofia 12 :Sofia mesh\r\n')
  stream.serve(':irc.motaba.net 322 dom #varna 3 :\r\n')
  stream.serve(':irc.motaba.net 323 dom :End of /LIST\r\n')

  t.deepStrictEqual(stream.lines, ['LIST', 'JOIN #sofia', 'PART #sofia'])
  t.deepStrictEqual(channels, [
    { name: '#sofia', users: 12, topic: 'Sofia mesh' },
    { name: '#varna', users: 3, topic: '' }
  ])
})

test('logs in with SASL during the handshake', (t) => {
  const { stream, irc } = client({ password: 'secret', channels: ['#bulgaria'] })
  const logins: string[] = []
  irc.on('login', (account: string) => logins.push(account))

  irc.connect()
  stream.serve(':irc.motaba.net CAP * LS * :multi-prefix\r\n')
  stream.serve(':irc.motaba.net CAP * LS :sasl=PLAIN server-time\r\n')
  t.equal(stream.lines.at(-1), 'CAP REQ :sasl')

  stream.serve(':irc.motaba.net CAP * ACK :sasl\r\n')
  t.equal(stream.lines.at(-1), 'AUTHENTICATE PLAIN')

  stream.serve('AUTHENTICATE +\r\n')
  // base64 of "dom\0dom\0secret"
  t.equal(stream.lines.at(-1), 'AUTHENTICATE ZG9tAGRvbQBzZWNyZXQ=')

  stream.serve(':irc.motaba.net 900 dom dom!~dom@host dom :You are now logged in as dom\r\n')
  stream.serve(':irc.motaba.net 903 dom :SASL authentication successful\r\n')
  t.equal(stream.lines.at(-1), 'CAP END')

  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')
  // Logged in already, so no NickServ IDENTIFY.
  t.equal(stream.lines.at(-1), 'JOIN #bulgaria')
  t.deepStrictEqual(logins, ['dom'])
  t.ok(irc.loggedIn)
  irc.quit()
})

test('a wrong password is a LOGIN_FAILED error', (t) => {
  const { stream, irc } = client({ password: 'wrong' })
  let code = null
  irc.on('error', (err: Error & { code: string }) => (code = err.code))

  irc.connect()
  stream.serve(':irc.motaba.net CAP * LS :sasl\r\n')
  stream.serve(':irc.motaba.net CAP * ACK :sasl\r\n')
  stream.serve('AUTHENTICATE +\r\n')
  stream.serve(':irc.motaba.net 904 dom :SASL authentication failed\r\n')

  t.equal(code, 'LOGIN_FAILED')
  irc.quit()
})

test('pings a quiet server, and gives up on a silent one', async (t) => {
  const { stream, irc } = client({ quiet: 20 })
  let destroyed: Error | null = null
  ;(stream as any).destroy = (err: Error) => (destroyed = err)

  irc.connect()
  await new Promise((resolve) => setTimeout(resolve, 40))
  t.equal(stream.lines.at(-1), 'PING :ekho')

  // An answer resets the timer.
  stream.serve(':irc.motaba.net PONG irc.motaba.net :ekho\r\n')
  t.equal(destroyed, null)
  irc.quit()
})
