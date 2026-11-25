import tap from 'bare-tap'
import os from 'bare-os'
import path from 'bare-path'
import Store from '../lib/store.ts'

const { test } = tap

test('saves and loads state, and starts empty', (t) => {
  const file = path.join(os.tmpdir(), 'ekho-test-' + Date.now(), 'state.json')
  const store = new Store(file)

  t.equal(store.load(), null)

  store.save({ irc: { nick: 'dom' } })

  t.deepStrictEqual(new Store(file).load(), { irc: { nick: 'dom' } })
})
