import tap from 'bare-tap'
import Log from '../lib/log.ts'

const { test } = tap

test('keeps info, warnings and errors, oldest dropped past the limit', (t) => {
  const log = new Log({ keep: 2, now: () => 0 })

  log.info('one')
  log.warn('two', { n: 2 })
  log.error(new Error('three'))

  t.deepStrictEqual(
    log.entries.map((e) => e.level),
    ['warn', 'error']
  )
  t.equal(log.entries[0].text, 'two {"n":2}')
  t.ok(log.entries[1].text.startsWith('Error: three'))
})

test('copies console output into the log and restores it', (t) => {
  const log = new Log({ now: () => 0 })
  const printed: string[] = []
  const target = {
    log: (s: string) => printed.push(s),
    info: (s: string) => printed.push(s),
    warn: (s: string) => printed.push(s),
    error: (s: string) => printed.push(s)
  } as unknown as Console

  const restore = log.capture(target)
  target.log('hello')
  target.error('bad')
  restore()
  target.log('after')

  t.deepStrictEqual(printed, ['hello', 'bad', 'after'])
  t.equal(
    log.toString(),
    '1970-01-01T00:00:00.000Z info  hello\n1970-01-01T00:00:00.000Z error bad'
  )
})
