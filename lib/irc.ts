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
// reclaim (account), nick (nick), error, close.
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

  _buffer: string
  _reclaiming: boolean
  _listing: { name: string; users: number; topic: string }[]
  _reclaimTimer: ReturnType<typeof setTimeout> | null

  constructor(
    stream: Duplex,
    opts: { nick: string; password?: string | null; realname?: string; channels?: string[] }
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

    this._buffer = ''
    this._reclaiming = false
    this._reclaimTimer = null
    this._listing = []

    stream.on('data', (data: Uint8Array) => this._ondata(data))
    stream.on('error', (err: Error) => this.emit('error', err))
    stream.on('close', () => {
      this.ready = false
      if (this._reclaimTimer !== null) clearTimeout(this._reclaimTimer)
      this.emit('close')
    })
  }

  // Send the login. The server answers with 001 when it has accepted the
  // nick, which emits `ready`.
  connect(): void {
    this._send('NICK ' + this.nick)
    this._send('USER ' + this.nick + ' 0 * :' + this.realname)
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
    this._send('QUIT :' + reason)
    this.stream.end()
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
      this.emit('line', line)
      this._online(parse(line))
    }
  }

  _online(msg: Parsed): void {
    switch (msg.command) {
      case 'PING':
        this._send('PONG :' + (msg.params[0] ?? ''))
        return

      case '001':
        this.ready = true
        if (this.password) this.identify()
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
        }
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
