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

// What a page says about itself, from its Open Graph tags or its title.
export interface Preview {
  url: string
  site: string
  title: string
  description: string | null
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
    description: clean(meta('og:description') ?? meta('description'), 200)
  }
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
