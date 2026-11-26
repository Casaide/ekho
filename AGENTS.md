# ekho: agent guide

Read this before changing anything. It holds the decisions behind the code, so a new session can continue without the original conversation.

## What ekho is

A phone and desktop messenger for the Bulgarian Meshtastic community. You message people, not networks: one thread per person, whichever path carried each message.

- **LoRa first.** The app talks to the user's Seeed T1000-E (stock Meshtastic firmware) over Bluetooth, or USB on desktop. The T1000-E holds the user's root identity: node ID and keys.
- **IRC fallback.** When no LoRa node has been heard recently, messages go over IRC on `irc.motaba.net:6697` (TLS). The motaba bridge relays IRC into the mesh and mesh traffic onto IRC, both ways, including direct messages to a single node.
- **Drop-in.** Nobody else needs the app. Recipients keep stock Meshtastic apps or IRC clients.
- **No MQTT and no rooftop hub in v1. P2P so far:** a Mac links to the phone by a code and mirrors it, sending through it (`lib/hub.ts`, `lib/mirror.ts`). A rooftop hub, MeshCore, Nostr and Holepunch hub-to-hub links are later.

## Read these first

- **`docs/design.md`**: the full design, including why each decision was made and which alternatives were rejected. Start here if you're new to the project.
- **`docs/plan.md`**: the phased plan with checkboxes; what's done and what's next.
- **`docs/connections.md`**: how the radio and IRC connections stay up (one state per link, what's wanted, Android pausing, SASL, ghosts). Read before touching connection code.
- This file: the short version of both, plus conventions and how to work in the repo.

The live design doc and the mockups are artifacts only the owner can open: [design doc](https://claude.ai/artifact/FoQHiUT59zJwcn9gLDa5u2), [mockups](https://claude.ai/artifact/764MRSiCRXhoQuWgTLqC2b). The repo copy in `docs/` is the reference for the code.

## How it fits together

```
 Phone or desktop: ekho                           Outside world
 ┌──────────────────────────────────────┐
 │ ui.ts ── Messenger ──┬── radio.ts ───┼─ BLE/USB ─ T1000-E ─ LoRa ─ mesh
 │          (route,     │  (bare-       │
 │           threads,   │   meshtastic) │
 │           states)    └── irc.ts ─────┼─ TLS ─ irc.motaba.net ─ bridge ─ mesh
 │                                      │
 │          Phase 2: mailbox ───────────┼─ Hyperswarm (address) ─ other ekho
 └──────────────────────────────────────┘
```

`Messenger` is the only piece that knows about both paths. It decides the route, keeps one thread per contact, and tracks each message's state. The radio and IRC sides are thin adapters it's handed once they connect.

## Decisions already made

Don't relitigate these without the user.

1. **Routing rule:** any node heard in the window (default 15 min), send over LoRa; none heard, send over IRC. That is the whole rule (`Messenger.route()`).
2. **Never send both ways at once.** The bridge already mirrors one path onto the other, so both would arrive twice on stock clients.
3. **No automatic fallback on failure.** A failed LoRa message shows "retry on lora" and "send via irc"; the user decides.
4. **No dedupe.** The user has not seen duplicates in practice; Meshtastic devices dedupe by packet ID themselves. The one exception: while LoRa is the route, the bridge's IRC copies of Meshtastic channel lines (`Name|mt`, in a channel the radio also has) are dropped, since the radio hears those itself. Everything else on IRC is kept: plain IRC users, MeshCore and Bitchat users, and IRC-only channels never reach the radio (an earlier, broader rule hid them all).
5. **Reactions and replies over IRC go as a new text message,** written as motaba's own app writes them: `↩️ "take the…" 👍`, the first two words of what's answered, then the answer (mirco's suggestion). No other option exists on IRC.
6. **The T1000-E pairs with one device at a time,** so ekho replaces the Meshtastic app on the phone.
7. **"Heard" means any packet** (message, position, telemetry), not node info, which radios broadcast only every 3 hours by default.
8. **The motaba bridge doesn't know a nick and a node are the same person.** ekho no longer tags IRC messages with our node ID: it confused people and proved nothing, as anyone can type it. Real protection needs motaba to verify a nick-to-node link (code sent over LoRa, confirmed on IRC).
9. **Delivery states:** LoRa direct `sending -> delivered | failed`; LoRa channel `sending -> relayed | failed` (the radio's implicit ack: it heard another radio repeat the message, which says nothing about who read it); IRC goes to `sent` (no receipts); incoming messages are `received`.

## Layout

| Path                                             | What it is                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/messenger.ts`                               | The core: threads, routing, sending, ack matching, retry and send via IRC. Radio and IRC are attached with `setRadio` and `setIrc` as they connect.      |
| `lib/irc.ts`                                     | Minimal IRC client over any duplex stream: SASL or NickServ login, reclaiming a ghosted nick, PING and a silence check, LIST, join, part, privmsg.       |
| `lib/link.ts`                                    | One connection kept up while wanted: a single state (off, connecting, on, waiting, failed), retries, pause and resume. See `docs/connections.md`.        |
| `lib/heard.ts`                                   | Last-heard time per node, and the window.                                                                                                                |
| `lib/contacts.ts`                                | People linking a node ID and an IRC nick; a channel contact for the mesh channel.                                                                        |
| `lib/types.ts`                                   | Shared types, including `Radio`, the slice of a bare-meshtastic `Client` that ekho uses.                                                                 |
| `lib/radio.ts`                                   | Bluetooth connect: bare-bluetooth plus bare-meshtastic `Mailbox` and `Client`. Device code, untested here.                                               |
| `lib/ui/`, `lib/theme.ts`                        | bare-native UI after the mockups (`docs/mockups/`): `index.ts` (navigation, tabs or panes), `kit.ts` (shared pieces), one module per screen.             |
| `lib/notifier.ts`                                | What to notify while off screen: messages to you, and channel lines naming you.                                                                          |
| `lib/hub.ts`, `lib/mirror.ts`                    | Linking devices: the phone's feed of everything its Messenger does, and a linked device applying it and sending through the phone's outbox reader.       |
| `lib/devices.ts`, `lib/linker.ts`, `lib/code.ts` | The P2P side: Corestore, Hyperswarm, blind-pairing by a ten-character code; and the app's use of it. See docs/design.md.                                 |
| `lib/presence.ts`                                | Who's around: radio nodes heard and IRC nicks in our channels, one entry per person (bridged `name\|mt` nicks matched to radio nodes).                   |
| `packages/`                                      | Our own native addons (C++ and Java, built like bare-navigation-android): notifications and a foreground service. Compiled by `scripts/build-addons.sh`. |
| `app.ts`                                         | Entry: wires Messenger, UI, radio and TLS IRC.                                                                                                           |
| `test/*.ts`, `test.ts`                           | bare-tap tests with fake radio and fake IRC stream.                                                                                                      |
| `docs/design.md`, `docs/plan.md`                 | The design and the phased plan. Update them when a decision changes.                                                                                     |
| `.claude/skills/`                                | `ekho` (the working loop) and `js-house-style` (the Holepunch style guide).                                                                              |

## Conventions

- **One open pull request at a time.** Add each change to it rather than opening another: every merge to `main` makes a release, and a release per commit is noise. If it's merged while work goes on, the next changes start the next one.
- **Conventional Commits** for commit messages (`feat(irc): ...`, `fix(ci): ...`, `docs: ...`) and branch names (`feat/contacts-ui`, `fix/ble-reconnect`).
- **Dependencies match npm.** Take versions from `npm view <name> version`, never from a clone or memory, and declare peer dependencies of what we use (bare-meshtastic needs `bare-logger`). The APK workflow prints each declared range next to the latest published version.
- **Android back** comes from `bare-navigation-android` (Holepunch's): it needs minSdk 33 and `enableOnBackInvokedCallback` in the manifest, and it's Android only, so `app.ts` imports it only there and the macOS build defers it. `Ui.goBack()` decides; false lets Android leave the app.
- **Releases are automatic:** every merge to `main` runs `.github/workflows/release.yml`, which works out the next version from the commits, builds the APK and publishes a GitHub release. Don't tag by hand.
- **Watch every workflow** after a push (Integrate and APK), not just the one you changed.
- **TypeScript, erasable syntax only.** Bare strips types natively and rejects anything that isn't erasable (enums, namespaces, parameter properties). No `private` keyword either; use the `_name` convention. `tsconfig.json` sets `erasableSyntaxOnly`.
- **ESM with explicit `.ts` imports** (`import Heard from './heard.ts'`), and `import type` for types.
- **CommonJS dependencies are default-imported, then destructured** (`import native from 'bare-native'; const { View } = native`). Don't rely on named imports from CJS.
- **Holepunch JS house style** (full guide in `.claude/skills/js-house-style`; apply its review checklist to every change): small single-purpose modules; `(required, opts = {})` constructors; all fields declared in the constructor; no async in constructors; no defensive guards (caller bugs crash; operational failures surface as `failed` states or `error` events); `b4a`, never the `Buffer` global; `bare-events` for emitters.
- **Formatting:** `prettier-config-holepunch` (no semicolons, single quotes, 100 columns, no trailing commas). Lint with `lunte`.
- **Tests:** `bare-native-test` running `bare-tap` tests (`npm test`). Test the public API the way a user of the module calls it; never pin misuse behaviour.

## Running

```
npm install
npm test             # bare-native-test test.ts
npm run lint         # prettier --check . && lunte
npm run typecheck    # tsc --noEmit
npm start            # bare-build with the bare-native runtime; add --host <platform>-<arch>
```

The pure logic (irc, heard, contacts, messenger) also runs under Node 22.18+ with its built-in type stripping, given stand-ins for `bare-events`, `b4a` and `bare-tap`. That's how the first attempt was checked, since the session that wrote it had no npm registry access.

## State of the first attempt

- **Verified:** the 24 tests in `test/` pass under Node type stripping, and the APK builds in CI (`.github/workflows/apk.yml`).
- **Not verified:** nothing has run on a device yet. `lib/radio.ts`, `lib/ui.ts` and `app.ts` were written against the READMEs of bare-native, bare-meshtastic, bare-bluetooth and bare-tls. Expect fixes on first launch.
- **Tests on Bare:** `npm test` runs bare-native-test with `--out test/native`. Its generated wrapper is CommonJS, so `test/native/package.json` sets `"type": "commonjs"` there; the rest of the package is ESM.

## Next steps

Roughly in order:

1. **Run it on a phone** over Bluetooth with the v0.1.0 APK, and on a desktop with a T1000-E over USB; fix what breaks. Expect `lib/radio.ts`, `lib/ui.ts` and `app.ts` to need fixes.
2. **IRC setup self-test:** send a code from the user's nick to their own node via the bridge and confirm it arrives. Needs the bridge's addressing for a DM to a node (see open questions).
3. **Over-the-air updates with Pear** (experiment, see `docs/plan.md`).
4. **Mockup fidelity:** radio screen, IRC setup screen, light mode.
5. **bare-meshtastic gaps** (better fixed upstream, in holepunchto/bare-meshtastic):
   - reactions and replies: `Data` needs the reply-to ID and emoji flag fields;
   - an event for every packet received, on any port, so `Heard` sees all traffic and ekho can receive private-port packets (dropped today);
   - `from` on `ack`, to tell "relayed" from "delivered";
   - an event when a packet has gone out over the air, for a "sent" state;
   - whether a received packet was encrypted per contact (so a shared mailbox address can't be spoofed);
   - the channel a packet arrived on (MeshPacket field 3): without it, every LoRa channel message lands in the mesh channel;
   - `last_heard` and `device_metrics` in the node list (NodeInfo fields 5 and 6): battery, channel use, and who was heard before ekho connected.
6. **Running in the background:** done, not yet tried on a phone. `packages/bare-foreground-service-android` keeps the process alive (Bare keeps running while suspended as long as sockets are open), and `packages/bare-notifications-android` shows messages; see `docs/connections.md`. Move both to their own repos once they work.
7. **Reactions:** over LoRa once bare-meshtastic supports them; over IRC as a short text message.

## Phase 2: big files over P2P (decided, not started)

Keep it focused: follow the mailbox pattern from [cero-base](https://github.com/lekinox/cero-base/blob/main/docs/core.md) (address from a secret, sealed note in a fresh core, announced on a topic derived from the address via protomux-wakeup). Follow the pattern; don't depend on cero-base. Detail in `docs/design.md`.

1. Each install has a mailbox secret; its public key is the address.
2. Share the address in a private-port LoRa direct message (accepted only if encrypted per contact) or by QR. Knowing a contact's address is what enables the attach button.
3. A file is an encrypted Hyperdrive or Hypercore; its keys go in a note sealed to the recipient's address.
4. The recipient's inbox fetches and opens the note, then replicates the drive.
5. Mirrors for offline recipients are later, not MVP.

Privacy first: nothing usable in the clear, notes anonymous unless signed. Accepted trade-off: anyone holding your address can see when your inbox is online, so only contacts get it, the inbox runs only in the foreground, and the address can be rotated.

## What irc.motaba.net told us

From the server's welcome, MOTD and NickServ (seen on 2026-11-25):

- **Accounts:** only registered nicks may stay. NickServ gives 60 seconds to `IDENTIFY` and suggests SASL PLAIN, which ekho uses (falling back to `IDENTIFY`). One connection per nick: a second gets 433, so ekho reclaims a ghosted nick (see `docs/connections.md`).
- **Channels:** the server joins everyone to `#bulgaria`, ekho's mesh channel. ekho asks for `LIST` once logged in and shows the rest as a list to join or leave (saved, rejoined on reconnect); those are IRC only. Regional ones are bridged too: `#blagoevgrad`, `#sandanski`, `#sofia`, `#silistra`, `#bansko`, `#burgas`, `#gabrovo`, `#petrich`, `#shumen`, `#varna`, `#vratsa`, `#vt`, `#gorna`. Joining a channel that doesn't exist creates it (ekho once made `#mesh`).
- **Mesh users** appear as nicks with a suffix: `name|mt` (Meshtastic), `name|mc` (MeshCore), `name|bc` (Bitchat). The name is the node's long name with spaces as `_`, cut to fit `NICKLEN=30` (the user's T1000-E, long name "Dom", is `Dom|mt`). A DM to a node is a PRIVMSG to that nick: mirco (motaba's operator) confirmed DMs work IRC to IRC and IRC to a Meshtastic node (`/msg Dom|mt hi`).
- **Airtime:** one message per 10 s goes out to the mesh, 150 bytes at most; faster ones wait their turn. `lib/irc.ts` splits at 400 characters today, which is too long.
- **Hosts** are cloaked (`~dom@64a18efa92.irc`), so the IP isn't shown.

## Meshtastic over Bluetooth: what the README example leaves out

`lib/radio.ts` follows the BLE example in the bare-meshtastic README, plus three things it misses (found on a real T1000-E with Android):

- Android ignores the service filter in `discoverServices`, so pick the Meshtastic service by UUID rather than `services[0]`.
- Request an MTU of 512 before syncing, as the [Meshtastic client API](https://meshtastic.org/docs/development/device/client-api/) asks; Android starts at 23. A no-op on Apple.
- On any failure, hang up: disconnect the radio and stop the scan, or it stays connected to the phone, stops advertising, and the next attempt never finds it.

## Open questions

- Which channel maps to the default LongFast mesh channel? `#bulgaria` is the guess.
- Can the T1000-E sign an arbitrary message with its key (XEdDSA), asked over Bluetooth? That would let app users verify each other on IRC.
- Would motaba add a verified nick-to-node link?
- What window should "recently heard" use? 15 minutes is a placeholder.
