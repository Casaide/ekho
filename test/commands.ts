import tap from 'bare-tap'
import { command, completions, literal } from '../lib/commands.ts'

const { test } = tap

test('commands are read from what is typed', (t) => {
  t.deepStrictEqual(command('/whois mirco'), { name: 'whois', nick: 'mirco' })
  t.deepStrictEqual(command('/me waves at the hut'), { name: 'me', text: 'waves at the hut' })
  t.deepStrictEqual(command('/msg Dom|mt are you up?'), {
    name: 'msg',
    nick: 'Dom|mt',
    text: 'are you up?'
  })
  t.deepStrictEqual(command('/join sofia'), { name: 'join', channel: '#sofia' })
  t.deepStrictEqual(command('/part'), { name: 'part', channel: null })
  t.deepStrictEqual(command('/PART #varna'), { name: 'part', channel: '#varna' })
})

test('a command missing what it needs says how to use it; an unknown one is named', (t) => {
  t.deepStrictEqual(command('/whois'), { name: 'usage', usage: '/whois nick' })
  t.deepStrictEqual(command('/msg mirco'), { name: 'usage', usage: '/msg nick text' })
  t.deepStrictEqual(command('/kick mirco'), { name: 'unknown', command: '/kick' })
})

test('anything else is a message, and // sends a slash', (t) => {
  t.equal(command('hello /whois'), null)
  t.equal(command('//shrug'), null)
  t.equal(literal('//shrug'), '/shrug')
  t.equal(literal('hello'), 'hello')
})

test('a command completes: its name, then a nick or a channel', (t) => {
  const opts = { nicks: ['mirco', 'Dom|mt', 'mira'], channels: ['#sofia', '#bulgaria'] }
  t.deepStrictEqual(completions('/', opts), ['/whois', '/me', '/msg', '/join', '/part'])
  t.deepStrictEqual(completions('/m', opts), ['/me', '/msg'])
  t.deepStrictEqual(completions('/whois mi', opts), ['/whois mirco', '/whois mira'])
  t.deepStrictEqual(completions('/join #s', opts), ['/join #sofia'])
  t.deepStrictEqual(completions('/msg mirco hi', opts), [], 'only the first word after it')
  t.deepStrictEqual(completions('hello', opts), [])
})
