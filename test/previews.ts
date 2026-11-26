import tap from 'bare-tap'
import Previews from '../lib/previews.ts'
import { settle } from './helpers.ts'

const { test } = tap

function page(html: string, type = 'text/html; charset=utf-8') {
  return {
    ok: true,
    headers: { get: (name: string) => (name === 'content-type' ? type : null) },
    text: async () => html
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

test('a page that fails or isn’t HTML shows the link plain', async (t) => {
  const previews = new Previews(async (url) => {
    if (url.endsWith('png')) return page('', 'image/png')
    throw new Error('unreachable')
  })
  previews.get('https://a.bg/x.png')
  previews.get('https://down.bg')
  await settle()
  t.equal(previews.get('https://a.bg/x.png'), null)
  t.equal(previews.get('https://down.bg'), null)
})
