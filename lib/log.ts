import EventEmitter from 'bare-events'

export type Level = 'info' | 'warn' | 'error'

export interface Entry {
  time: number
  level: Level
  text: string
}

// Everything the app reports, kept in memory so it can be read and copied
// from the app itself. Holds the last `keep` entries.
//
// Events: entry (entry).
export default class Log extends EventEmitter {
  entries: Entry[]
  keep: number
  now: () => number

  constructor(opts: { keep?: number; now?: () => number } = {}) {
    super()

    this.entries = []
    this.keep = opts.keep ?? 1000
    this.now = opts.now ?? Date.now
  }

  info(...args: unknown[]): void {
    this.add('info', args)
  }

  warn(...args: unknown[]): void {
    this.add('warn', args)
  }

  error(...args: unknown[]): void {
    this.add('error', args)
  }

  add(level: Level, args: unknown[]): Entry {
    const entry = { time: this.now(), level, text: args.map(format).join(' ') }

    this.entries.push(entry)
    if (this.entries.length > this.keep) this.entries.shift()

    this.emit('entry', entry)
    return entry
  }

  // Copy console output into the log as well, so nothing printed is missed.
  // Returns a function that puts the console back.
  capture(target: Console = console): () => void {
    const original = { log: target.log, info: target.info, warn: target.warn, error: target.error }

    target.log = (...args: unknown[]) => (this.add('info', args), original.log.apply(target, args))
    target.info = (...args: unknown[]) => (
      this.add('info', args),
      original.info.apply(target, args)
    )
    target.warn = (...args: unknown[]) => (
      this.add('warn', args),
      original.warn.apply(target, args)
    )
    target.error = (...args: unknown[]) => (
      this.add('error', args),
      original.error.apply(target, args)
    )

    return () => Object.assign(target, original)
  }

  toString(): string {
    return this.entries.map(line).join('\n')
  }
}

export function line(entry: Entry): string {
  return new Date(entry.time).toISOString() + ' ' + entry.level.padEnd(5) + ' ' + entry.text
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
