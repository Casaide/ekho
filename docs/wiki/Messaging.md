# Messaging

## Which way a message goes

The route line above the message box says which way your next message will go, and why.

1. **A radio heard in the last 15 minutes:** over LoRa.
2. **None heard:** over IRC, which the bridge carries into the mesh.
3. **Writing to one person whose node your radio doesn't know:** over IRC if they have a nick. The radio can't reach a node it has never heard of.

A message never goes both ways at once: the bridge copies one path onto the other, so people would get it twice.

## What the labels mean

Each message shows how it travelled and where it got to.

| Label                         | Meaning                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `[lora · direct]` `delivered` | Their radio acknowledged it.                                                        |
| `[lora]` `relayed`            | Another radio repeated your channel message. It says nothing about who read it.     |
| `[irc]` `sent`                | IRC took it. IRC has no receipts.                                                   |
| `[lora · 2 hops]`             | Received over the mesh, two hops away.                                              |
| `[lora + irc]`                | The same message from someone you've joined across both paths (see [[People]]).     |
| `failed`                      | Tap it to retry on LoRa or send via IRC. You choose; ekho never switches by itself. |

## Replies and reactions

Hold a message for its details and actions: reply, react, copy, translate. IRC has no replies, so a reply goes as text, written the way people in `#bulgaria` asked for:

```
↩️ "mirco: and the…": 👍
```

## Mentions

`@[name]` (from MeshCore) and `@!0e8666a6` (from Meshtastic's Android app) show as a bold **@name**, amber when it's you. A channel line mentioning you notifies you.

## Links, pictures, sound and video

- Links are tappable, and tapping a message with a link opens it.
- Pages show a small preview: their picture, title and site. YouTube links show the video's title and thumbnail.
- A link to a picture shows the picture.
- A link to a sound or video file (mp3, wav, ogg, m4a, mp4, webm and more) plays in the conversation. That's how to share a voice note: record it, upload it, send the link.
- Previews are kept for a week, so they don't load again.

## Tidy up

Swipe a conversation left in the chats list to take it off the list. It comes back when someone writes in it.
