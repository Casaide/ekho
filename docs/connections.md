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
- `pause()` closes it but keeps wanting it; `resume()` reconnects. The app pauses IRC when Android suspends ekho, so it says goodbye properly instead of leaving a ghost, and resumes on return.
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

## Not done: staying alive in the background

ekho stops while it's off screen, so nothing arrives until you come back. Staying alive needs an Android foreground service (a running notification), which bare-ndk doesn't offer: its `Activity` suspends Bare on every pause, and an app can't add a service of its own through bare-build. That's an upstream change to bare-ndk; until then, pausing cleanly and resuming quickly is the best ekho can do.

## Testing

- `test/link.ts`: every state change, with timers run by hand.
- `test/irc.ts`: SASL, a wrong password, the fallback to NickServ, reclaiming, the silence check.
- `test/ui.ts`: the setup section through each link state, on real bare-native.
- The whole app was also driven against a scripted IRC server under Node: auto-login, a drop, a pause and resume, a wrong password.
