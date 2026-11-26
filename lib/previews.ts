import EventEmitter from 'bare-events'
import b4a from 'b4a'
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

// Where previews are kept between sessions, by link (lib/kept.ts, a
// Hyperbee): small, so a picture is kept only up to SMALL.
export interface Kept {
  get(url: string): Promise<KeptPreview | null>
  put(url: string, value: KeptPreview): Promise<unknown>
}

export interface KeptPreview {
  // When it was fetched.
  at: number
  // Null: the link had nothing to show.
  preview: Preview | null
  // The picture, base64, with its file extension, if small enough to keep.
  picture: string | null
  ext: string | null
}

// The biggest picture kept, and how long a preview, or a link with none,
// is kept before it's fetched again.
const SMALL = 64 * 1024
const FRESH = 7 * 24 * 60 * 60 * 1000
const FRESH_NONE = 24 * 60 * 60 * 1000

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

// Link previews: a page's title, description and image, or a linked image
// itself. Fetched once each, and kept for the session; kept beyond it too,
// with a small picture, when given `kept`. A page that has nothing to show is
// remembered as null, and the link shows plain; one that can't be reached is
// tried again next session.
// Fetching tells the site this device's address, as any messenger's previews
// do.
//
// Events: preview (url), when one is ready to show.
export default class Previews extends EventEmitter {
  fetch: Fetch
  save: Save | null
  kept: Kept | null
  now: () => number
  _known: Map<string, Preview | null>
  _pending: Set<string>
  // The picture of each preview fetched this session, to keep with it.
  _pictures: Map<string, { bytes: Uint8Array; ext: string }>

  // Without `save`, previews have no images; without `kept`, they last the
  // session.
  constructor(fetch: Fetch, opts: { save?: Save; kept?: Kept; now?: () => number } = {}) {
    super()
    this.fetch = fetch
    this.save = opts.save ?? null
    this.kept = opts.kept ?? null
    this.now = opts.now ?? Date.now
    this._known = new Map()
    this._pending = new Set()
    this._pictures = new Map()
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
      const kept = await this._fromKept(url)
      if (kept !== undefined) {
        result = kept
      } else {
        result = await this._preview(url)
        await this._keepFor(url, result)
      }
    } catch {
      // Unreachable, slow or refused: the link shows plain, and is tried
      // again next session.
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

  // A preview kept from before, if fresh: its picture written back to a
  // file to show. Undefined if there's none to use.
  async _fromKept(url: string): Promise<Preview | null | undefined> {
    if (this.kept === null) return undefined
    const kept = await this.kept.get(url)
    if (kept === null) return undefined
    const age = this.now() - kept.at
    if (age > (kept.preview === null ? FRESH_NONE : FRESH)) return undefined
    if (kept.preview === null) return null
    const found = { ...kept.preview, image: null as string | null }
    if (kept.picture !== null && this.save !== null) {
      found.image = await this.save(name(url) + '.' + kept.ext, b4a.from(kept.picture, 'base64'))
    } else if (found.imageUrl !== null) {
      // Too big to keep: fetched again.
      try {
        found.image = await this._image(found.imageUrl)
      } catch {}
    }
    return found
  }

  async _keepFor(url: string, found: Preview | null): Promise<void> {
    if (this.kept === null) return
    const picture = this._pictures.get(found?.imageUrl ?? url) ?? null
    const small = picture !== null && picture.bytes.byteLength <= SMALL
    await this.kept.put(url, {
      at: this.now(),
      preview: found === null ? null : { ...found, image: null },
      picture: small ? b4a.toString(picture.bytes, 'base64') : null,
      ext: small ? picture.ext : null
    })
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
    this._pictures.set(url, { bytes, ext: TYPES[type] })
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
