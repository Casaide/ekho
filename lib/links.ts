// Links in a message, and what a page says about itself for a preview.

// http(s) addresses, and bare www. ones. Punctuation that ends a sentence is
// left out, and a closing bracket unless the link opened one.
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi

export interface Part {
  text: string
  // The address to open, for a link: `www.` ones get https.
  url: string | null
}

// A message split into text and links, in order.
export function parts(text: string): Part[] {
  const result: Part[] = []
  let at = 0
  for (const match of text.matchAll(URL)) {
    const link = trim(match[0])
    const start = match.index!
    if (start > at) result.push({ text: text.slice(at, start), url: null })
    result.push({ text: link, url: link.startsWith('www.') ? 'https://' + link : link })
    at = start + link.length
  }
  if (at < text.length) result.push({ text: text.slice(at), url: null })
  return result
}

export function links(text: string): string[] {
  return parts(text)
    .filter((p) => p.url !== null)
    .map((p) => p.url!)
}

function trim(link: string): string {
  let end = link.length
  while (end > 0 && /[.,;:!?'*]/.test(link[end - 1])) end--
  // `(see https://a.b/c)`: the bracket is the sentence's, not the link's.
  if (link[end - 1] === ')' && !link.slice(0, end).includes('(')) end--
  return link.slice(0, end)
}

// A link to a sound or a video, by its file's extension, to play in place.
export type Media = 'audio' | 'video'

const MEDIA: Record<string, Media> = {
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mov: 'video'
}

export function media(url: string): Media | null {
  const path = url.replace(/[?#].*$/, '')
  const dot = path.lastIndexOf('.')
  if (dot <= path.indexOf('//') + 2 || path.lastIndexOf('/') > dot) return null
  return MEDIA[path.slice(dot + 1).toLowerCase()] ?? null
}

// What a page says about itself, from its Open Graph tags or its title.
export interface Preview {
  url: string
  site: string
  // Null for a link to an image itself.
  title: string | null
  description: string | null
  // The page's image (og:image), absolute, to fetch; and once fetched, the
  // file it's kept in.
  imageUrl: string | null
  image: string | null
}

// From the start of a page's HTML. Null if it has no title to show.
export function preview(url: string, html: string): Preview | null {
  const meta = (name: string) => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const key = attribute(tag, 'property') ?? attribute(tag, 'name')
      if (key !== null && key.toLowerCase() === name) return attribute(tag, 'content')
    }
    return null
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? null
  const title = clean(meta('og:title') ?? meta('twitter:title') ?? titleTag, 120)
  if (title === null) return null

  return {
    url,
    site: clean(meta('og:site_name'), 60) ?? host(url),
    title,
    description: clean(meta('og:description') ?? meta('description'), 200),
    imageUrl: absolute(url, meta('og:image') ?? meta('twitter:image')),
    image: null
  }
}

// An address on a page, made absolute against the page's. Null if it isn't
// an http(s) one.
function absolute(page: string, value: string | null): string | null {
  if (value === null) return null
  const link = value.replace(/&amp;/g, '&').trim()
  if (/^https?:\/\//i.test(link)) return link
  const origin = /^(https?:\/\/[^/?#]+)/i.exec(page)![1]
  if (link.startsWith('//')) return origin.split('//')[0] + link
  if (link.startsWith('/')) return origin + link
  return null
}

export function host(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./i, '')
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag)
  return match === null ? null : (match[2] ?? match[3])
}

// Entities decoded, space collapsed, cut to `max` characters.
function clean(value: string | null, max: number): string | null {
  if (value === null) return null
  const text = value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return null
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

// A picture on GitHub, linked to its page: the picture itself, from where
// GitHub serves the raw file. Null for any other link.
export function rawImage(url: string): string | null {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+\.(?:png|jpe?g|gif|webp))(?:\?.*)?$/i
  )
  if (match === null) return null
  const path = match[3].replace(/%2F/gi, '/')
  return 'https://raw.githubusercontent.com/' + match[1] + '/' + match[2] + '/' + path
}

// A YouTube video: its oEmbed address, which gives its title, channel and
// thumbnail without the page, a cookie consent page in the EU. Null for any
// other link.
export function oembed(url: string): string | null {
  if (!/^https:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?|shorts\/)|youtu\.be\/)/i.test(url)) {
    return null
  }
  return 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url)
}

// A link in lines of at most `width` characters, broken after a `/`, `.`,
// `-` or the like where one is near enough, else anywhere. Android wraps a
// long link differently from how bare-native measured it, drawing a line
// more than its box holds, into the card below; lines ending in a newline of
// our own wrap the same everywhere.
export function lines(url: string, width: number): string[] {
  const result: string[] = []
  let rest = url
  while (rest.length > width) {
    let cut = -1
    for (let i = width; i > width / 2; i--) {
      if ('/.-_?&=#'.includes(rest[i - 1])) {
        cut = i
        break
      }
    }
    if (cut === -1) cut = width
    result.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  result.push(rest)
  return result
}
