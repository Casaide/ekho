# ekho

Off-grid messenger for Meshtastic: LoRa first through your own radio, IRC when no nodes are in range. One thread per person, whichever path carried each message.

> [!IMPORTANT]
> First attempt. The core logic is tested; the radio link and the UI have not yet run on a device.

## How it works

- Pair ekho with a Meshtastic radio such as a T1000-E, over Bluetooth on a phone or USB on a computer. The radio holds your node ID and keys.
- If any node was heard recently, messages go over LoRa, with delivery receipts and retry.
- If none was heard, messages go over IRC on `irc.motaba.net:6697`, which bridges into the mesh.
- People you message don't need ekho.

The design and the plan are in [`docs/design.md`](docs/design.md) and [`docs/plan.md`](docs/plan.md).

## Installation

```
npm install
```

## Usage

Build and run the app with the bare-native runtime:

```
npm start -- --host darwin-arm64
```

The core runs without any UI:

```js
import { Messenger, Irc } from 'ekho'

const messenger = new Messenger({ ircChannel: '#mesh' })

messenger.setRadio(client) // a bare-meshtastic Client
messenger.setIrc(irc) // an Irc over a TLS socket

const ivan = messenger.contacts.add({ name: 'ivan', node: '!a7c3e91f', nick: 'ivanp' })

const msg = messenger.send(ivan, 'take the spare cable')
messenger.on('update', (m) => console.log(m.via, m.state))
```

## API

#### `const messenger = new Messenger([options])`

Options:

```js
{
  ;(contacts, // a Contacts instance
    heard, // a Heard instance, which sets the "recently heard" window
    node, // our own node ID, added to IRC messages
    channelName, // name of the mesh channel thread, default 'mesh'
    ircChannel) // the IRC channel the bridge mirrors the mesh channel to
}
```

#### `messenger.setRadio(client)`, `messenger.setIrc(irc)`

Attach the radio and the IRC client as each one connects.

#### `messenger.route()`

`'lora'` if any node was heard inside the window, otherwise `'irc'`.

#### `const msg = messenger.send(contact, text[, { via }])`

Send a message by the current route, or by `via`. `msg.state` moves through `sending`, then `delivered` or `failed` on LoRa, or `sent` on IRC and on channels.

#### `messenger.retry(msg)`, `messenger.sendViaIrc(msg)`

For a failed message: try LoRa again, or send it over IRC instead.

#### `messenger.thread(contact)`, `messenger.status()`

A contact's messages, and `{ radio, irc, heard, route }`.

Events: `message (msg, contact)`, `update (msg)`, `status`.

#### `const irc = new Irc(stream, { nick, password, channels })`

A minimal IRC client over a duplex stream. `connect()`, `register([email])`, `identify()`, `join(channel)`, `privmsg(target, text)`, `quit()`. Events: `ready`, `message`, `notice`, `error`, `close`.

## Releases

Every merge to `main` builds the Android APK and publishes it as a GitHub release, with the APK attached. The version comes from the [Conventional Commits](https://www.conventionalcommits.org) since the last release: `feat` bumps minor, a breaking change (`feat!:` or `BREAKING CHANGE`) bumps minor while on 0.x and major after, anything else bumps patch. The first release uses the version in `package.json`. When squash-merging, give the pull request a Conventional Commits title. To sign releases with your own key, add three repository secrets (Settings › Secrets and variables › Actions):

```
keytool -genkeypair -keystore release.keystore -alias ekho -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 release.keystore   # the value of ANDROID_KEYSTORE
```

- `ANDROID_KEYSTORE`: the keystore, base64-encoded
- `ANDROID_KEYSTORE_PASSWORD`: its password
- `ANDROID_KEY_ALIAS`: `ekho`

Keep the keystore safe: Android only installs updates signed with the same key. Without the secrets, releases use a debug key and are marked as pre-releases.

On first launch, allow Bluetooth: Settings › Apps › ekho › Permissions › Nearby devices.

## License

Apache-2.0
