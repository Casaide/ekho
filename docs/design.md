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

LoRa and IRC can't carry files. Between two ekho users with internet, the Holepunch stack can. The attach icon shows in every conversation but stays greyed out until the contact is paired as an ekho user. Stock users never see any of this.

1. **Pair once over LoRa.** A direct message on a private Meshtastic port carries a fresh random pair secret, a challenge, and your rendezvous secret (below). Stock apps ignore unknown ports, so nobody else sees it (to confirm on a device). Firmware 2.5+ encrypts direct messages per contact, so only that contact's radio can read it or answer. Pairing replies are only accepted if they arrived encrypted per contact; on older firmware a direct message falls back to the shared channel key and the sender could be faked.
2. **One topic per person, for finding each other only.** Each ekho user has one random rendezvous secret and announces on `hash(rendezvous secret)` whenever ekho is online. Paired contacts know it; nobody else can compute it. To reach Ivan, look up his topic. You only ever announce on your own topic, never on per-contact ones, which keeps swarming simple and implicit. The topic does nothing once two peers have found each other.
3. **Prove the pair on the connection.** A small Protomux channel where each side sends a keyed hash of the connection's handshake hash, keyed with the pair secret. Knowing someone's topic isn't enough to get in; a peer without the pair secret is dropped, and the proof can't be relayed or replayed.
4. **Data flows over that connection,** not via any topic. The "file offered" notice goes over LoRa or IRC so the recipient knows to connect.
5. **The sender holds the file at first,** shared as a Hypercore or Hyperdrive and encrypted to the recipient with a key derived from the pair secret. The recipient pulls it when both are online. A mailbox comes later, on the user's own always-on hub, announcing on the user's same rendezvous topic.

**Trade-off:** every paired contact can see when you're online. To drop someone, rotate your rendezvous secret and re-share it with the rest, one direct message each next time you're in range.

**Groups:** a private Meshtastic channel can have one topic, `hash(channel key + name)`, that every ekho member of that channel can find. It proves channel membership only, the same trust as the channel itself. Public channels all use the same default key, so a topic made from it would be public; they get no topic.

| Topic | Who can find you | Used for |
| --- | --- | --- |
| Your rendezvous topic | Your paired contacts | One-to-one, always on while online |
| A private channel's topic | Members of that channel | Groups (later) |

Rejected alternatives, and why:

- **A handshake broadcast over LoRa:** noisy for everyone on the mesh.
- **A public DHT topic per mesh key:** anyone could announce on it, or watch it to see who runs ekho, when they're online and from which IP.
- **A DHT server on a long-lived ekho key:** a stable public identifier anyone who learns it can watch. The rendezvous topic is only computable by paired contacts, and can be rotated.
- **One topic per pair:** private, but a phone announcing on every contact's topic drains battery and needs bookkeeping. One rendezvous topic per person replaces it.
- **Public channel topics:** public channels share the default key, so their topic would be public.
- **Key agreement from the mesh keys:** needs the radio's private key exported to the phone, which breaks "the root identity stays on the T1000-E".
- **Other ekho users as mailboxes:** strangers storing your data brings storage limits and abuse problems.

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
2. **Every packet:** an event for every packet received, from any node, on any port. `Heard` needs it to see all traffic, and pairing needs it to receive private-port packets, which are dropped today.
3. **Ack sender:** `from` on the `ack` event, to tell relayed from delivered.
4. **Sent over the air:** an event when a packet has been transmitted.
5. **Per-contact encryption flag:** whether a received packet was encrypted per contact, so pairing can reject anything else.
6. **Node public key:** the user info model has no field for a node's public key.

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
| [blind-pairing](https://github.com/holepunchto/blind-pairing) | Holepunch pairing: secret shared out of band, discovery and proof derived from it | Built for one-time Autobase invites; ekho's P2P pairing follows the same pattern |

## Mockups

[Off-Grid Messenger Mockups](https://claude.ai/artifact/764MRSiCRXhoQuWgTLqC2b): dark, monospace, phosphor-green accent for LoRa and your own messages, amber for IRC, red for failures. Screens: chats, conversation (log style, route and state on every line, reactions, retry and send via IRC on failure), contact (linked node and nick), radio (T1000-E status, root key, LoRa and IRC paths), IRC setup (server, nick, password, NickServ log), and a three-pane desktop layout.
