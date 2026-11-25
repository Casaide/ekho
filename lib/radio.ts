import bluetooth from 'bare-bluetooth'
import meshtastic from 'bare-meshtastic'
import type { Radio } from './types.ts'

const { Central } = bluetooth
const { Client, Mailbox } = meshtastic

// Meshtastic asks clients for an MTU of 512, so a whole packet fits in one
// read. Android starts at 23 and reads come back cut short without it; Apple
// negotiates on its own, and `requestMtu` is a no-op there.
const MTU = 512

// Say so when no radio turns up for this long: one paired with another phone
// doesn't advertise.
const HINT_AFTER = 20_000

// Scan for the first Meshtastic radio over Bluetooth, connect, and resolve
// with a bare-meshtastic Client once its node database has synced. Follows
// the BLE example in the bare-meshtastic README, plus what it leaves out:
// picking the Meshtastic service by UUID (Android lists them all), and the
// MTU.
//
// Any failure rejects once and hangs up: the radio is disconnected and the
// scan stopped, so it advertises again and the next attempt can find it.
// Android calls throw when they fail outright (no permission, Bluetooth off);
// those reject the same way. `onstatus` hears each step.
//
// The T1000-E pairs with one device at a time, so the Meshtastic app must be
// disconnected from it first.
export default function connectRadio(
  opts: { onstatus?: (status: string) => void } = {}
): Promise<{ client: Radio; disconnect: () => void }> {
  const status = opts.onstatus ?? (() => {})

  return new Promise((resolve, reject) => {
    let central: any = null
    let peripheral: any = null
    let found = false
    let client: any = null
    let hint: ReturnType<typeof setTimeout> | null = null
    let settled = false

    const disconnect = () => {
      if (hint !== null) clearTimeout(hint)
      hint = null
      if (client !== null) client.destroy()
      else if (peripheral !== null) central.disconnect(peripheral)
      if (central !== null) {
        central.stopScan()
        central.destroy()
      }
    }

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      try {
        disconnect()
      } catch {
        // Hanging up after a failure can fail too; the first error is the one
        // to report.
      }
      reject(err)
    }

    const step = (fn: () => void) => {
      try {
        fn()
      } catch (err) {
        fail(err as Error)
      }
    }

    step(() => {
      central = new Central()

      central.on('error', fail)

      central.on('stateChange', (state: string) => {
        status('bluetooth ' + state)
        if (state !== 'poweredOn' || settled) return
        step(() => central.startScan([meshtastic.SERVICE_UUID]))
        status('scanning for a meshtastic radio')
        hint = setTimeout(
          () => status('still looking: is the radio on, and disconnected from the Meshtastic app?'),
          HINT_AFTER
        )
      })

      // A radio is often reported more than once as the scan stops; connecting
      // twice fails on Android with GATT error 133.
      central.on('discover', (discovered: any) => {
        if (found || settled) return
        found = true
        clearTimeout(hint!)
        hint = null
        status('found ' + (discovered.name ?? discovered.id) + ', connecting')
        step(() => {
          central.stopScan()
          central.connect(discovered)
        })
      })

      central.on('connect', (connected: any) => {
        peripheral = connected
        status('connected, discovering services')

        peripheral.on('error', fail)
        peripheral.on('disconnect', () => fail(new Error('The radio disconnected')))
        peripheral.on('mtuChanged', (mtu: number) => status('packet size ' + mtu))

        let service: any = null

        peripheral.on('servicesDiscover', (services: any[]) => {
          service = services.find((s) => same(s.uuid, meshtastic.SERVICE_UUID)) ?? null
          if (service === null) {
            const list = services.map((s) => s.uuid).join(', ') || 'none'
            return fail(new Error('No Meshtastic service on this radio. Services: ' + list))
          }
          step(() => peripheral.discoverCharacteristics(service))
        })

        peripheral.on('characteristicsDiscover', (from: any, characteristics: any[]) => {
          if (from !== null && service !== null && !same(from.uuid, service.uuid)) return

          step(() => {
            const find = (uuid: string) => characteristics.find((c) => same(c.uuid, uuid))
            const toRadio = find(meshtastic.TO_RADIO_UUID)
            const fromRadio = find(meshtastic.FROM_RADIO_UUID)
            const fromNum = find(meshtastic.FROM_NUM_UUID)

            if (!toRadio || !fromRadio || !fromNum) {
              const list = characteristics.map((c) => c.uuid).join(', ') || 'none'
              throw new Error('Meshtastic characteristics missing. Found: ' + list)
            }

            // Queued in order by bare-bluetooth: the MTU first, then the
            // subscription, then the config request the sync writes.
            peripheral.requestMtu(MTU)

            const mailbox = new Mailbox(
              peripheral,
              { toRadio, fromRadio, fromNum },
              { close: () => central.disconnect(peripheral) }
            )

            client = new Client(mailbox)

            client.once('ready', () => {
              if (settled) return
              settled = true
              status('synced')
              resolve({ client, disconnect })
            })
            client.on('error', fail)

            status('syncing with the radio')

            // On iOS, subscribing is what triggers pairing.
            peripheral.subscribe(fromNum)
            client.sync()
          })
        })

        step(() => peripheral.discoverServices([meshtastic.SERVICE_UUID]))
      })
    })
  })
}

// UUIDs compare without case, whichever way the platform writes them.
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
