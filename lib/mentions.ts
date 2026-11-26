// Mentions in a message, as each network writes them: MeshCore `@[Root 👾]`,
// Meshtastic `@!0e8666a6` (a node's ID, so it survives a rename).

const MENTION = /@\[([^\]\n]{1,40})\]|@(![0-9a-f]{8})(?![0-9a-z])/gi

export interface Mention {
  text: string
  // For a mention: the name written, or the node's ID; null for plain text.
  name: string | null
  node: string | null
}

// Text split into plain runs and mentions, in order.
export function mentions(text: string): Mention[] {
  const result: Mention[] = []
  let at = 0
  for (const match of text.matchAll(MENTION)) {
    const start = match.index!
    if (start > at) result.push({ text: text.slice(at, start), name: null, node: null })
    const node = match[2] === undefined ? null : match[2].toLowerCase()
    result.push({ text: match[0], name: match[1] ?? null, node })
    at = start + match[0].length
  }
  if (at < text.length) result.push({ text: text.slice(at), name: null, node: null })
  return result
}
