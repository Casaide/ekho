import tap from 'bare-tap'
import Heard from '../lib/heard.ts'
import Presence from '../lib/presence.ts'
import { clock } from './helpers.ts'

const { test } = tap

test('one person per node, with their bridged nick, IRC-only people apart, and not us', (t) => {
  const time = clock()
  const heard = new Heard({ now: time.now })
  const presence = new Presence(heard)
  presence.self = { node: '!0e8666a6', nick: 'dom' }

  presence.node({ id: '!0e8666a6', longName: 'Dom', shortName: 'DOM' })
  presence.node({ id: '!a7c3e91f', longName: 'Ivan Petrov', shortName: 'IP' })
  presence.node({ id: '!5b0d2c44', longName: 'Vitosha relay', shortName: 'VR' })
  heard.mark('!a7c3e91f')
  time.tick(60_000)
  heard.mark('!5b0d2c44')

  presence.names('#bulgaria', ['dom', 'Dom|mt', 'Ivan_Petrov|mt', 'georgi', 'sho|mc'])
  presence.joined('#sofia', 'georgi')

  const people = presence.people()

  t.deepStrictEqual(
    people.map((p) => p.name),
    // In a channel counts as seen now; then by name.
    ['georgi', 'Ivan Petrov', 'sho', 'Vitosha relay']
  )

  const ivan = people.find((p) => p.name === 'Ivan Petrov')!
  t.deepStrictEqual(ivan.nodes, [{ id: '!a7c3e91f', heard: 60_000 }])
  t.deepStrictEqual(ivan.nicks, [
    { nick: 'Ivan_Petrov|mt', network: 'meshtastic', channels: ['#bulgaria'] }
  ])

  const georgi = people.find((p) => p.name === 'georgi')!
  t.deepStrictEqual(georgi.nicks, [
    { nick: 'georgi', network: 'irc', channels: ['#bulgaria', '#sofia'] }
  ])

  t.equal(people.find((p) => p.name === 'sho')!.nicks[0].network, 'meshcore')
})

test('follows people leaving, renaming and quitting, and forgets IRC when it goes', (t) => {
  const presence = new Presence(new Heard())

  presence.names('#bulgaria', ['georgi', 'ivanp'])
  presence.renamed('georgi', 'georgi_')
  presence.parted('#bulgaria', 'ivanp')
  t.deepStrictEqual(
    presence.people().map((p) => p.name),
    ['georgi_']
  )

  presence.quit('georgi_')
  t.equal(presence.people().length, 0)

  presence.names('#bulgaria', ['georgi'])
  presence.clearIrc()
  t.equal(presence.people().length, 0)
})

test('who is in one channel, matched whatever its case', (t) => {
  const presence = new Presence(new Heard())
  presence.self = { node: null, nick: 'dom' }

  presence.names('#bulgaria', ['dom', 'georgi', 'sho|mc'])
  presence.names('#Sofia', ['georgi', 'maria'])

  t.deepStrictEqual(
    presence.inChannel('#sofia').map((p) => p.name),
    ['georgi', 'maria']
  )
  t.deepStrictEqual(
    presence.inChannel('#bulgaria').map((p) => p.name),
    ['georgi', 'sho']
  )
})
