import EventEmitter from 'bare-events'
import Devices from './devices.ts'
import type { Device, Saved } from './devices.ts'
import Hub from './hub.ts'
import type { Around } from './hub.ts'
import Mirror from './mirror.ts'
import type Messenger from './messenger.ts'
import type { LinkState } from './ui/linking.ts'

// Linking devices, as the app uses it: the P2P side (Devices), with this
// device either the hub, writing its feed and doing what linked devices ask,
// or linked, mirroring a hub's feed.
//
// Events: change, when the state shown or what's saved changed; role (role),
// when this device becomes linked or stops being; around (around), as linked,
// with what the hub sees; channel (name, join), as the hub, when a linked
// device joins or leaves an IRC channel.
export default class Linker extends EventEmitter {
  messenger: Messenger
  devices: Devices
  name: string
  hub: Hub | null
  mirror: Mirror | null
  code: string | null
  joining: boolean
  // As a linked device: connected to the phone right now.
  online: boolean
  error: string | null
  _sleep: Promise<void>

  constructor(
    messenger: Messenger,
    dir: string,
    saved: Saved | null,
    opts: { name?: string; bootstrap?: unknown[] } = {}
  ) {
    super()
    this.messenger = messenger
    this.devices = new Devices(dir, saved, { bootstrap: opts.bootstrap })
    this.name = opts.name ?? 'device'
    this.hub = null
    this.mirror = null
    this.code = null
    this.joining = false
    this.online = false
    this.error = null
    this._sleep = Promise.resolve()

    this.devices.on('change', () => this.emit('change'))
    this.devices.on('closed', () => {
      this.code = null
      this.emit('change')
    })
    // A device just linked starts from the whole state, whatever the feed
    // held before.
    this.devices.on('linked', (device: Device) => {
      this.hub?.snapshot()
      this._follow(device)
    })
  }

  get linked(): boolean {
    return this.devices.saved.hub !== null
  }

  state(): LinkState {
    return {
      role: this.linked ? 'linked' : this.devices.saved.devices.length > 0 ? 'hub' : 'alone',
      code: this.code,
      devices: this.devices.saved.devices.map((d) => d.name),
      joining: this.joining,
      online: this.online,
      error: this.error
    }
  }

  async ready(): Promise<void> {
    await this.devices.ready()
    if (this.linked) await this._mirror(true)
    else await this._hub()
  }

  open(): void {
    this.error = null
    this.code = this.devices.open()
    this.emit('change')
  }

  close(): void {
    this.devices.close()
  }

  async join(code: string): Promise<void> {
    this.joining = true
    this.error = null
    this.emit('change')
    try {
      await this.devices.join(code, this.name)
      this.hub?.close()
      this.hub = null
      await this._mirror()
      this.emit('role', 'linked')
    } catch (err) {
      this.error = 'could not link: ' + (err as Error).message
    }
    this.joining = false
    this.emit('change')
  }

  async unlink(): Promise<void> {
    this.online = false
    this.mirror?.close()
    this.mirror = null
    this.devices.unlink()
    await this._hub()
    this.emit('role', 'alone')
  }

  forget(name: string): void {
    const device = this.devices.saved.devices.find((d) => d.name === name)
    if (device !== undefined) this.devices.forget(device)
  }

  // Suspends and resumes run one after the other, never two at once.
  suspend(): Promise<void> {
    this._sleep = this._sleep.then(() => this.devices.suspend())
    return this._sleep
  }

  resume(): Promise<void> {
    this._sleep = this._sleep.then(() => this.devices.resume())
    return this._sleep
  }

  destroy(): Promise<void> {
    return this.devices.destroy()
  }

  async _hub(): Promise<void> {
    const hub = new Hub(this.messenger, this.devices.feed)
    this.hub = hub
    hub.on('done', (key: string, done: number) => {
      const device = this.devices.saved.devices.find((d) => d.swarm === key)
      if (device === undefined) return
      device.done = done
      this.emit('change')
    })
    hub.on('channel', (name: string, join: boolean) => this.emit('channel', name, join))
    await hub.ready()
    for (const device of this.devices.saved.devices) await this._follow(device)
  }

  async _follow(device: Device): Promise<void> {
    const outbox = await this.devices.outboxOf(device)
    this.hub?.follow(outbox, device.swarm, device.done)
  }

  // `catchUp`: on starting up already linked, rather than just linked, when
  // the hub has only now written its whole state.
  async _mirror(catchUp = false): Promise<void> {
    const link = this.devices.saved.hub!
    // Whether the phone is reachable: it's the only peer with its feed.
    const feed: any = this.devices.hubFeed
    const peers = () => {
      this.online = feed.peers.length > 0
      this.emit('change')
    }
    feed.on('peer-add', peers)
    feed.on('peer-remove', peers)
    const mirror = new Mirror(this.messenger, this.devices.hubFeed!, this.devices.outbox, {
      applied: link.applied
    })
    this.mirror = mirror
    mirror.on('newer', () => {
      this.error = 'your phone runs a newer ekho: update this one'
      this.emit('change')
    })
    mirror.on('synced', () => {
      link.synced = true
      this.emit('change')
    })
    mirror.on('around', (around: Around) => this.emit('around', around))
    mirror.on('whois', (nick: string, info: unknown) => this.emit('whois', nick, info))
    mirror.on('applied', (applied: number) => {
      link.applied = applied
      this.emit('change')
    })
    await mirror.update()
    // Linked by an older ekho, or before the hub wrote its whole state on
    // linking: ask for it once.
    if (catchUp && !link.synced) mirror.sync()
  }
}
