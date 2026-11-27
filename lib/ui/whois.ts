import type { Whois } from '../irc.ts'

// A whois answer, a line per thing known.
export function whoisText(nick: string, info: Whois | null): string {
  if (info === null) return nick + ': no such nick, or no IRC to ask'
  const lines = [info.nick + (info.realname ? ' (' + info.realname + ')' : '')]
  if (info.user !== null) lines.push(info.user + '@' + info.host)
  if (info.account !== null) lines.push('logged in as ' + info.account)
  if (info.channels.length > 0) lines.push('in ' + info.channels.join(' '))
  if (info.idle !== null) lines.push('idle ' + idle(info.idle))
  if (info.away !== null) lines.push('away: ' + info.away)
  if (info.server !== null) lines.push('on ' + info.server)
  return lines.join('\n')
}

function idle(seconds: number): string {
  if (seconds < 60) return seconds + 's'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm'
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm'
}
