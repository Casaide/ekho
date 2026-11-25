import EventEmitter from 'bare-events'
import b4a from 'b4a'
import type { Duplex } from 'bare-stream'

// IRC lines are capped at 512 bytes including the command and target, so
// text is split well under that.
const MAX_TEXT = 400

interface Parsed {
  nick: string | null
  command: string
  params: string[]
}

// A small IRC client over any duplex stream: a TLS socket in the app, a fake
// in tests. It speaks just what ekho needs - log in, NickServ, join, and
// private messages to nicks and channels.
//
// Events: ready, line (each line the server sends), message ({ from, to, text,
// direct }), notice ({ from, text }), channels ([{ name, users, topic }]),
// login (account), reclaim (account), nick (nick), error, close.
// Who's where: names (channel, nicks), join, part ({ nick, channel }),
// quit ({ nick }), rename ({ from, to }) for nicks other than ours.
//
// With a password it logs in during the handshake with SASL PLAIN, and falls
// back to NickServ IDENTIFY where the server doesn't offer SASL. A wrong
// password is an error with code `LOGIN_FAILED`.
//
// A server silent for `quiet` ms is pinged; one silent a further 30 s is
// taken as gone, and the stream destroyed.
//
// A nick left behind by a dropped connection is reclaimed when the password
// is known: log in as `nick_`, ask NickServ to GHOST the old session, then
// take the nick back.
export default class Irc extends EventEmitter {
  stream: Duplex
  nick: string
  account: string
  password: string | null
  realname: string
  channels: string[]
  ready: boolean
  quitting: boolean
  loggedIn: boolean
  quiet: number

  _buffer: string
  _reclaiming: boolean
  _sasl: 'none' | 'asking' | 'done'
  _caps: string[]
  _watchdog: ReturnType<typeof setTimeout> | null
  _listing: { name: string; users: number; topic: string }[]
  _names: Map<string, string[]>
  _reclaimTimer: ReturnType<typeof setTimeout> | null

  constructor(
    stream: Duplex,
    opts: {
      nick: string
      password?: string | null
      realname?: string
      channels?: string[]
      quiet?: number
    }
  ) {
    super()

    this.stream = stream
    this.nick = opts.nick
    this.account = opts.nick
    this.password = opts.password ?? null
    this.realname = opts.realname ?? opts.nick
    this.channels = opts.channels ?? []
    this.ready = false
    this.quitting = false
    this.loggedIn = false
    this.quiet = opts.quiet ?? 120_000

    this._buffer = ''
    this._reclaiming = false
    this._reclaimTimer = null
    this._sasl = 'none'
    this._caps = []
    this._watchdog = null
    this._listing = []
    this._names = new Map()

    stream.on('data', (data: Uint8Array) => this._ondata(data))
    stream.on('error', (err: Error) => this.emit('error', err))
    stream.on('close', () => {
      this.ready = false
      if (this._reclaimTimer !== null) clearTimeout(this._reclaimTimer)
      if (this._watchdog !== null) clearTimeout(this._watchdog)
      this._watchdog = null
      this.emit('close')
    })
  }

  // Send the login. The server answers with 001 when it has accepted the
  // nick, which emits `ready`.
  connect(): void {
    // Ask what the server offers first, for SASL; one that doesn't know CAP
    // ignores it.
    if (this.password) this._send('CAP LS 302')
    this._send('NICK ' + this.nick)
    this._send('USER ' + this.nick + ' 0 * :' + this.realname)
    this._listen()
  }

  // Say goodbye and close, as the Link connection interface asks.
  close(): void {
    this.quit()
  }

  // One-off NickServ registration. Servers differ on whether an email is
  // required; pass one when they do.
  register(email: string | null = null): void {
    this.privmsg('NickServ', 'REGISTER ' + this.password + (email ? ' ' + email : ''))
  }

  // Names the account when logged in under another nick, as when reclaiming.
  identify(): void {
    const account = this.nick === this.account ? '' : this.account + ' '
    this.privmsg('NickServ', 'IDENTIFY ' + account + this.password)
  }

  join(channel: string): void {
    this._send('JOIN ' + channel)
  }

  part(channel: string): void {
    this._send('PART ' + channel)
  }

  // Ask for the server's channels; they arrive as one `channels` event.
  list(): void {
    this._listing = []
    this._send('LIST')
  }

  // Returns how many lines the text took.
  privmsg(target: string, text: string): number {
    const lines = split(text)
    for (const line of lines) this._send('PRIVMSG ' + target + ' :' + line)
    return lines.length
  }

  quit(reason = 'bye'): void {
    this.quitting = true
    if (this._watchdog !== null) clearTimeout(this._watchdog)
    this._watchdog = null
    this._send('QUIT :' + reason)
    this.stream.end()
  }

  _oncap(msg: Parsed): void {
    const sub = msg.params[1]
    const last = msg.params[msg.params.length - 1]

    if (sub === 'LS') {
      this._caps.push(...last.split(' '))
      // `*` before the list means more lines follow.
      if (msg.params[2] === '*') return
      const sasl = this._caps.some((c) => c === 'sasl' || c.startsWith('sasl='))
      if (sasl) {
        this._sasl = 'asking'
        this._send('CAP REQ :sasl')
      } else {
        this._send('CAP END')
      }
      return
    }

    if (sub === 'ACK' && last.trim() === 'sasl') return this._send('AUTHENTICATE PLAIN')

    if (sub === 'NAK') {
      this._sasl = 'none'
      this._send('CAP END')
    }
  }

  // Reset the silence timer: ping after `quiet`, give up 30 s after that.
  _listen(pinged = false): void {
    if (this._watchdog !== null) clearTimeout(this._watchdog)
    if (this.quitting) return
    this._watchdog = setTimeout(
      () => {
        this._watchdog = null
        if (pinged) return this.stream.destroy(new Error('the server stopped answering'))
        this._send('PING :ekho')
        this._listen(true)
      },
      pinged ? 30_000 : this.quiet
    )
    // The socket keeps the app alive; this timer alone shouldn't.
    this._watchdog.unref()
  }

  _send(line: string): void {
    this.stream.write(b4a.from(line + '\r\n'))
  }

  _ondata(data: Uint8Array): void {
    this._buffer += b4a.toString(data)

    let i
    while ((i = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.slice(0, i).replace(/\r$/, '')
      this._buffer = this._buffer.slice(i + 1)
      if (line === '') continue
      this._listen()
      this.emit('line', line)
      this._online(parse(line))
    }
  }

  _online(msg: Parsed): void {
    switch (msg.command) {
      case 'PING':
        this._send('PONG :' + (msg.params[0] ?? ''))
        return

      case 'CAP':
        return this._oncap(msg)

      case 'AUTHENTICATE':
        if (msg.params[0] === '+') {
          const plain = this.account + '\0' + this.account + '\0' + this.password
          this._send('AUTHENTICATE ' + b4a.toString(b4a.from(plain), 'base64'))
        }
        return

      case '900':
        this.loggedIn = true
        this.emit('login', this.account)
        return

      case '903':
        this._sasl = 'done'
        this._send('CAP END')
        return

      case '902':
      case '904':
      case '905': {
        this._send('CAP END')
        const err = new Error(
          'Login failed for ' + this.account + ': wrong nick or password'
        ) as Error & { code: string }
        err.code = 'LOGIN_FAILED'
        this.emit('error', err)
        return
      }

      case '001':
        this.ready = true
        // Logged in during the handshake already, or ask NickServ now.
        if (this.password && this._sasl !== 'done') this.identify()
        if (this._reclaiming) {
          this.privmsg('NickServ', 'GHOST ' + this.account + ' ' + this.password)
          // Give NickServ a moment to drop the old session.
          this._reclaimTimer = setTimeout(() => {
            this._reclaimTimer = null
            this._send('NICK ' + this.account)
          }, 2000)
        }
        for (const channel of this.channels) this.join(channel)
        this.emit('ready')
        return

      case '433': {
        // Taken while logging in, and we can prove it's ours: log in under
        // another nick for now, and reclaim it once in.
        if (!this.ready && this.password && !this._reclaiming) {
          this._reclaiming = true
          this.nick = this.account + '_'
          this._send('NICK ' + this.nick)
          this.emit('reclaim', this.account)
          return
        }

        this._reclaiming = false
        const err = new Error('Nick already in use: ' + this.account) as Error & { code: string }
        err.code = 'NICK_IN_USE'
        this.emit('error', err)
        return
      }

      case '322':
        this._listing.push({
          name: msg.params[1],
          users: Number(msg.params[2]),
          topic: msg.params[3] ?? ''
        })
        return

      case '323':
        this.emit('channels', this._listing)
        this._listing = []
        return

      case 'NICK':
        if (msg.nick === this.nick) {
          this.nick = msg.params[0]
          if (this.nick === this.account) this._reclaiming = false
          this.emit('nick', this.nick)
        } else {
          this.emit('rename', { from: msg.nick, to: msg.params[0] })
        }
        return

      // NAMES: who's in a channel, over several lines, then 366.
      case '353': {
        const channel = msg.params[2]
        const nicks = this._names.get(channel) ?? []
        for (const name of (msg.params[3] ?? '').split(' ')) {
          if (name) nicks.push(name.replace(/^[@+%&~]+/, ''))
        }
        this._names.set(channel, nicks)
        return
      }

      case '366': {
        const channel = msg.params[1]
        this.emit('names', channel, this._names.get(channel) ?? [])
        this._names.delete(channel)
        return
      }

      case 'JOIN':
        this.emit('join', { nick: msg.nick, channel: msg.params[0] })
        return

      case 'PART':
        this.emit('part', { nick: msg.nick, channel: msg.params[0] })
        return

      case 'QUIT':
        this.emit('quit', { nick: msg.nick })
        return

      case 'NOTICE':
        this.emit('notice', { from: msg.nick, text: msg.params[1] ?? '' })
        return

      case 'PRIVMSG': {
        const to = msg.params[0]
        this.emit('message', {
          from: msg.nick,
          to,
          text: msg.params[1] ?? '',
          direct: to.toLowerCase() === this.nick.toLowerCase()
        })
      }
    }
  }
}

function parse(line: string): Parsed {
  // IRCv3 message tags come first when the server sends them; ekho does not
  // use them.
  if (line[0] === '@') line = line.slice(line.indexOf(' ') + 1)

  let prefix: string | null = null
  if (line[0] === ':') {
    const i = line.indexOf(' ')
    prefix = line.slice(1, i)
    line = line.slice(i + 1)
  }

  const t = line.indexOf(' :')
  const params = (t === -1 ? line : line.slice(0, t)).split(' ').filter(Boolean)
  const command = params.shift()!
  if (t !== -1) params.push(line.slice(t + 2))

  return { nick: prefix === null ? null : prefix.split('!')[0], command, params }
}

function split(text: string): string[] {
  const lines: string[] = []
  for (const part of text.split('\n')) {
    for (let i = 0; i < part.length; i += MAX_TEXT) lines.push(part.slice(i, i + MAX_TEXT))
  }
  return lines.length ? lines : ['']
}
