# ekho design

One phone app, paired with your own Meshtastic radio, where you message people, not networks. LoRa is the main path. IRC is a plain fallback for when no LoRa nodes are in range. Version 1 needs no hub and no MQTT.

This is the repo copy of the design doc ([live doc](https://claude.ai/artifact/FoQHiUT59zJwcn9gLDa5u2), [mockups](https://claude.ai/artifact/764MRSiCRXhoQuWgTLqC2b)). Where they differ, this file and `AGENTS.md` are the reference for the code.

## The idea

Today a community member runs two apps with two identities: the Meshtastic app (often proxying MQTT through the phone) and a separate IRC client. ekho replaces both. It talks to the T1000-E over Bluetooth and to IRC over the phone's internet, and shows one thread per person, whichever path carried each message.

It is a drop-in: nobody else needs the app. The people you message keep their stock Meshtastic apps or IRC clients.

## How it works today

```
                 Bluetooth                LoRa
  Phone app  <------------->  T1000-E  <-------->  LoRa mesh
  (threads,                  (your root           (friends on
   contacts)                  identity)            stock apps)
      :
      : internet, only when no nodes are heard
      v
  IRC server  <- - - IRC - - ->  motaba bridge  <---- LoRa ---->  mesh elsewhere
  irc.motaba.net:6697            (IRC <-> mesh)
  your registered nick
```

The phone pairs with the T1000-E over Bluetooth, and the T1000-E does all the LoRa. When no nodes are heard, the phone falls back to IRC over its own internet. The community's IRC server bridges into the mesh both ways, including direct messages to a single node, so people on LoRa still get messages you send over IRC.

## Identity

The T1000-E is who you are. It holds your Meshtastic node ID and the key pair the firmware uses for direct messages, and it's the device you carry. The phone is a screen and an internet link for it, so a lost phone loses nothing.

- **On LoRa,** your identity is your node: its ID, names and public key, as every stock Meshtastic app already sees it.
- **On IRC,** you are a registered nick. ekho links it to your node in your profile.
- **Contacts** are people, each with the addresses you link: their node, and their IRC nick if they have one. Links are yours, local and unsigned.

**IRC registration.** irc.motaba.net asks new nicks to register with a password. ekho does it once at setup: pick a nick (suggested from your node's short name), register with NickServ, verify by email if asked, store the password on the device. After that it logs in on every connect.

**The bridge sees two people.** The motaba bridge doesn't know your nick and your node are the same person. A message you send over IRC reaches the mesh from the bridge under your nick, not from your node, so stock users see someone else, and their replies go to the bridge. ekho still threads both into one conversation on your side.

**Impersonation**, weakest protection first:

1. **Tag:** ekho appends your node ID to IRC messages (`text [!e2f4a910]`). Anyone can type that, so it's a hint, not proof.
2. **Registered nick:** NickServ stops others using your exact nick, if the server enforces it. It doesn't stop look-alikes.
3. **Signed messages:** newer Meshtastic messages have a field for an XEdDSA signature with the node's key. If the T1000-E can be asked to sign, other ekho users could verify you on IRC. Stock users still couldn't.
4. **Verified link in the bridge:** motaba ties a nick to a node with a code sent over LoRa and confirmed on IRC. The only layer that protects people without ekho.

## Sending and receiving

LoRa first, every time it can reach; IRC only when it can't. The path is shown on every message.

**Choosing the path:**

1. Any node heard in the last few minutes: send over LoRa.
2. No nodes heard: send over IRC, which the bridge carries into the mesh.

That's the whole rule. A failed LoRa message is never moved to IRC automatically; it offers **retry on LoRa** and **send via IRC**, and you decide. Never send both ways at once: the bridge mirrors one path onto the other, so both would arrive twice on stock clients.

"Heard" means any packet from a node (message, position, telemetry), not node info, which radios broadcast only every 3 hours by default.

**What each path carries:**

| Feature | LoRa (Meshtastic) | IRC |
| --- | --- | --- |
| Direct and channel messages | Yes | Yes |
| Reactions | Yes | Sent as a new text message |
| Replies | Yes | Quoted as text |
| Delivery acknowledgement | Yes, from the mesh | No; sent only |
| Encryption | Channel key, or per-contact key for direct messages | TLS to the server only |
| Position and telemetry | Yes | No |
| Message length | About 200 bytes | About 400 bytes per line |

**Delivery states on LoRa:**

| State | Meaning |
| --- | --- |
| Sending | Queued on the radio, waiting for airtime |
| Sent | Transmitted by your radio (needs a bare-meshtastic event; not shown yet) |
| Relayed | Another node passed it on (needs the ack sender from bare-meshtastic) |
| Delivered | The recipient's node acknowledged it |
| Failed | No acknowledgement after the radio's retries; offers retry and send via IRC |

Channel messages stop at sent, as channels have no per-person acknowledgement. IRC messages are sent with no receipt.

**Duplicates:** no dedupe. Meshtastic devices dedupe by packet ID, and duplicates haven't been a problem in practice. The one exception: while LoRa is the route, IRC copies of mesh channel traffic are skipped, because the bridge mirrors what the radio already heard.

**Offline:** with no nodes heard and no internet, messages wait on the phone and go out on whichever path returns first.

## Version 1 scope

In:

- Pair with a T1000-E on stock Meshtastic firmware, using its standard Bluetooth client protocol. USB on desktop.
- Direct messages, channels, reactions and replies on LoRa.
- IRC setup with nick registration, then direct messages and channels as a fallback.
- One thread per person, with the path and delivery state on every message.
- Contacts that link a node to an IRC nick.
- Dark terminal look first, light mode later.
- ekho replaces the Meshtastic app on the phone, since the T1000-E pairs with one device at a time.

Principles:

1. **LoRa is the product.** IRC keeps you reachable; it is never the main path.
2. **Drop-in.** Nobody else needs ekho, and the radio keeps stock firmware.
3. **Airtime is scarce.** ekho never sends more over LoRa than the Meshtastic app would.
4. **Show the path.** Every message says how it travelled.

Out: MQTT (including the client proxy), a hub, a second radio, MeshCore, Nostr, and groups beyond existing Meshtastic and IRC channels.

## First P2P feature: big files between ekho users

LoRa and IRC can't carry files. Between two ekho users with internet, the Holepunch stack can. Keep it to the minimum: the mailbox pattern from [cero-base](https://github.com/lekinox/cero-base/blob/main/docs/core.md), followed rather than depended on.

1. **Each ekho install has a mailbox.** A 32-byte secret stays on the device; its public key is the mailbox address. Anyone can send to the address; only the secret opens what arrives.
2. **Share the address once.** In a direct message on a private Meshtastic port (stock apps ignore unknown ports; confirm on a device), accepted only if it arrived encrypted per contact (firmware 2.5+), or by QR code in person. Receiving someone's address is how ekho learns they run ekho; until then the attach button is greyed out.
3. **Send a file:** put it in a Hyperdrive or Hypercore encrypted with its own key. Mail the recipient a note with the drive's keys, sealed to their address. Nothing usable travels or is stored in the clear.
4. **Deliver the note:** the note goes in a fresh core of the sender's, announced to whoever receives at the address, on the swarm topic derived from the address (protomux-wakeup). The recipient's inbox fetches the core, opens the note, then replicates the drive from the sender.
5. **Later, mirrors:** blind peers that hold notes and drives for a recipient who's offline. Not in the first version: both must be online at some point together.

Privacy, as it stands:

- Notes are sealed to the recipient and drives are encrypted, so peers, DHT nodes and mirrors only ever see ciphertext.
- A note carries no sender unless it signs itself.
- **Presence:** receiving means joining the topic derived from your address, so anyone who has your address can see when your inbox is online. Only contacts you gave it to have it. The inbox could also be open only while ekho is in the foreground, and the address rotated if it leaks.

Not used, and why: LoRa broadcasts (noisy for everyone), topics derived from mesh keys (anyone can watch them), sending drive keys unsealed (anyone who sees them can read), and exporting the radio's private key (the root identity stays on the T1000-E).

## Building it on Bare

One Bare codebase covers phone and desktop.

| Layer | Module | Status |
| --- | --- | --- |
| UI | [bare-native](https://github.com/holepunchto/bare-native): native views, text, inputs, scroll views on iOS, Android, macOS, Linux, Windows; packaged with bare-build | 0.3.x |
| Radio protocol | [bare-meshtastic](https://github.com/holepunchto/bare-meshtastic): codec and client, config sync, node database, text, acks, position, telemetry | 0.0.1, experimental |
| Phone link | bare-bluetooth with bare-meshtastic's `Mailbox` | Used in bare-meshtastic's example |
| Desktop link | bare-meshtastic's `Framed` over a serial stream | Serial module to pick |
| IRC | `lib/irc.ts` over bare-tls | Written |
| P2P (later) | Hyperswarm, Protomux, Hypercore or Hyperdrive | Planned |

**Gaps in bare-meshtastic**, best fixed upstream:

1. **Reactions and replies:** `Data` needs the reply-to ID and emoji flag fields.
2. **Every packet:** an event for every packet received, from any node, on any port. `Heard` needs it to see all traffic, and ekho needs it to receive private-port packets, which are dropped today.
3. **Ack sender:** `from` on the `ack` event, to tell relayed from delivered.
4. **Sent over the air:** an event when a packet has been transmitted.
5. **Per-contact encryption flag:** whether a received packet was encrypted per contact, so a shared mailbox address can't be spoofed.

## Prior art

Most pieces exist; nobody has one phone app with one contact per person across networks that works with recipients on stock clients.

| Project | What it does | Gap |
| --- | --- | --- |
| [Mesh-Client](https://github.com/Colorado-Mesh/mesh-client) | Desktop client for Meshtastic, MeshCore and Reticulum | Desktop only; switches between protocols rather than one contact per person |
| [MESH-API](https://github.com/mr-tbot/mesh-api) | Hub-side router for Meshtastic and MeshCore radios | Hub software; no cross-network identity |
| [mtmc bridge](https://sourceforge.net/projects/mtmc-bridge/) | Relays between MeshCore and Meshtastic radios | Broadcasts everything to everything |
| [Nostrastic](https://github.com/quixotesystems/nostrastic) | Nostr over LoRa via a Meshtastic gateway | One network pair |
| [Akita Meshtastic IRC Gateway](https://github.com/AkitaEngineering/Akita-Meshtastic-IRC-Gateway) | IRC channel to Meshtastic and back | One network pair; experimental |
| [Reticulum](https://simeononsecurity.com/articles/meshtastic-vs-meshcore-vs-reticulum-comparison-guide/) and [Sideband](https://www.github.com/markqvist/Sideband) | One identity across LoRa, WiFi, TCP and more | Everyone must run Reticulum |
| [cero-base](https://github.com/lekinox/cero-base) mailbox | Sealed, anonymous messages to a 32-byte address, delivered as cores, with mirrors for offline owners | ekho follows its pattern for P2P |

## Mockups

[Off-Grid Messenger Mockups](https://claude.ai/artifact/764MRSiCRXhoQuWgTLqC2b): dark, monospace, phosphor-green accent for LoRa and your own messages, amber for IRC, red for failures. Screens: chats, conversation (log style, route and state on every line, reactions, retry and send via IRC on failure), contact (linked node and nick), radio (T1000-E status, root key, LoRa and IRC paths), IRC setup (server, nick, password, NickServ log), and a three-pane desktop layout.
