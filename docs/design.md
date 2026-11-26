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

**Impersonation**, weakest protection first. ekho once tagged IRC messages with your node ID (`text [!e2f4a910]`); it confused people and proved nothing, as anyone can type it, so it's gone.

1. **Registered nick:** NickServ stops others using your exact nick, if the server enforces it. It doesn't stop look-alikes.
2. **Signed messages:** newer Meshtastic messages have a field for an XEdDSA signature with the node's key. If the T1000-E can be asked to sign, other ekho users could verify you on IRC. Stock users still couldn't.
3. **Verified link in the bridge:** motaba ties a nick to a node with a code sent over LoRa and confirmed on IRC. The only layer that protects people without ekho.

## Sending and receiving

LoRa first, every time it can reach; IRC only when it can't. The path is shown on every message.

**Choosing the path:**

1. Any node heard in the last few minutes: send over LoRa.
2. No nodes heard: send over IRC, which the bridge carries into the mesh.

That's the whole rule. A failed LoRa message is never moved to IRC automatically; it offers **retry on LoRa** and **send via IRC**, and you decide. Never send both ways at once: the bridge mirrors one path onto the other, so both would arrive twice on stock clients.

"Heard" means any packet from a node (message, position, telemetry), not node info, which radios broadcast only every 3 hours by default.

**What each path carries:**

| Feature                     | LoRa (Meshtastic)                                   | IRC                                                         |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Direct and channel messages | Yes                                                 | Yes                                                         |
| Reactions and replies       | Yes                                                 | Sent as a new text message: `↩️ "name: two words…": answer` |
| Replies                     | Yes                                                 | Quoted as text                                              |
| Delivery acknowledgement    | Yes, from the mesh                                  | No; sent only                                               |
| Encryption                  | Channel key, or per-contact key for direct messages | TLS to the server only                                      |
| Position and telemetry      | Yes                                                 | No                                                          |
| Message length              | About 200 bytes                                     | About 400 bytes per line                                    |

**Delivery states on LoRa:**

| State     | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| Sending   | Queued on the radio, waiting for airtime                                    |
| Sent      | Transmitted by your radio (needs a bare-meshtastic event; not shown yet)    |
| Relayed   | Another node passed it on (needs the ack sender from bare-meshtastic)       |
| Delivered | The recipient's node acknowledged it                                        |
| Failed    | No acknowledgement after the radio's retries; offers retry and send via IRC |

Channel messages have no per-person acknowledgement, but the radio still reports an implicit ack: it listens for another radio repeating the message, and retries if it hears none. ekho shows that as relayed (it reached the mesh), or failed if no radio repeated it. IRC messages are sent with no receipt.

**Duplicates:** no dedupe. Meshtastic devices dedupe by packet ID, and duplicates haven't been a problem in practice. The one exception: while LoRa is the route, the bridge's IRC copies of Meshtastic channel lines (`Name|mt`, in a channel the radio also has) are skipped, because the radio hears those itself. Plain IRC users, MeshCore and Bitchat users, and IRC-only channels are always kept: none of those reach the radio.

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

## Links

Links in a message are marked, and each gets a card beside the message (up to two): the page's title, site and description from its Open Graph tags, or just where it goes until those arrive. Tapping a card opens the link in the browser, through ekho's own small addons for Android (an `ACTION_VIEW` intent) and macOS (`NSWorkspace`). Cards sit beside the message rather than in it, so a tap on a link doesn't also open the message's details.

Previews are fetched once and kept (`lib/previews.ts`): in memory for the session, and in a Hyperbee of their own (`lib/kept.ts`, a local core in the linking Corestore, never announced) for a week, or a day for a link with nothing to show. A link that couldn't be reached is tried again next session. Only small things are kept: the title, site, description and picture address, and the picture itself if it's at most 64 KB; a bigger one is fetched again. Fetching reads at most 512 KB of a page and gives up after 8 s. A page's image (`og:image`) shows on its card, and a link to an image shows the image itself: PNG, JPEG, GIF or WebP, up to 5 MB, kept in a cache folder because the native image view reads files. Fetching tells the site this device's address, as any messenger's previews do; a page that can't be had shows the link plain.

Two sites preview from elsewhere than the page: a picture on GitHub (`github.com/…/blob/….png`) from its raw file, so it shows as the picture rather than GitHub's card for the repository; and a YouTube video from its oEmbed (title, channel, thumbnail), since in the EU its page is a cookie consent page.

A link sits on lines of its own in the message, broken by ekho to fit the width (after a `/`, `.` or the like when one is near). Android wrapped a long link differently from how bare-native measured it, so the text ran a line past its box into the card below. A tap on a message with a link opens the link; holding it opens its details and actions.

A link to a sound or a video (by its extension: mp3, wav, ogg, opus, m4a, aac, flac; mp4, m4v, webm, mov) gets a card to play it in place instead, with no fetch until tapped. The player is a web view holding an `<audio>` or `<video>` element, so each platform plays what its browser does, with no audio code of ours. It keeps playing while messages arrive, stops on ■ or on leaving the conversation, and ↗ opens it in the browser. This is the first step toward voice notes: a link to a recording, wherever it's hosted.

## Translation

Bulgarian messages can show in English, on the device. It's off until turned on in the radio tab; then Mozilla's Bulgarian→English model (Firefox Translations, Bergamot, MPL-2.0) is fetched once the way Firefox gets it, from Remote Settings and its CDN (`lib/bergamot.ts`), into the app's data folder, and run by QVAC's translation addon (`@qvac/translation-nmtcpp`), loaded only then. Nothing is built into the app, and no message leaves the device. Android only for now: QVAC's runtime package picks its native library by the build machine's architecture, not each host's, so the universal macOS build defers the addon. Its GPU backends (Vulkan, OpenCL, RPC, about 88 MB) are removed before building (`scripts/qvac-hosts.sh`), since Bergamot runs on the CPU. QVAC's own TranslatePsy models are smaller and better but don't cover Bulgarian yet; one would load the same way.

A received message that's mostly Cyrillic letters is translated by itself (`lib/translator.ts`), once per session, and shows in English in place of the Bulgarian, marked "translated". People mix English and Bulgarian, in either alphabet, so any received message can be translated from its details, on hold, where the original is too, and a translated one can be shown as written again. Bulgarian typed in Latin letters ("kvo gotvite") is spelled in Cyrillic first, since the model reads Cyrillic: the official transliteration backwards plus chat habits (4 for ч, 6 for ш, w for в, q for я). It's rough, so only messages you ask for go through it.

## Mentions

Each network writes a mention its own way, and the bridge passes them on as text. MeshCore writes `@[Root 👾]`. Meshtastic's Android app writes `@!0e8666a6`, the node's ID, so it survives a rename. IRC has none: a nick in the line is the convention. ekho shows both written forms as `@name` in bold (a node's ID by the node's name, when the radio knows it), and in another colour when the mention is us: our nick, our radio's names, or our node's ID (`lib/mentions.ts`). A channel line mentioning us by any of these notifies. Sending mentions, each in the form its path expects, is not built yet.

## First P2P step, built: a linked Mac mirrors the phone

The smallest step toward shared history, chosen with the user: the phone stays the only device on the radio and IRC, and other devices link to it. Nothing merges, because only the phone writes.

- **The phone's feed** (`lib/hub.ts`): a Hypercore of JSON entries. The whole state comes first, then every message, state change, contact list and status as the Messenger emits them. Each message gets a `ref`, a number both sides use for it. A restart keeps numbering where it was. A new snapshot is written only when the feed is new or messages arrived from before it. Also what the phone sees around it (`around`): its radio's channels, the server's channel list, the nodes it knows with when each was last heard (to the minute), and who's in each IRC channel. That's written only when it changed, and at most every 15 seconds, so joins and parts in a busy channel don't fill the feed. A linked device shows the channels, people and nodes screens from it, and joining or leaving a channel there asks the phone to do it.
- **A linked device** (`lib/mirror.ts`) replicates the feed and applies it to its own Messenger, so it has the full history and catches up after being away. What it sends, retries or sends via IRC goes into an outbox core of its own. The phone reads the outbox and acts on it through the usual routing rule, and the result comes back through the feed. A sent message carries the linked device's own number (`local`), so it replaces the copy shown while it was waiting.
- **Linking** (`lib/devices.ts`, `lib/code.ts`): blind-pairing with a ten-character code from an alphabet without look-alikes, about 49 bits. It works for 10 minutes and for one device. The code yields both the invite's seed and the key the invite is for, so the other device rebuilds the invite from the code alone. blind-pairing requires the invite's discovery key to be its key's, so the code can't be for the feed itself. The feed's key and its encryption key go back in the answer's additional data, signed with the invite key and sealed to the requester. The request carries the linked device's outbox key, outbox encryption key and swarm key, and the phone checks its size and shape before using it, since anyone holding the code can send one.
- **Encryption, required:** every core is block encrypted with its own random key, so blocks are stored and sent encrypted and a peer, mirror or blind peer without the key sees only ciphertext. The keys are kept in the app's own storage next to the cores, not yet in the system keystore, so they protect against everyone but someone holding the unlocked device. The first version had cores in the clear; saved links from it are dropped (`version` in what's saved) and devices link again.
- **Format and checks:** every feed entry carries a `format`. A linked device that meets a newer one stops applying and asks to be updated, instead of guessing. The phone skips anything in an outbox that isn't a well-formed request.
- **Sleeping with the app:** when Android pauses ekho and the foreground service isn't keeping it running, the Corestore is suspended first (its storage let go, as the OS may stop the app at any moment), then the swarm. Both come back on resume. While the service runs, they stay up, so a linked Mac keeps getting the phone's messages with the phone in a pocket.
- **Replication:** one Corestore and one Hyperswarm per device, on the feed's discovery key. The phone replicates only with swarm keys it has linked. A linked device replicates with whoever is on the topic, who can read only cores whose keys they hold.
- **One login per nick:** while linked, a device doesn't open its own radio or IRC, which would fight the phone for the nick. Unlinking brings them back.

Not yet: renames, joins and read markers made on a linked device stay there; the phone must be online for the other device to catch up (a blind peer later); keys aren't in the system keystore yet. The per-device bee2 design below is where this goes when more than one device writes.

## Later P2P step: your devices share one history

Phone and laptop can't both hold the T1000-E, and motaba has no IRC history, so whatever one device sees the other misses. The first P2P piece syncs one person's own devices: the laptop records IRC while the phone sleeps, and the phone's LoRa traffic shows on the laptop.

**One Hyperbee 2 per device, never a shared key.** Each device writes only to its own bee. Two devices writing to one core would fork it, and Hypercore peers reject a forked core, so handing a key between devices only works if exactly one writes at a time, which nothing guarantees.

- **A new device catches up with `move`.** Open another device's bee by key, then `db.move({ key: ownCore })`: the tree continues on the new device's own core, the earlier entries stay where they are and are read from there, lazily.
- **Devices converge by diffing.** bee2 doesn't merge, so each device runs `createDiffStream(other)` against the other devices' bees and writes in what it's missing. Keys are laid out so that merging is mechanical:
  - `msg/<contact>/<time>/<id>`: messages never change, so merging is a union;
  - `contact/<id>`, `read/<contact>`, `channels`: small values with `updatedAt`, newest wins;
  - joins and removals as tombstones, so a merge doesn't bring back what was merged away.
- **Private:** each core is encrypted (bee2 takes an encryption provider per core), and devices find each other on a topic derived from a pairing secret, shared by QR. Nothing usable in the clear.
- **Only while both are online.** A blind peer holding the encrypted cores fills the gaps later; the same piece mirrors for others (option B).

Autobee per identity was considered: one agreed view of shared state is the proper tool if that state grows. It costs pairing writers, indexers and handling lost devices, which ekho's few mutable values (aliases, joins, read markers) don't need yet. Per-device bees move to it naturally: they become its inputs.

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

| Layer          | Module                                                                                                                                                               | Status                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| UI             | [bare-native](https://github.com/holepunchto/bare-native): native views, text, inputs, scroll views on iOS, Android, macOS, Linux, Windows; packaged with bare-build | 0.3.x                             |
| Radio protocol | [bare-meshtastic](https://github.com/holepunchto/bare-meshtastic): codec and client, config sync, node database, text, acks, position, telemetry                     | 0.0.1, experimental               |
| Phone link     | bare-bluetooth with bare-meshtastic's `Mailbox`                                                                                                                      | Used in bare-meshtastic's example |
| Desktop link   | bare-meshtastic's `Framed` over a serial stream                                                                                                                      | Serial module to pick             |
| IRC            | `lib/irc.ts` over bare-tls                                                                                                                                           | Written                           |
| P2P (later)    | Hyperswarm, Protomux, Hypercore or Hyperdrive                                                                                                                        | Planned                           |

**Gaps in bare-meshtastic**, best fixed upstream:

1. **Reactions and replies:** `Data` needs the reply-to ID and emoji flag fields.
2. **Every packet:** an event for every packet received, from any node, on any port. `Heard` needs it to see all traffic, and ekho needs it to receive private-port packets, which are dropped today.
3. **Ack sender:** `from` on the `ack` event, to tell relayed from delivered.
4. **Sent over the air:** an event when a packet has been transmitted.
5. **Per-contact encryption flag:** whether a received packet was encrypted per contact, so a shared mailbox address can't be spoofed.

## Prior art

Most pieces exist; nobody has one phone app with one contact per person across networks that works with recipients on stock clients.

| Project                                                                                                                                                            | What it does                                                                                         | Gap                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Mesh-Client](https://github.com/Colorado-Mesh/mesh-client)                                                                                                        | Desktop client for Meshtastic, MeshCore and Reticulum                                                | Desktop only; switches between protocols rather than one contact per person |
| [MESH-API](https://github.com/mr-tbot/mesh-api)                                                                                                                    | Hub-side router for Meshtastic and MeshCore radios                                                   | Hub software; no cross-network identity                                     |
| [mtmc bridge](https://sourceforge.net/projects/mtmc-bridge/)                                                                                                       | Relays between MeshCore and Meshtastic radios                                                        | Broadcasts everything to everything                                         |
| [Nostrastic](https://github.com/quixotesystems/nostrastic)                                                                                                         | Nostr over LoRa via a Meshtastic gateway                                                             | One network pair                                                            |
| [Akita Meshtastic IRC Gateway](https://github.com/AkitaEngineering/Akita-Meshtastic-IRC-Gateway)                                                                   | IRC channel to Meshtastic and back                                                                   | One network pair; experimental                                              |
| [Reticulum](https://simeononsecurity.com/articles/meshtastic-vs-meshcore-vs-reticulum-comparison-guide/) and [Sideband](https://www.github.com/markqvist/Sideband) | One identity across LoRa, WiFi, TCP and more                                                         | Everyone must run Reticulum                                                 |
| [cero-base](https://github.com/lekinox/cero-base) mailbox                                                                                                          | Sealed, anonymous messages to a 32-byte address, delivered as cores, with mirrors for offline owners | ekho follows its pattern for P2P                                            |

## Mockups

[Off-Grid Messenger Mockups](https://claude.ai/artifact/764MRSiCRXhoQuWgTLqC2b): dark, monospace, phosphor-green accent for LoRa and your own messages, amber for IRC, red for failures. Screens: chats, conversation (log style, route and state on every line, reactions, retry and send via IRC on failure), contact (linked node and nick), radio (T1000-E status, root key, LoRa and IRC paths), IRC setup (server, nick, password, NickServ log), and a three-pane desktop layout.
