import tap from 'bare-tap'
import EventEmitter from 'bare-events'
import Link, { FatalError } from '../lib/link.ts'

const { test } = tap

// Timers a test runs by hand.
function timers() {
  const due: { fn: () => void; ms: number }[] = []
  return {
    due,
    setTimeout(fn: () => void, ms: number) {
      const t = { fn, ms }
      due.push(t)
      return t
    },
    clearTimeout(t: unknown) {
      const i = due.indexOf(t as never)
      if (i !== -1) due.splice(i, 1)
    },
    run() {
      const t = due.shift()!
      t.fn()
      return t.ms
    }
  }
}

class FakeConnection extends EventEmitter {
  closed: boolean
  constructor() {
    super()
    this.closed = false
  }
  close() {
    this.closed = true
  }
  drop() {
    this.emit('close')
  }
}

// A connect function whose attempts a test settles by hand.
function opener() {
  const attempts: {
    detail: (text: string) => void
    resolve: (c: FakeConnection) => void
    reject: (err: Error) => void
  }[] = []
  const connect = (detail: (text: string) => void) =>
    new Promise<FakeConnection>((resolve, reject) => attempts.push({ detail, resolve, reject }))
  return { attempts, connect }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('starts, connects, and reports each step', async (t) => {
  const { attempts, connect } = opener()
  const link = new Link('irc', connect, { timers: timers() })
  const seen: string[] = []
  link.on('change', () => seen.push(link.state + (link.detail ? ': ' + link.detail : '')))

  link.start()
  attempts[0].detail('logging in')
  attempts[0].resolve(new FakeConnection())
  await tick()

  t.deepStrictEqual(seen, ['connecting', 'connecting: logging in', 'on'])
  t.ok(link.wanted)
})

test('a drop retries after 5 s, 15 s, then every minute', async (t) => {
  const clock = timers()
  const { attempts, connect } = opener()
  const link = new Link('irc', connect, { timers: clock })

  link.start()
  attempts[0].resolve(new FakeConnection())
  await tick()
  ;(link.connection as FakeConnection).drop()
  t.equal(link.state, 'waiting')
  t.equal(link.detail, 'connection closed, retrying in 5 s')

  t.equal(clock.run(), 5_000)
  attempts[1].reject(new Error('network down'))
  await tick()
  t.equal(link.detail, 'network down, retrying in 15 s')

  t.equal(clock.run(), 15_000)
  attempts[2].reject(new Error('network down'))
  await tick()
  t.equal(clock.run(), 60_000)
  attempts[3].reject(new Error('network down'))
  await tick()
  t.equal(clock.run(), 60_000)

  // Once connected, the next drop starts from 5 s again.
  attempts[4].resolve(new FakeConnection())
  await tick()
  ;(link.connection as FakeConnection).drop()
  t.equal(clock.run(), 5_000)
})

test('a fatal error stops retrying until started again', async (t) => {
  const clock = timers()
  const { attempts, connect } = opener()
  const link = new Link('irc', connect, { timers: clock })

  link.start()
  attempts[0].reject(new FatalError('wrong password'))
  await tick()

  t.equal(link.state, 'failed')
  t.equal(link.detail, 'wrong password')
  t.equal(clock.due.length, 0)

  link.start()
  t.equal(link.state, 'connecting')
  t.equal(attempts.length, 2)
})

test('stop closes the connection and stops retrying', async (t) => {
  const clock = timers()
  const { attempts, connect } = opener()
  const link = new Link('radio', connect, { timers: clock })

  link.start()
  const connection = new FakeConnection()
  attempts[0].resolve(connection)
  await tick()

  link.stop()
  t.ok(connection.closed)
  t.equal(link.state, 'off')
  t.notOk(link.wanted)

  connection.drop()
  t.equal(clock.due.length, 0)
})

test('a connection that opens after stop is closed straight away', async (t) => {
  const { attempts, connect } = opener()
  const link = new Link('radio', connect, { timers: timers() })

  link.start()
  link.stop()
  const late = new FakeConnection()
  attempts[0].resolve(late)
  await tick()

  t.ok(late.closed)
  t.equal(link.state, 'off')
})

test('pause closes it, resume reconnects, and it stays wanted', async (t) => {
  const clock = timers()
  const { attempts, connect } = opener()
  const link = new Link('irc', connect, { timers: clock })

  link.start()
  const first = new FakeConnection()
  attempts[0].resolve(first)
  await tick()

  link.pause()
  t.ok(first.closed)
  t.equal(link.state, 'off')
  t.equal(link.detail, 'paused')
  t.ok(link.wanted)

  // The paused connection's own close doesn't schedule a retry.
  first.drop()
  t.equal(clock.due.length, 0)

  link.resume()
  t.equal(link.state, 'connecting')
  attempts[1].resolve(new FakeConnection())
  await tick()
  t.equal(link.state, 'on')
})

test('resume does nothing for a link nobody wants', (t) => {
  const { attempts, connect } = opener()
  const link = new Link('irc', connect, { timers: timers() })

  link.pause()
  link.resume()

  t.equal(link.state, 'off')
  t.equal(attempts.length, 0)
})

test('starting while connecting or on does nothing', async (t) => {
  const { attempts, connect } = opener()
  const link = new Link('irc', connect, { timers: timers() })

  link.start()
  link.start()
  t.equal(attempts.length, 1)

  attempts[0].resolve(new FakeConnection())
  await tick()
  link.start()
  t.equal(attempts.length, 1)
})
