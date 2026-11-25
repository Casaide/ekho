---
name: ekho
description: Use when working on ekho, the LoRa-first messenger with IRC fallback - adding features, fixing device bugs, or touching routing, IRC, the Meshtastic radio link or the bare-native UI.
---

# Working on ekho

AGENTS.md at the repo root has the product decisions, layout and open questions. Read it first. This skill is the working loop.

## Before changing behaviour

- Check the change against "Decisions already made" in AGENTS.md. Routing is one rule; there is no automatic fallback, no dedupe and no sending both ways. If a request conflicts with one of these, ask the user before changing it.
- Keep the core (`lib/messenger.ts`, `lib/irc.ts`, `lib/heard.ts`, `lib/contacts.ts`) free of platform code, so it stays testable with fakes. Platform code belongs in `lib/radio.ts`, `lib/ui.ts` and `app.ts`.

## Writing code

- TypeScript with erasable syntax only: no enums, namespaces, parameter properties or `private`. ESM with explicit `.ts` import paths; `import type` for types.
- Import CommonJS packages by default import, then destructure.
- Holepunch house style, as set out in the js-house-style skill in this repo: small modules, `(required, opts = {})` constructors, fields declared up front, no defensive checks, `b4a` not `Buffer`, `bare-events` for emitters.
- Format with prettier-config-holepunch: no semicolons, single quotes, 100 columns.

## Testing

1. Add or change a bare-tap test in `test/` that uses the module the way the app does. Fakes live in `test/helpers.ts` (`FakeRadio`, `FakeStream`, `clock`).
2. Register new test files in `test.ts`.
3. Run `npm test`, `npm run lint` and `npm run typecheck`.
4. Without npm access, the core can still be checked under Node 22.18+ with `node --test test.ts`, given stand-in modules for `bare-events`, `b4a` and `bare-tap` in a parent `node_modules`. Never commit the stand-ins.

## Upstream first

If the fix belongs in bare-meshtastic (reactions, replies, a per-packet event, the ack sender, a sent-over-air event), make it there and depend on the release rather than patching around it in ekho.

## Finishing

Update AGENTS.md when a decision, an open question or the state of verification changes. It is how the next session knows where things stand.
