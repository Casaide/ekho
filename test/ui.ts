import tap from 'bare-tap'
import native from 'bare-native'
import Messenger from '../lib/messenger.ts'
import Irc from '../lib/irc.ts'
import Ui from '../lib/ui/index.ts'
import { addPerson } from '../lib/ui/people.ts'
import showCrash from '../lib/crash.ts'
import Link, { FatalError } from '../lib/link.ts'
import EventEmitter from 'bare-events'
import { FakeRadio, FakeStream } from './helpers.ts'

const { test } = tap
const { Window } = native

// Actions that do nothing, with any overridden.
function actions(own = {}) {
  return {
    connectRadio() {},
    disconnectRadio() {},
    connectIrc() {},
    logOutIrc() {},
    finishOnboarding() {},
    toggleChannel() {},
    openLink() {},
    closeLink() {},
    joinLink() {},
    unlink() {},
    forgetDevice() {},
    ...own
  }
}

// Renders on the real bare-native, which throws on any style a node doesn't
// accept, so this catches layout mistakes before they crash the app.
test('every screen renders: chats, thread, contact info, join, compact', (t) => {
  const messenger = new Messenger({ ircChannel: '#sofia' })
  const ui = new Ui(messenger, actions(), { compact: true })

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  const radio = new FakeRadio()
  messenger.setRadio(radio as never)
  const stream = new FakeStream()
  messenger.setIrc(new Irc(stream as never, { nick: 'dom' }))
  stream.serve(':irc.motaba.net 001 dom :Welcome\r\n')

  radio.emit('message', {
    from: '!a1b2c3d4',
    name: 'ivan',
    text: 'hello',
    snr: 1,
    rssi: -90,
    hops: 2,
    direct: true
  })
  stream.serve(':georgi!u@host PRIVMSG dom :over irc\r\n')

  const [ivan, georgi] = messenger.contacts.all().filter((c) => !c.channel)

  ui.select(ivan)
  messenger.send(ivan, 'reply')
  radio.emit('ack', { id: radio.sent[0].opts.id, delivered: false, reason: 'MAX_RETRANSMIT' })

  ui.toggleInfo()
  ui.render()
  messenger.rename(ivan, 'Ivan P')
  messenger.join(ivan, georgi)
  ui.toggleInfo()

  // Every tab, then side by side, then with the contact beside.
  ui.open('contacts')
  ui.open('radio')
  ui.open('setup')
  ui.back()
  ui.open('chats')
  ui.setWidth(900)
  ui.select(ivan)
  ui.setWidth(1200)
  ui.select(null)

  t.equal(messenger.contacts.get(ivan.id)!.alias, 'Ivan P')
  t.equal(messenger.contacts.get(georgi.id), null)
})

test('errors show as a banner, NickServ notices show, and the log copies', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions())

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  ui.setIrcNotice('You are now logged in as dom')
  ui.setChannels(
    [
      { name: '#bulgaria', users: 140, topic: '' },
      { name: '#sofia', users: 12, topic: 'Sofia mesh' },
      { name: '#varna', users: 3, topic: '' }
    ],
    ['#sofia'],
    '#bulgaria'
  )
  ui.showError('Error: boom')
  ui.hideError()
  ui.showError('Error: again')

  ui.log.warn('something odd')
  ui.show('radio')
  ui.show('log')
  ui.log.error('while the log is open')
  ui.copyLog()
  ui.show('chats')

  t.equal(ui.log.entries.at(-1)!.text, 'log copied to the clipboard')
})

test('the crash screen renders an error', (t) => {
  const window = showCrash('Error: boom')
  t.teardown(() => window.hide())
  t.ok(window.contentView)
})

test('first run opens on onboarding, then chats; the radio tab and setup follow', (t) => {
  let finished = false
  const ui = new Ui(
    new Messenger(),
    actions({
      finishOnboarding() {
        finished = true
      }
    }),
    { onboarded: false }
  )

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  t.equal(ui.page, 'onboarding')
  ui.show('log')
  ui.back()
  t.equal(ui.page, 'onboarding', 'the log closes back to onboarding')
  ui.finishOnboarding()
  t.ok(finished)
  t.equal(ui.page, 'chats')
  ui.show('radio')
  t.equal(ui.page, 'radio')
  ui.open('setup')
  ui.back()
  t.equal(ui.page, 'radio', 'setup goes back to the radio tab')
  ui.show('chats')
})

test('the radio and IRC sections follow their links through every state', async (t) => {
  const pending: {
    detail: (text: string) => void
    resolve: (c: unknown) => void
    reject: (e: Error) => void
  }[] = []
  const connect = (detail: (text: string) => void) =>
    new Promise<any>((resolve, reject) => pending.push({ detail, resolve, reject }))
  const radio = new Link('radio', connect)
  const irc = new Link('irc', connect, { retry: [10] })

  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { radio, irc })

  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => {
    radio.stop()
    irc.stop()
    window.hide()
  })
  ui.show('radio')

  radio.start()
  pending[0].detail('syncing: 37 nodes so far')
  pending[0].reject(new FatalError('turn Bluetooth on, then connect'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  t.equal(radio.state, 'failed')

  irc.start()
  const connection = new EventEmitter() as EventEmitter & { close(): void }
  connection.close = () => {}
  pending[1].resolve(connection)
  await new Promise((resolve) => setTimeout(resolve, 0))
  t.equal(irc.state, 'on')

  connection.emit('close')
  t.equal(irc.state, 'waiting')

  irc.pause()
  t.equal(irc.detail, 'paused')
  ui.show('chats')
})

test('a conversation is read once open, and the chats tab counts what is not', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { compact: true })
  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  const radio = new FakeRadio()
  messenger.setRadio(radio as never)
  const hello = { from: '!a1b2c3d4', name: 'ivan', snr: 1, rssi: -90, hops: 0, direct: true }
  radio.emit('message', { ...hello, text: 'one' })
  radio.emit('message', { ...hello, text: 'two' })
  const ivan = messenger.contacts.byNode('!a1b2c3d4')!
  t.equal(messenger.unread(ivan), 2)

  ui.select(ivan)
  t.equal(messenger.unread(ivan), 0)

  // Arriving while open: read straight away.
  radio.emit('message', { ...hello, text: 'three' })
  t.equal(messenger.unread(ivan), 0)

  ui.back()
  radio.emit('message', { ...hello, text: 'four' })
  t.equal(messenger.unread(ivan), 1)
})

test('contacts shows who is around on every transport, and tapping makes a contact', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { compact: true })
  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  ui.presence.node({ id: '!a7c3e91f', longName: 'Ivan Petrov', shortName: 'IP' })
  messenger.heard.mark('!a7c3e91f')
  ui.presence.names('#bulgaria', ['Ivan_Petrov|mt', 'georgi'])
  ui.open('contacts')

  const people = ui.presence.people()
  t.deepStrictEqual(
    people.map((p) => p.name),
    ['georgi', 'Ivan Petrov']
  )
  ui.select(addPerson(ui, people[1]))
  const ivan = messenger.contacts.byNode('!a7c3e91f')!
  t.deepStrictEqual(ivan.nicks, ['Ivan_Petrov|mt'])
  t.equal(ui.page, 'thread')
})

test('swiping right goes back: to the list from a conversation, to chats from a tab', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { compact: true })
  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  ui.open('radio')
  ui.open('setup')
  ui.swipeBack()
  t.equal(ui.page, 'radio')
  ui.swipeBack()
  t.equal(ui.page, 'chats')

  ui.select(messenger.channel)
  ui.swipeBack()
  t.equal(ui.page, 'chats')
})

test('a channel opens from contacts, joining it first if need be', (t) => {
  const messenger = new Messenger({ ircChannel: '#bulgaria' })
  const joined: string[] = []
  const ui = new Ui(
    messenger,
    actions({
      toggleChannel(name: string) {
        joined.push(name)
        messenger.addChannel(name)
      }
    }),
    { compact: true }
  )
  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  ui.setChannels(
    [
      { name: '#bulgaria', users: 146, topic: '' },
      { name: '#sofia', users: 31, topic: '' }
    ],
    [],
    '#bulgaria'
  )
  t.deepStrictEqual(ui.channels(), [
    { name: '#bulgaria', users: 146, joined: true },
    { name: '#sofia', users: 31, joined: false }
  ])

  ui.openChannel('#sofia')
  t.deepStrictEqual(joined, ['#sofia'])
  t.equal(ui.selected!.id, '#sofia')
  t.equal(ui.page, 'thread')

  ui.openChannel('#bulgaria')
  t.deepStrictEqual(joined, ['#sofia'], 'the mesh channel is joined already')
})

test("a failed message's details offer a retry, which puts them away", (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { compact: true })
  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  const radio = new FakeRadio()
  messenger.setRadio(radio as never)
  radio.emit('message', {
    from: '!a1b2c3d4',
    name: 'ivan',
    text: 'hi',
    snr: 1,
    rssi: -90,
    hops: 0,
    direct: true
  })
  const ivan = messenger.contacts.byNode('!a1b2c3d4')!
  ui.select(ivan)

  const msg = messenger.send(ivan, 'hello')
  radio.emit('ack', { id: radio.sent.at(-1)!.opts.id, delivered: false, reason: 'MAX_RETRANSMIT' })
  t.equal(msg.state, 'failed')

  ui._thread._toggle(msg)
  t.equal(ui._thread._open, msg)
  ui._thread._act(() => messenger.retry(msg))
  t.equal(ui._thread._open, null)
  t.equal(msg.state, 'sending')
})

test('back goes to the screen below, or to chats, and says when there is nowhere left', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { compact: true })
  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  ui.open('radio')
  ui.open('log')
  t.ok(ui.goBack())
  t.equal(ui.page, 'radio')
  t.ok(ui.goBack())
  t.equal(ui.page, 'chats')
  t.notOk(ui.goBack(), 'from chats, Android may leave the app')
})

test('any emoji reacts to a received message, and the conversation can say which is open', (t) => {
  const messenger = new Messenger()
  const ui = new Ui(messenger, actions(), { compact: true })
  const window = new Window(380, 800)
  window.content(ui.root)
  window.show()
  t.teardown(() => window.hide())

  const selected: unknown[] = []
  ui.on('select', (contact: unknown) => selected.push(contact))

  const radio = new FakeRadio()
  messenger.setRadio(radio as never)
  radio.emit('message', {
    from: '!a1b2c3d4',
    name: 'ivan',
    text: 'hi',
    snr: 1,
    rssi: -90,
    hops: 0,
    direct: true
  })
  const ivan = messenger.contacts.byNode('!a1b2c3d4')!
  ui.select(ivan)
  t.deepStrictEqual(selected, [ivan])

  const [received] = messenger.thread(ivan)
  ui._thread._toggle(received)
  ui._thread._act(() => messenger.react(received, '🔥'))
  t.equal(radio.sent.at(-1)!.text, '"hi" 🔥')
})

test('linking: the phone shows a code, another device types one in', (t) => {
  const messenger = new Messenger({ ircChannel: '#bulgaria' })
  const asked: string[] = []
  const ui = new Ui(
    messenger,
    actions({
      openLink: () => asked.push('open'),
      joinLink: (code: string) => asked.push('join ' + code)
    }),
    { compact: true }
  )
  const window = new Window(380, 800)
  window.content(ui.root)
  ui.open('radio')

  ui.setLinking({ ...ui.linking, role: 'hub', code: 'abcde-fghjk', devices: ['mac'] })
  ui.render()
  ui.setLinking({ ...ui.linking, role: 'alone', code: null, devices: [] })
  ui.render()

  ui.linkCard._code.value = 'ABCDE FGHJK'
  ui.linkCard._join()
  t.deepStrictEqual(asked, ['join abcdefghjk'])

  ui.linkCard._code.value = 'nope'
  ui.linkCard._join()
  t.equal(ui.linking.error, 'a code is ten letters and numbers')

  ui.setLinking({ ...ui.linking, role: 'linked', error: null })
  ui.render()
})
