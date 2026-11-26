import EventEmitter from 'bare-events'
import { preview, host, rawImage, oembed } from './links.ts'
import type { Preview } from './links.ts'

// The slice of fetch that previews use.
export type Fetch = (
  url: string,
  opts: { headers?: Record<string, string> }
) => Promise<{
  ok: boolean
  headers: { get(name: string): string | null }
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}>

// Keeps an image's bytes in a file, and gives the file's path: the native
// image view reads images from files.
export type Save = (name: string, bytes: Uint8Array) => Promise<string>

// The most read of a page, for its tags, and of an image; and how long to
// wait for each.
const PAGE = 512 * 1024
const IMAGE = 5 * 1024 * 1024
const TIMEOUT = 8000

// Image types the native image views decode on every platform.
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

// Link previews, fetched once each and kept for the session: a page's title,
// description and image, or a linked image itself. A page that can't be had,
// or has nothing to show, is remembered as null, and the link shows plain.
// Fetching tells the site this device's address, as any messenger's previews
// do.
//
// Events: preview (url), when one is ready to show.
export default class Previews extends EventEmitter {
  fetch: Fetch
  save: Save | null
  _known: Map<string, Preview | null>
  _pending: Set<string>

  // Without `save`, previews have no images.
  constructor(fetch: Fetch, opts: { save?: Save } = {}) {
    super()
    this.fetch = fetch
    this.save = opts.save ?? null
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
    try {
      result = await this._preview(url)
    } catch {
      // Unreachable, slow or refused: the link shows plain.
    }
    this._pending.delete(url)
    this._known.set(url, result)
    if (result !== null) this.emit('preview', url)
  }

  async _preview(url: string): Promise<Preview | null> {
    const raw = rawImage(url)
    if (raw !== null) {
      const image = await this._image(raw)
      if (image === null) return null
      return { url, site: host(url), title: null, description: null, imageUrl: raw, image }
    }
    const embed = oembed(url)
    if (embed !== null) return this._embed(url, embed)

    const res = await timed(
      this.fetch(url, {
        headers: { accept: 'text/html, image/*', 'user-agent': 'ekho (link preview)' }
      })
    )
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const length = Number(res.headers.get('content-length') ?? 0)

    // A link to an image: the image is the preview.
    if (type in TYPES) {
      const image = length <= IMAGE ? await this._keep(url, type, res) : null
      if (image === null) return null
      return { url, site: host(url), title: null, description: null, imageUrl: url, image }
    }

    if (!type.includes('html') || length > PAGE) return null
    const found = preview(url, (await timed(res.text())).slice(0, PAGE))
    if (found === null || found.imageUrl === null) return found
    // The page's image is a bonus: the preview shows without it if it fails.
    try {
      found.image = await this._image(found.imageUrl)
    } catch {}
    return found
  }

  // A video's title, channel and thumbnail, from its oEmbed JSON.
  async _embed(url: string, from: string): Promise<Preview | null> {
    const res = await timed(this.fetch(from, { headers: { accept: 'application/json' } }))
    if (!res.ok) return null
    const about = JSON.parse((await timed(res.text())).slice(0, PAGE))
    if (typeof about.title !== 'string') return null
    const found: Preview = {
      url,
      site: typeof about.provider_name === 'string' ? about.provider_name : host(url),
      title: about.title,
      description: typeof about.author_name === 'string' ? about.author_name : null,
      imageUrl: typeof about.thumbnail_url === 'string' ? about.thumbnail_url : null,
      image: null
    }
    if (found.imageUrl === null) return found
    try {
      found.image = await this._image(found.imageUrl)
    } catch {}
    return found
  }

  async _image(url: string): Promise<string | null> {
    const res = await timed(this.fetch(url, { headers: { accept: 'image/*' } }))
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const length = Number(res.headers.get('content-length') ?? 0)
    if (!res.ok || !(type in TYPES) || length > IMAGE) return null
    return this._keep(url, type, res)
  }

  async _keep(
    url: string,
    type: string,
    res: { arrayBuffer(): Promise<ArrayBuffer> }
  ): Promise<string | null> {
    if (this.save === null) return null
    const bytes = new Uint8Array(await timed(res.arrayBuffer()))
    if (bytes.byteLength > IMAGE) return null
    return this.save(name(url) + '.' + TYPES[type], bytes)
  }
}

// A promise, or an error once it's taken too long.
function timed<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const late = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer!))
}

// A file name for an address: the same address, the same file.
function name(url: string): string {
  let hash = 5381
  for (let i = 0; i < url.length; i++) hash = ((hash * 33) ^ url.charCodeAt(i)) >>> 0
  return hash.toString(16) + url.length.toString(16)
}
