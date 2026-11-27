// What's typed in the message box, when it's an IRC-style command: a line
// starting with `/`. `//text` sends `/text` as a message.

export type Command =
  | { name: 'whois'; nick: string }
  | { name: 'me'; text: string }
  | { name: 'msg'; nick: string; text: string }
  | { name: 'join'; channel: string }
  | { name: 'part'; channel: string | null }
  // Known but missing what it needs: how to use it.
  | { name: 'usage'; usage: string }
  | { name: 'unknown'; command: string }

export const USAGE = '/whois nick · /me does · /msg nick text · /join #channel · /part'

// The commands, with what each does, for completing them.
export const COMMANDS: [string, string][] = [
  ['/whois', 'who a nick is'],
  ['/me', 'an action'],
  ['/msg', 'message a nick'],
  ['/join', 'join a channel'],
  ['/part', 'leave a channel']
]

// What could complete a line being typed: commands while the first word is
// typed, then a nick for /whois and /msg or a channel for /join and /part,
// from those given. Each is the whole line it would make.
export function completions(
  input: string,
  opts: { nicks?: string[]; channels?: string[] } = {}
): string[] {
  if (!input.startsWith('/') || input.startsWith('//')) return []
  const space = input.indexOf(' ')
  if (space === -1) {
    const typed = input.toLowerCase()
    return COMMANDS.map(([c]) => c).filter((c) => c.startsWith(typed) && c !== typed)
  }
  const name = input.slice(0, space).toLowerCase()
  const rest = input.slice(space + 1)
  // Only the first argument completes.
  if (rest.includes(' ')) return []
  const pool =
    name === '/whois' || name === '/msg' || name === '/wi' || name === '/query'
      ? (opts.nicks ?? [])
      : name === '/join' || name === '/part' || name === '/j' || name === '/leave'
        ? (opts.channels ?? [])
        : []
  const typed = rest.toLowerCase()
  return pool
    .filter((p) => p.toLowerCase().startsWith(typed) && p.toLowerCase() !== typed)
    .slice(0, 6)
    .map((p) => input.slice(0, space) + ' ' + p)
}

// Null when it's a message, not a command.
export function command(input: string): Command | null {
  const line = input.trim()
  if (!line.startsWith('/') || line.startsWith('//')) return null
  const [word, ...rest] = line.slice(1).split(/\s+/)
  const name = word.toLowerCase()
  const text = line.slice(word.length + 1).trim()
  if (name === 'whois' || name === 'wi') {
    return rest[0] ? { name: 'whois', nick: rest[0] } : { name: 'usage', usage: '/whois nick' }
  }
  if (name === 'me') {
    return text ? { name: 'me', text } : { name: 'usage', usage: '/me does something' }
  }
  if (name === 'msg' || name === 'query') {
    const body = text.slice((rest[0] ?? '').length).trim()
    return rest[0] && body
      ? { name: 'msg', nick: rest[0], text: body }
      : { name: 'usage', usage: '/msg nick text' }
  }
  if (name === 'join' || name === 'j') {
    if (!rest[0]) return { name: 'usage', usage: '/join #channel' }
    return { name: 'join', channel: rest[0].startsWith('#') ? rest[0] : '#' + rest[0] }
  }
  if (name === 'part' || name === 'leave') {
    const channel = rest[0] ? (rest[0].startsWith('#') ? rest[0] : '#' + rest[0]) : null
    return { name: 'part', channel }
  }
  return { name: 'unknown', command: '/' + word }
}

// A message typed as `//text`, which sends `/text`.
export function literal(input: string): string {
  const line = input.trim()
  return line.startsWith('//') ? line.slice(1) : line
}
