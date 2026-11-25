import bluetooth from 'bare-bluetooth'
import meshtastic from 'bare-meshtastic'
import type { Radio } from './types.ts'

const { Central } = bluetooth
const { Client, Mailbox } = meshtastic

// Scan for the first Meshtastic radio over Bluetooth, connect, and resolve
// with a bare-meshtastic Client once its node database has synced. Follows
// the BLE example in the bare-meshtastic README.
//
// The T1000-E pairs with one device at a time, so the Meshtastic app must be
// disconnected from it first.
//
// Android calls throw when they fail outright (no permission, Bluetooth off);
// those reject the promise like any later failure. `onstatus` hears each step.
export default function connectRadio(
  opts: { onstatus?: (status: string) => void } = {}
): Promise<{ client: Radio; disconnect: () => void }> {
  const status = opts.onstatus ?? (() => {})

  return new Promise((resolve, reject) => {
    const step = (fn: () => void) => {
      try {
        fn()
      } catch (err) {
        reject(err)
      }
    }

    let hint: ReturnType<typeof setTimeout> | null = null

    step(() => {
      const central = new Central()

      central.on('error', reject)

      central.on('stateChange', (state: string) => {
        status('bluetooth ' + state)
        if (state === 'poweredOn') {
          step(() => central.startScan([meshtastic.SERVICE_UUID]))
          status('scanning for a meshtastic radio')
          // A radio paired with another phone doesn't advertise, so say so.
          hint = setTimeout(
            () =>
              status('still looking: is the radio on, and disconnected from the Meshtastic app?'),
            20_000
          )
        }
      })

      central.on('discover', (peripheral: any) => {
        clearTimeout(hint!)
        status('found ' + (peripheral.name ?? peripheral.id) + ', connecting')
        step(() => {
          central.stopScan()
          central.connect(peripheral)
        })
      })

      central.on('connect', (peripheral: any) => {
        status('connected, discovering services')

        peripheral.on('error', reject)

        // Android lists every service on the radio, not just the one asked for.
        let service: any = null

        peripheral.on('servicesDiscover', (services: any[]) => {
          service = services.find((s) => same(s.uuid, meshtastic.SERVICE_UUID)) ?? null
          if (service === null) {
            const found = services.map((s) => s.uuid).join(', ') || 'none'
            return reject(new Error('No Meshtastic service on this radio. Services: ' + found))
          }
          step(() => peripheral.discoverCharacteristics(service))
        })

        peripheral.on('characteristicsDiscover', (from: any, characteristics: any[]) => {
          if (from !== null && service !== null && !same(from.uuid, service.uuid)) return
          status('syncing with the radio')
          step(() => {
            const find = (uuid: string) => characteristics.find((c) => same(c.uuid, uuid))
            const fromNum = find(meshtastic.FROM_NUM_UUID)

            if (!find(meshtastic.TO_RADIO_UUID) || !find(meshtastic.FROM_RADIO_UUID) || !fromNum) {
              const found = characteristics.map((c) => c.uuid).join(', ') || 'none'
              throw new Error('Meshtastic characteristics missing. Found: ' + found)
            }

            const disconnect = () => central.disconnect(peripheral)

            const mailbox = new Mailbox(
              peripheral,
              {
                toRadio: find(meshtastic.TO_RADIO_UUID),
                fromRadio: find(meshtastic.FROM_RADIO_UUID),
                fromNum
              },
              { close: disconnect }
            )

            const client = new Client(mailbox)

            client.once('ready', () => resolve({ client, disconnect }))
            client.once('error', reject)

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
