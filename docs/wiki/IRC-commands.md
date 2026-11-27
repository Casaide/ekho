# IRC commands

A line starting with `/` is a command, never a message. A command ekho doesn't know is named above the box and not sent, so nothing meant for IRC goes over the air by mistake.

While you type a command, it shows in amber, and chips above the box complete it: the commands, then a nick or a channel.

| Command          | Does                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `/whois nick`    | Who they are, shown above the box for you only. Also in their info, as a button. |
| `/me waves`      | An action: `* dom waves`. Over LoRa it goes as that text.                        |
| `/msg nick text` | Opens a conversation with the nick and sends over IRC.                           |
| `/join #channel` | Joins it. The `#` is optional.                                                   |
| `/part`          | Leaves the channel you're in, or `/part #channel`. `#bulgaria` can't be left.    |

To send a message that starts with a slash, type two: `//shrug` sends `/shrug`.

On a linked Mac, commands go through the phone, which holds the IRC connection.
