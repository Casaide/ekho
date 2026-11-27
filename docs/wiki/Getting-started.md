# Getting started

## Install

- **Android:** the APK from the [latest release](https://github.com/Casaide/ekho/releases/latest). Android 13 or later.
- **Mac:** the zip from the same release. Apple Silicon Macs only. It's signed ad hoc, so macOS asks once before opening it.

## Pair your radio

ekho replaces the Meshtastic app on your phone, as the radio pairs with one phone at a time. **Disconnect it from the Meshtastic app first.**

1. Open ekho and tap **start messaging**. Allow Bluetooth and notifications when asked.
2. ekho finds the radio and connects. The radio tab shows it, its channels, and the nodes it hears.

If it doesn't connect, see [[Troubleshooting]].

## Log in to IRC

IRC is the fallback when no radio is heard, and how you reach people who aren't on the mesh.

1. Open the IRC setup (the `irc` row in the radio tab).
2. Enter your nick and password. Only registered nicks may stay on `irc.motaba.net`: if yours isn't, register it with NickServ from any IRC client first.
3. ekho logs in with SASL, joins `#bulgaria`, and lists the server's other channels to join.

Your password stays on the device and is never logged.

## Keep it running

On Android, ekho keeps a small notification while it runs in the background, so messages still arrive and notify you. See [[Messaging]] for what notifies.
