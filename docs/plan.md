# ekho plan

What we're building, in order. Each phase is usable on its own. Tick items off as they land, and keep this in step with `AGENTS.md`.

## Phase 1: LoRa messenger with IRC fallback

The app replaces the Meshtastic app on the phone, and adds IRC when no nodes are heard.

- [x] Core: messenger with the routing rule, delivery states, retry and send via IRC (`lib/messenger.ts`)
- [x] IRC client with NickServ register and identify (`lib/irc.ts`)
- [x] Last-heard tracking and contacts (`lib/heard.ts`, `lib/contacts.ts`)
- [x] First bare-native UI and app wiring (written, not yet run)
- [ ] Run on desktop with a T1000-E over USB; fix what breaks
- [x] Android Bluetooth permissions in the manifest; APK built in CI, signed releases on `v*` tags
- [ ] Run on a phone over Bluetooth; fix what breaks
- [x] Persistence: contacts, threads, IRC credentials (password stays on the device)
- [ ] IRC setup flow, plus a self-test that sends a code from your nick to your own node through the bridge
- [x] Contacts UI: every known address on the contact page and on each message, join two contacts as one person, optional alias
- [ ] Reactions and replies on LoRa; reactions over IRC as a new text message
- [ ] Mockup fidelity: radio screen, IRC setup screen, light mode

Upstream, in bare-meshtastic (see `docs/design.md` for detail):

- [ ] Reply-to ID and emoji flag on `Data`
- [ ] An event for every packet received, on any port
- [ ] `from` on `ack`
- [ ] An event when a packet is sent over the air
- [ ] Whether a packet was encrypted per contact

## Phase 2: big files between ekho users (mailbox pattern, MVP)

- [ ] Mailbox secret per install; address derived from it
- [ ] Share the address in a private-port LoRa direct message (accepted only if encrypted per contact), or by QR code
- [ ] Store contacts' addresses; attach button greyed out until a contact's address is known
- [ ] Send: encrypted Hyperdrive or Hypercore, plus a note with its keys sealed to the recipient's address, in a fresh core announced on the address topic
- [ ] Receive: inbox on our own address topic, open notes, replicate the drive
- [ ] Inbox open only while ekho is in the foreground

## Experiment: over-the-air updates with Pear

Ship JavaScript changes without a new APK: the signed APK is the native shell, and Pear delivers the app code inside it, so a published release reaches the phone automatically.

- [ ] Check how far Pear on mobile has got, and how it fits a bare-native app built with bare-build
- [ ] Load the app code from a Pear release instead of the bundle, keeping the bundle as the fallback when offline
- [ ] Decide how updates are trusted (signed releases from our key only) and how a bad update is rolled back

## Later

- Mirrors (blind peers) so notes and files wait for a recipient who's offline
- Shared folders on Hyperdrive. IPFS was considered and rejected: content also needs pinning to stay reachable, and it has no privacy (anyone with the CID can fetch it, and the network sees who asks)
- Group topics for private Meshtastic channels (public channels share the default key, so they get none)
- Rooftop or home hub: an always-on mailbox, announcing on the same pair topics
- MeshCore and Nostr adapters
- Signed identity between ekho users, if the T1000-E can sign
- A verified nick-to-node link in the motaba bridge (needs motaba)
