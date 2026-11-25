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
export default function connectRadio(): Promise<{ client: Radio; disconnect: () => void }> {
  return new Promise((resolve, reject) => {
    const central = new Central()

    central.on('error', reject)

    central.on('stateChange', (state: string) => {
      if (state === 'poweredOn') central.startScan([meshtastic.SERVICE_UUID])
    })

    central.on('discover', (peripheral: unknown) => {
      central.stopScan()
      central.connect(peripheral)
    })

    central.on('connect', (peripheral: any) => {
      peripheral.on('servicesDiscover', (services: unknown[]) => {
        peripheral.discoverCharacteristics(services[0])
      })

      peripheral.on('characteristicsDiscover', (_service: unknown, characteristics: any[]) => {
        const find = (uuid: string) => characteristics.find((c) => c.uuid.toLowerCase() === uuid)
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

      peripheral.discoverServices([meshtastic.SERVICE_UUID])
    })
  })
}
