# ekho plan

What we're building, in order. Each phase is usable on its own. Tick items off as they land, and keep this in step with `AGENTS.md`.

## Phase 1: LoRa messenger with IRC fallback

The app replaces the Meshtastic app on the phone, and adds IRC when no nodes are heard.

- [x] Core: messenger with the routing rule, delivery states, retry and send via IRC (`lib/messenger.ts`)
- [x] IRC client with NickServ register and identify (`lib/irc.ts`)
- [x] Last-heard tracking and contacts (`lib/heard.ts`, `lib/contacts.ts`)
- [x] First bare-native UI and app wiring (written, not yet run)
- [ ] Run on desktop with a T1000-E over USB; fix what breaks
- [ ] Run on a phone over Bluetooth; Android Bluetooth permissions in the manifest
- [ ] Persistence: contacts, threads, IRC credentials (password stays on the device)
- [ ] IRC setup flow, plus a self-test that sends a code from your nick to your own node through the bridge
- [ ] Contacts UI: link a node and a nick into one person
- [ ] Reactions and replies on LoRa; reactions over IRC as a new text message
- [ ] Mockup fidelity: radio screen, IRC setup screen, light mode

Upstream, in bare-meshtastic (see `docs/design.md` for detail):

- [ ] Reply-to ID and emoji flag on `Data`
- [ ] An event for every packet received, on any port
- [ ] `from` on `ack`
- [ ] An event when a packet is sent over the air
- [ ] Whether a packet was encrypted per contact
- [ ] The node public key in user info

## Phase 2: big files between ekho users over P2P

- [ ] Pairing over a LoRa direct message on a private port: pair secret plus challenge, accepted only if encrypted per contact
- [ ] Pair secret stored with the contact; attach icon greyed out until paired
- [ ] Join Hyperswarm on `hash(secret)` only while a transfer is pending
- [ ] Protomux proof: keyed hash of the handshake hash with the secret
- [ ] Sender-held file as an encrypted Hypercore or Hyperdrive; "file offered" notice over LoRa or IRC
- [ ] Contact card by QR code, for pairing in person without LoRa

## Later

- Rooftop or home hub: an always-on mailbox, announcing on the same pair topics
- MeshCore and Nostr adapters
- Signed identity between ekho users, if the T1000-E can sign
- A verified nick-to-node link in the motaba bridge (needs motaba)
