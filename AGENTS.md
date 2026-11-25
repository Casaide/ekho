# ekho: agent guide

Read this before changing anything. It holds the decisions behind the code, so a new session can continue without the original conversation.

## What ekho is

A phone and desktop messenger for the Bulgarian Meshtastic community. You message people, not networks: one thread per person, whichever path carried each message.

- **LoRa first.** The app talks to the user's Seeed T1000-E (stock Meshtastic firmware) over Bluetooth, or USB on desktop. The T1000-E holds the user's root identity: node ID and keys.
- **IRC fallback.** When no LoRa node has been heard recently, messages go over IRC on `irc.motaba.net:6697` (TLS). The motaba bridge relays IRC into the mesh and mesh traffic onto IRC, both ways, including direct messages to a single node.
- **Drop-in.** Nobody else needs the app. Recipients keep stock Meshtastic apps or IRC clients.
- **No MQTT, no hub, no P2P in v1.** A rooftop hub, MeshCore, Nostr and Holepunch hub-to-hub links are later.

Design doc and mockups (owner access): [design doc](https://claude.ai/artifact/FoQHiUT59zJwcn9gLDa5u2), [mockups](https://claude.ai/artifact/764MRSiCRXhoQuWgTLqC2b).

## Decisions already made

Don't relitigate these without the user.

1. **Routing rule:** any node heard in the window (default 15 min), send over LoRa; none heard, send over IRC. That is the whole rule (`Messenger.route()`).
2. **Never send both ways at once.** The bridge already mirrors one path onto the other, so both would arrive twice on stock clients.
3. **No automatic fallback on failure.** A failed LoRa message shows "retry on lora" and "send via irc"; the user decides.
4. **No dedupe.** The user has not seen duplicates in practice; Meshtastic devices dedupe by packet ID themselves. The one exception: IRC copies of mesh channel traffic are dropped while LoRa is the route, since they are mirrors of what the radio already heard.
5. **Reactions over IRC go as a new text message.** No other option exists on IRC.
6. **The T1000-E pairs with one device at a time,** so ekho replaces the Meshtastic app on the phone.
7. **"Heard" means any packet** (message, position, telemetry), not node info, which radios broadcast only every 3 hours by default.
8. **The motaba bridge doesn't know a nick and a node are the same person.** IRC messages are tagged with our node ID (`text [!e2f4a910]`). That's a hint, not proof: anyone can type it. Real protection needs motaba to verify a nick-to-node link (code sent over LoRa, confirmed on IRC).
9. **Delivery states:** LoRa direct `sending -> delivered | failed`; LoRa channel and IRC go to `sent` (no receipts); incoming messages are `received`.

## Layout

| Path | What it is |
| --- | --- |
| `lib/messenger.ts` | The core: threads, routing, sending, ack matching, retry and send via IRC. Radio and IRC are attached with `setRadio` and `setIrc` as they connect. |
| `lib/irc.ts` | Minimal IRC client over any duplex stream: login, PING, NickServ register and identify, join, privmsg with line splitting. |
| `lib/heard.ts` | Last-heard time per node, and the window. |
| `lib/contacts.ts` | People linking a node ID and an IRC nick; a channel contact for the mesh channel. |
| `lib/types.ts` | Shared types, including `Radio`, the slice of a bare-meshtastic `Client` that ekho uses. |
| `lib/radio.ts` | Bluetooth connect: bare-bluetooth plus bare-meshtastic `Mailbox` and `Client`. Device code, untested here. |
| `lib/ui.ts`, `lib/theme.ts` | bare-native UI: dark terminal look, chats, conversation, composer, radio and IRC controls. Compact mode below 700 points wide. |
| `app.ts` | Entry: wires Messenger, UI, radio and TLS IRC. |
| `test/*.ts`, `test.ts` | bare-tap tests with fake radio and fake IRC stream. |

## Conventions

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

- **Verified:** the 17 tests in `test/` pass, and every `.ts` file passes a type-stripping syntax check.
- **Not verified:** nothing has run on Bare or on a device. `lib/radio.ts`, `lib/ui.ts` and `app.ts` were written against the READMEs and type definitions of bare-native, bare-meshtastic, bare-bluetooth and bare-tls, without being run. Expect fixes on first launch.
- **Not done:** `npm install`, lint, typecheck and `package-lock.json` have not been run.

## Next steps

Roughly in order:

1. Run it on a desktop with a T1000-E over USB, fix what breaks, then on a phone over Bluetooth. Android needs Bluetooth permissions declared in the manifest.
2. **Persistence:** contacts, threads and IRC credentials are in memory only. Store the IRC password on the device only.
3. **IRC setup self-test:** send a code from the user's nick to their own node via the bridge and confirm it arrives. Needs the bridge's addressing for a DM to a node (see open questions).
4. **Contacts UI:** linking a node and a nick into one person.
5. **bare-meshtastic gaps** (better fixed upstream, in holepunchto/bare-meshtastic):
   - reactions and replies: `Data` needs the reply-to ID and emoji flag fields;
   - an event for every packet received, so `Heard` sees all traffic;
   - `from` on `ack`, to tell "relayed" from "delivered";
   - an event when a packet has gone out over the air, for a "sent" state.
6. **Reactions:** over LoRa once bare-meshtastic supports them; over IRC as a short text message.

## Open questions

- How does an IRC user address a direct message to a node through the motaba bridge? The user can DM their own T1000-E from IRC, so it works, but ekho needs the exact target. Until then, IRC fallback needs a contact with a nick.
- Which IRC channel does motaba mirror the mesh channel to? `app.ts` uses `#mesh` as a placeholder.
- Does irc.motaba.net enforce registered nicks?
- Can the T1000-E sign an arbitrary message with its key (XEdDSA), asked over Bluetooth? That would let app users verify each other on IRC.
- Would motaba add a verified nick-to-node link?
- What window should "recently heard" use? 15 minutes is a placeholder.
