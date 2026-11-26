import tap from 'bare-tap'
import os from 'bare-os'
import path from 'bare-path'
import createTestnet from 'hyperdht/testnet'
import Irc from '../lib/irc.ts'
import Messenger from '../lib/messenger.ts'
import Linker from '../lib/linker.ts'
import { FakeStream } from './helpers.ts'

const { test } = tap

// Wait for a condition, checking every 100 ms, for up to `ms`.
async function until(check: () => boolean, ms = 30_000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return check()
}

function dir(name: string): string {
  return path.join(os.tmpdir(), 'ekho-test-' + name + '-' + Math.random().toString(16).slice(2))
}

// Over a local DHT: the phone shows a code, the Mac types it, and then sees
// the phone's messages and sends through it.
test('a Mac links to the phone by code, mirrors it, and sends through it', async (t) => {
  const testnet = await createTestnet(3)
  const { bootstrap } = testnet

  const stream = new FakeStream()
  const phoneMessenger = new Messenger({ ircChannel: '#bulgaria' })
  phoneMessenger.setIrc(new Irc(stream as never, { nick: 'dom' }))
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')
  stream.serve(':georgi!u@h PRIVMSG dom :are you up?\r\n')

  const phone = new Linker(phoneMessenger, dir('phone'), null, { name: 'phone', bootstrap })
  const macMessenger = new Messenger({ ircChannel: '#bulgaria' })
  const mac = new Linker(macMessenger, dir('mac'), null, { name: 'mac', bootstrap })

  t.teardown(async () => {
    await mac.destroy()
    await phone.destroy()
    await testnet.destroy()
  })

  await phone.ready()
  await mac.ready()

  phone.open()
  t.ok(phone.code, 'a code to type')
  await mac.join(phone.code!.replace('-', ''))
  t.equal(mac.error, null)
  t.ok(mac.linked, 'linked')
  t.deepStrictEqual(phone.state().devices, ['mac'])

  const mirrored = await until(() => macMessenger.contacts.byNick('georgi') !== null)
  t.ok(mirrored, 'the phone’s conversation reached the Mac')

  const georgi = macMessenger.contacts.byNick('georgi')!
  stream.lines.length = 0
  macMessenger.send(georgi, 'on my way')
  const sent = await until(() => stream.lines.includes('PRIVMSG georgi :on my way'))
  t.ok(sent, 'sent out the phone’s IRC')
})
