import EventEmitter from 'bare-events'
import b4a from 'b4a'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import BlindPairing from 'blind-pairing'
import crypto from 'hypercore-crypto'
import { format, parse } from './code.ts'
import type { Entry } from './hub.ts'
import type { Log } from './mirror.ts'
import type { Command } from './types.ts'

// A core someone else writes, as this device reads it: its key and its
// block encryption key, hex.
export interface Remote {
  key: string
  encryption: string
}

// A device linked to this one, as the hub keeps it.
export interface Device {
  name: string
  outbox: Remote
  // Its swarm key, hex: only it is replicated with.
  swarm: string
  // How far its outbox has been done.
  done: number
}

// What's kept between runs. Keys are hex.
export interface Saved {
  // Bumped when what's saved, or the cores it names, change shape: an older
  // one is dropped and devices link again.
  version: number
  // This device's swarm key pair comes from this.
  seed: string
  // Block encryption keys for this device's own feed and outbox.
  feed: string
  outbox: string
  // As the hub: the devices linked to this one.
  devices: Device[]
  // As a linked device: the hub's feed, and how far it's applied.
  hub: (Remote & { applied: number }) | null
}

// 2: cores encrypted; 1 had them in the clear.
const VERSION = 2

// What a linking request may carry: names, keys, nothing big. Checked before
// it's parsed, as anyone holding the code can send one.
const REQUEST_MAX = 1024

// How long a linking code works for.
const OPEN = 10 * 60 * 1000

// The P2P side of linking devices: a Corestore with this device's feed and
// outbox, a Hyperswarm to reach the others, and blind-pairing to link one by
// a short code. The code keys the pairing on both sides, so the other device
// rebuilds the invite from the code alone: the invite's seed comes from it,
// and so does the key it's for, which isn't the feed's (blind-pairing wants
// the discovery key to be the key's). The feed's key goes back to the linked
// device in the answer's signed additional data, with its block encryption
// key: the answer is sealed to the requester, so only it can read them.
//
// Every core is block encrypted: blocks are stored and sent encrypted, and a
// peer, mirror or blind peer without the key sees only ciphertext. The keys
// sit in the app's own storage, with the cores.
//
// Events: linked (device), as the hub; closed, when a code stops working;
// change, when what's saved changed.
export default class Devices extends EventEmitter {
  saved: Saved
  store: any
  swarm: any
  pairing: any
  feed: Log<Entry> & { key: Uint8Array; discoveryKey: Uint8Array }
  outbox: Log<Command> & { key: Uint8Array }
  // The hub's feed, once linked to one and ready.
  hubFeed: Log<Entry> | null

  _member: any
  _expiry: ReturnType<typeof setTimeout> | null
  _replicating: WeakSet<object>

  // `bootstrap`: DHT nodes to use instead of the public ones, for tests.
  constructor(dir: string, saved: Saved | null = null, opts: { bootstrap?: unknown[] } = {}) {
    super()
    this.saved = saved !== null && saved.version === VERSION ? saved : fresh()
    this.store = new Corestore(dir)
    this.swarm = new Hyperswarm({
      keyPair: crypto.keyPair(b4a.from(this.saved.seed, 'hex')),
      bootstrap: opts.bootstrap
    })
    // Poll often: someone is waiting, code in hand.
    this.pairing = new BlindPairing(this.swarm, { poll: 5000 })
    // Named for the version: version 1's cores were in the clear.
    this.feed = this.store.get({
      name: 'feed-' + VERSION,
      valueEncoding: 'json',
      encryption: { key: b4a.from(this.saved.feed, 'hex') }
    })
    this.outbox = this.store.get({
      name: 'outbox-' + VERSION,
      valueEncoding: 'json',
      encryption: { key: b4a.from(this.saved.outbox, 'hex') }
    })

    this.hubFeed = null
    this._member = null
    this._expiry = null
    this._replicating = new WeakSet()

    // Replicate with devices we know, and the hub; pairing has its own
    // channel on the same connections.
    this.swarm.on('connection', (conn: any) => {
      // A peer dropping is ordinary: without a listener, its error would be
      // thrown, and every connection gets one, replicated or not.
      conn.on('error', noop)
      this._replicate(conn)
    })
  }

  async ready(): Promise<void> {
    await this.feed.ready()
    await this.outbox.ready()
    if (this.saved.devices.length > 0) this.swarm.join(this.feed.discoveryKey)
    if (this.saved.hub !== null) await this._follow()
  }

  // As the hub: a code for another device to type, open for ten minutes.
  open(): string {
    this.close()

    const code = format(crypto.randomBytes(10))
    const { seed, key } = keys(parse(code)!)
    const feed = { key: b4a.toString(this.feed.key, 'hex'), encryption: this.saved.feed }
    const { publicKey, discoveryKey, additional } = BlindPairing.createInvite(key, {
      seed,
      data: b4a.from(JSON.stringify(feed))
    })

    this._member = this.pairing.addMember({
      discoveryKey,
      onadd: (candidate: any) => {
        candidate.open(publicKey)
        const asked = request(candidate.userData)
        if (asked === null) return candidate.deny()
        candidate.confirm({ key, additional })

        const device: Device = { ...asked, done: 0 }
        this.saved.devices = [...this.saved.devices.filter((d) => d.swarm !== device.swarm), device]
        this.swarm.join(this.feed.discoveryKey)
        this._replicateAll()
        // Once the answer is on its way: it goes out after this returns.
        setTimeout(() => this.close(), 2000)
        this.emit('change')
        this.emit('linked', device)
      }
    })
    this._expiry = setTimeout(() => this.close(), OPEN)
    return code
  }

  // Resolves once an open code can be found by the other device.
  announced(): Promise<void> {
    return this._member === null ? Promise.resolve() : this._member.flushed()
  }

  // Stop accepting a code.
  close(): void {
    if (this._expiry !== null) clearTimeout(this._expiry)
    this._expiry = null
    if (this._member === null) return
    this._member.close()
    this._member = null
    this.emit('closed')
  }

  // As a linked device: use a hub's code. Resolves once linked.
  // `code` as parse() gives it.
  async join(code: string, name: string): Promise<void> {
    const { seed, key } = keys(code)
    const { invite } = BlindPairing.createInvite(key, { seed })
    const userData = b4a.from(
      JSON.stringify({
        name: name.slice(0, 40),
        outbox: { key: b4a.toString(this.outbox.key, 'hex'), encryption: this.saved.outbox },
        swarm: b4a.toString(this.swarm.keyPair.publicKey, 'hex')
      })
    )

    const result = await new Promise<any>((resolve) => {
      this.pairing.addCandidate({ invite, userData, onadd: resolve })
    })
    // Signed with the invite's key, which only the code gives: blind-pairing
    // checks that before this.
    const feed = JSON.parse(b4a.toString(result.data))

    this.saved.hub = { key: feed.key, encryption: feed.encryption, applied: 0 }
    this.emit('change')
    this._replicateAll()
    await this._follow()
  }

  // A linked device's outbox, as the hub reads it.
  async outboxOf(device: Device): Promise<Log<Command>> {
    const core = this.store.get(open(device.outbox))
    await core.ready()
    core.download({ start: 0, end: -1 })
    return core
  }

  forget(device: Device): void {
    this.saved.devices = this.saved.devices.filter((d) => d !== device)
    this.emit('change')
  }

  unlink(): void {
    if (this.saved.hub !== null) {
      this.swarm.leave(crypto.discoveryKey(b4a.from(this.saved.hub.key, 'hex')))
    }
    this.saved.hub = null
    this.hubFeed = null
    this.emit('change')
  }

  async destroy(): Promise<void> {
    this.close()
    await this.pairing.close()
    await this.swarm.destroy()
    await this.store.close()
  }

  async _follow(): Promise<void> {
    const feed = this.store.get(open(this.saved.hub!))
    await feed.ready()
    feed.download({ start: 0, end: -1 })
    this.swarm.join(feed.discoveryKey)
    this.hubFeed = feed
  }

  _replicate(conn: any): void {
    if (this._replicating.has(conn) || !this._known(conn.remotePublicKey)) return
    this._replicating.add(conn)
    this.store.replicate(conn)
  }

  // Connections opened before a link was made, such as the pairing's own.
  _replicateAll(): void {
    for (const conn of this.swarm.connections) this._replicate(conn)
  }

  _known(key: Uint8Array): boolean {
    const hex = b4a.toString(key, 'hex')
    // A linked device connects to its hub without knowing the hub's swarm
    // key, so it replicates with whoever is on the hub's topic: they can only
    // read cores whose keys they hold.
    return this.saved.hub !== null || this.saved.devices.some((d) => d.swarm === hex)
  }
}

// What a code keys: the invite's seed, and the key the invite is for, whose
// discovery key both sides look for each other on.
function keys(code: string): { seed: Uint8Array; key: Uint8Array } {
  return {
    seed: crypto.hash(b4a.from('ekho link seed ' + code)),
    key: crypto.hash(b4a.from('ekho link key ' + code))
  }
}

function fresh(): Saved {
  const random = () => b4a.toString(crypto.randomBytes(32), 'hex')
  return {
    version: VERSION,
    seed: random(),
    feed: random(),
    outbox: random(),
    devices: [],
    hub: null
  }
}

// Options to open a core someone else writes.
function open(remote: Remote): object {
  return {
    key: b4a.from(remote.key, 'hex'),
    valueEncoding: 'json',
    encryption: { key: b4a.from(remote.encryption, 'hex') }
  }
}

// A linking request's user data, or null if it isn't one: too big, not
// JSON, or not the fields a request has. From the network, so checked.
function request(data: Uint8Array): Omit<Device, 'done'> | null {
  if (data.byteLength > REQUEST_MAX) return null
  let asked: any
  try {
    asked = JSON.parse(b4a.toString(data))
  } catch {
    return null
  }
  const hex = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
  if (typeof asked?.name !== 'string' || asked.name.length > 40) return null
  if (!hex(asked.swarm) || !hex(asked.outbox?.key) || !hex(asked.outbox?.encryption)) return null
  return {
    name: asked.name,
    swarm: asked.swarm,
    outbox: { key: asked.outbox.key, encryption: asked.outbox.encryption }
  }
}

function noop() {}
