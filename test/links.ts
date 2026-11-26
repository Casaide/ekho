import tap from 'bare-tap'
import { parts, links, preview, host } from '../lib/links.ts'

const { test } = tap

test('links are found in a message, without the punctuation around them', (t) => {
  t.deepStrictEqual(links('see https://github.com/Casaide/ekho.'), [
    'https://github.com/Casaide/ekho'
  ])
  t.deepStrictEqual(links('(https://meshtalk.motaba.net/d/133) and www.motaba.net!'), [
    'https://meshtalk.motaba.net/d/133',
    'https://www.motaba.net'
  ])
  t.deepStrictEqual(links('https://en.wikipedia.org/wiki/LoRa_(radio)'), [
    'https://en.wikipedia.org/wiki/LoRa_(radio)'
  ])
  t.deepStrictEqual(links('no links here'), [])
  t.deepStrictEqual(
    parts('go to https://a.bg now').map((p) => p.text),
    ['go to ', 'https://a.bg', ' now']
  )
})

test('a preview comes from Open Graph tags, else the title', (t) => {
  const html =
    '<html><head><title>ignored</title>' +
    '<meta property="og:title" content="Casaide/ekho &amp; more">' +
    "<meta property='og:description' content='LoRa first,\n IRC fallback'>" +
    '<meta property="og:site_name" content="GitHub"></head>'
  t.deepStrictEqual(preview('https://github.com/Casaide/ekho', html), {
    url: 'https://github.com/Casaide/ekho',
    site: 'GitHub',
    title: 'Casaide/ekho & more',
    description: 'LoRa first, IRC fallback'
  })

  t.deepStrictEqual(preview('https://www.motaba.net/x', '<title> motaba </title>'), {
    url: 'https://www.motaba.net/x',
    site: 'motaba.net',
    title: 'motaba',
    description: null
  })
  t.equal(preview('https://a.bg', '<html></html>'), null, 'nothing to show')
  t.equal(host('https://www.a.bg/b?c'), 'a.bg')
})
