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

    step(() => {
      const central = new Central()

      central.on('error', reject)

      central.on('stateChange', (state: string) => {
        status('bluetooth ' + state)
        if (state === 'poweredOn') {
          step(() => central.startScan([meshtastic.SERVICE_UUID]))
          status('scanning for a meshtastic radio')
        }
      })

      central.on('discover', (peripheral: any) => {
        status('found ' + (peripheral.name ?? peripheral.id) + ', connecting')
        step(() => {
          central.stopScan()
          central.connect(peripheral)
        })
      })

      central.on('connect', (peripheral: any) => {
        status('connected, discovering services')

        peripheral.on('error', reject)

        peripheral.on('servicesDiscover', (services: unknown[]) => {
          if (services.length === 0) return reject(new Error('No Meshtastic service on this radio'))
          step(() => peripheral.discoverCharacteristics(services[0]))
        })

        peripheral.on('characteristicsDiscover', (_service: unknown, characteristics: any[]) => {
          status('syncing with the radio')
          step(() => {
            const find = (uuid: string) =>
              characteristics.find((c) => c.uuid.toLowerCase() === uuid)
            const fromNum = find(meshtastic.FROM_NUM_UUID)

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
