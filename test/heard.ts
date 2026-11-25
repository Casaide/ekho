import tap from 'bare-tap'
import Heard from '../lib/heard.ts'
import { clock } from './helpers.ts'

const { test } = tap

test('a node heard inside the window counts', (t) => {
  const c = clock()
  const heard = new Heard({ window: 60_000, now: c.now })

  t.equal(heard.any(), false, 'nothing heard yet')

  heard.mark('!a7c3e91f')
  c.tick(30_000)

  t.equal(heard.recent('!a7c3e91f'), true)
  t.equal(heard.count(), 1)
  t.equal(heard.any(), true)
})

test('a node drops out once the window passes', (t) => {
  const c = clock()
  const heard = new Heard({ window: 60_000, now: c.now })

  heard.mark('!a7c3e91f')
  c.tick(60_001)

  t.equal(heard.recent('!a7c3e91f'), false)
  t.equal(heard.any(), false)
  t.equal(heard.since('!5d02b7aa'), Infinity, 'never heard')
})
