import EventEmitter from 'bare-events'
import { preview } from './links.ts'
import type { Preview } from './links.ts'

// The slice of fetch that previews use.
export type Fetch = (
  url: string,
  opts: { headers?: Record<string, string> }
) => Promise<{
  ok: boolean
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

// The most of a page read for its tags, and how long to wait for it.
const MAX = 512 * 1024
const TIMEOUT = 8000

// Link previews, fetched once each and kept for the session. A page that
// can't be had, or has nothing to show, is remembered as null, and the link
// shows plain. Fetching tells the site this device's address, as any
// messenger's previews do.
//
// Events: preview (url), when one is ready to show.
export default class Previews extends EventEmitter {
  fetch: Fetch
  _known: Map<string, Preview | null>
  _pending: Set<string>

  constructor(fetch: Fetch) {
    super()
    this.fetch = fetch
    this._known = new Map()
    this._pending = new Set()
  }

  // The preview if it's ready; null otherwise, starting to fetch it.
  get(url: string): Preview | null {
    const known = this._known.get(url)
    if (known !== undefined) return known
    if (!this._pending.has(url)) this._load(url)
    return null
  }

  async _load(url: string): Promise<void> {
    this._pending.add(url)
    let result: Preview | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const late = new Promise<never>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT)
    })
    try {
      result = await Promise.race([this._fetch(url), late])
    } catch {
      // Unreachable, slow or refused: the link shows plain.
    }
    clearTimeout(timer!)
    this._pending.delete(url)
    this._known.set(url, result)
    if (result !== null) this.emit('preview', url)
  }

  async _fetch(url: string): Promise<Preview | null> {
    const res = await this.fetch(url, {
      headers: { accept: 'text/html', 'user-agent': 'ekho (link preview)' }
    })
    const type = res.headers.get('content-type') ?? ''
    const length = Number(res.headers.get('content-length') ?? 0)
    if (!res.ok || !type.includes('html') || length > MAX) return null
    return preview(url, (await res.text()).slice(0, MAX))
  }
}
