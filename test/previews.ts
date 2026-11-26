import tap from 'bare-tap'
import Previews from '../lib/previews.ts'
import { settle } from './helpers.ts'

const { test } = tap

function page(body: string, type = 'text/html; charset=utf-8') {
  return {
    ok: true,
    headers: { get: (name: string) => (name === 'content-type' ? type : null) },
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer
  }
}

test('a preview is fetched once, and shown once ready', async (t) => {
  const asked: string[] = []
  const previews = new Previews(async (url) => {
    asked.push(url)
    return page('<meta property="og:title" content="ekho">')
  })
  const ready: string[] = []
  previews.on('preview', (url: string) => ready.push(url))

  t.equal(previews.get('https://a.bg'), null, 'not yet')
  t.equal(previews.get('https://a.bg'), null)
  await settle()

  t.deepStrictEqual(ready, ['https://a.bg'])
  t.equal(previews.get('https://a.bg')!.title, 'ekho')
  t.deepStrictEqual(asked, ['https://a.bg'], 'fetched once')
})

test('a page’s image, and a linked image, are kept in files to show', async (t) => {
  const saved: string[] = []
  const previews = new Previews(
    async (url) =>
      url.endsWith('.png')
        ? page('png bytes', 'image/png')
        : page('<title>a</title><meta property="og:image" content="/card.png">'),
    {
      save: async (name, bytes) => {
        saved.push(name + ':' + bytes.byteLength)
        return '/cache/' + name
      }
    }
  )

  const ready = new Promise((resolve) => {
    let left = 2
    previews.on('preview', () => --left === 0 && resolve(null))
  })
  previews.get('https://a.bg/post')
  previews.get('https://a.bg/photo.png')
  await ready

  const post = previews.get('https://a.bg/post')!
  t.equal(post.title, 'a')
  t.ok(post.image!.endsWith('.png'), 'the page’s image')
  const photo = previews.get('https://a.bg/photo.png')!
  t.equal(photo.title, null, 'an image is its own preview')
  t.ok(photo.image!.startsWith('/cache/'))
  t.equal(saved.length, 2)
})

test('a page that fails or isn’t HTML or an image shows the link plain', async (t) => {
  const previews = new Previews(async (url) => {
    if (url.endsWith('pdf')) return page('', 'application/pdf')
    throw new Error('unreachable')
  })
  previews.get('https://a.bg/x.pdf')
  previews.get('https://down.bg')
  await settle()
  t.equal(previews.get('https://a.bg/x.pdf'), null)
  t.equal(previews.get('https://down.bg'), null)
})
