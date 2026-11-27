# Troubleshooting

**The radio won't connect.**
Make sure the Meshtastic app isn't connected to it: the radio pairs with one phone at a time, and stops advertising while paired. Close the Meshtastic app, or turn Bluetooth off and on, and ekho tries again.

**It says connected, but I walked away from the radio.**
Android reports the loss some seconds later, up to about 20. Then the radio shows as gone, and messages go over IRC.

**I see each IRC line twice.**
The bridge's own radio (named `irc`) repeats IRC lines onto the mesh. While you're on IRC, ekho skips those copies. If you still see doubles from one person, join their node and nick into one person: see [[People]].

**My direct message failed straight away.**
Their node isn't known to your radio, and they have no IRC nick to fall back on. Add their nick to their contact, or wait until your radio hears them.

**Translation says failed.**
The model download needs the internet once. Tap `bg→en` again to retry. The radio tab shows the error.

**Where's the log?**
The radio tab's **view log ›** shows what ekho did, with times. Send it with any bug report: [open an issue](https://github.com/Casaide/ekho/issues).
