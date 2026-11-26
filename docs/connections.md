# Connections: radio and IRC

How ekho keeps its two connections up, and why. Read this before touching `lib/link.ts`, `lib/radio.ts`, `lib/irc.ts` or the link wiring in `app.ts`.

## What went wrong before

Connection state lived in three places (the app, the UI and the Messenger), nothing remembered what the user wanted, and Android's lifecycle wasn't handled. On a phone that meant:

- **Pausing silently killed IRC.** bare-ndk's `Activity.java` calls `suspend()` in `onPause`, so leaving the app (another app, the notification shade, the lock screen) stops the event loop. The IRC socket goes quiet, and Android or the server drops it ("software caused connection abort").
- **Closing left a ghost.** `onDestroy` calls `System.exit(0)` with no QUIT. motaba keeps the nick logged in for minutes, so the next login gets `433 Nickname is already in use`.
- **Nothing came back** after a pause or a restart, and the screen said "irc off" or "connect" while the truth was elsewhere.

## The model

`lib/link.ts` is one connection that should stay up while it's wanted. Each link has a single state, which is what the screen shows:

| State        | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `off`        | Not wanted, or paused (detail `paused`).                                |
| `connecting` | An attempt is under way; `detail` says which step.                      |
| `on`         | Connected and usable.                                                   |
| `waiting`    | Dropped or failed; retrying in 5 s, then 15 s, then every minute.       |
| `failed`     | Needs the user (wrong password, Bluetooth off or blocked). No retrying. |

- `start()` wants it up; `stop()` doesn't, and closes it. A connection that opens after `stop()` is closed straight away.
- `pause()` closes it but keeps wanting it; `resume()` reconnects. ekho no longer pauses IRC when Android suspends it (see below); the methods stay for links that need them.

## Android pauses: keep IRC connected

motaba has no history (`CAP LS` offers only `sasl=PLAIN`, and `005` has no `CHATHISTORY`), so anything said while ekho isn't connected is lost for good. An earlier version quit IRC on every pause and logged back in on return; on a phone that's a gap every time the shade comes down or another app opens.

Now IRC stays connected through a pause. The system keeps the socket and buffers what the server sends, so a pause shorter than the server's ping timeout (a couple of minutes) loses nothing. On return, `Irc.probe()` sends a PING: any line back, buffered ones included, means it's alive. No answer within 5 s destroys the socket, and the IRC link's first retry is immediate, so it's back in about a second, reclaiming the nick from the dead session if need be. QUIT is sent only on `exit`.

- A connect function rejects with `FatalError` for what only the user can fix; anything else is retried.

What's wanted is saved (`wanted.radio`, `wanted.irc` in `state.json`). Connecting or logging in sets it, disconnecting or logging out clears it, and on start ekho brings back what was wanted.

## IRC

- **SASL PLAIN during the handshake** when the server offers it (motaba does): `CAP LS 302`, `CAP REQ :sasl`, `AUTHENTICATE PLAIN`, then the credentials; `900` means logged in. A wrong password is `904`, reported as `LOGIN_FAILED` and treated as fatal. Without SASL, ekho falls back to NickServ `IDENTIFY` after `001`.
- **Reclaiming a ghosted nick:** on `433` with a password, ekho logs in as `nick_`, asks NickServ to `GHOST` the old session, then takes the nick back.
- **Dead connections:** a server silent for 2 minutes is pinged; silent 30 s more, the socket is destroyed and the link retries.
- The link counts IRC as `on` at `001`. `messenger.irc.nick` is the nick in use.

## Radio

- The radio link stays up through a pause: Bluetooth outlives it, and the T1000-E queues packets for the phone until ekho reads them.
- A disconnect after syncing destroys the bare-meshtastic client, whose `close` tells the link, which retries while the radio is wanted.
- Bluetooth off, unsupported or not permitted is fatal, with a message saying what to do.
- See AGENTS.md for what the bare-meshtastic BLE example leaves out (service by UUID, MTU 512, hang up on failure).

## Staying alive in the background

Bare doesn't stop when suspended: `suspend` is an event, and the loop carries on while it has work, such as an open socket or a Bluetooth connection. It blocks only once it's idle. What stops ekho on Android is the system freezing or killing a backgrounded app. A foreground service prevents that, so `packages/bare-foreground-service-android` runs one while the radio or IRC is wanted. Its ongoing notification reads "ekho is listening for messages" and shows each link's state. Android lets only an app on screen start or change the service, so the notification catches up when ekho comes back. Swiping ekho away from recents stops the service, and ekho with it.

Messages to you, and channel lines that name you, then show as notifications (`lib/notifier.ts`, through `packages/bare-notifications-android`). Tapping one opens its conversation. Reading a conversation removes its notification.

Both are native addons in C++ with a little Java, built like bare-navigation-android. They live in this repo until they have their own; `scripts/build-addons.sh` compiles them in CI before `npm install` copies them in (`install-links` in `.npmrc`). Neither has run on a phone yet.

## Testing

- `test/link.ts`: every state change, with timers run by hand.
- `test/irc.ts`: SASL, a wrong password, the fallback to NickServ, reclaiming, the silence check.
- `test/ui.ts`: the setup section through each link state, on real bare-native.
- The whole app was also driven against a scripted IRC server under Node: auto-login, a drop (reconnected at once), a pause it survives, a pause the server gave up on, a wrong password.
