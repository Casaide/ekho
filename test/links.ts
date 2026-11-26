import tap from 'bare-tap'
import { parts, links, preview, host, media, rawImage, oembed, lines } from '../lib/links.ts'

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
    description: 'LoRa first, IRC fallback',
    imageUrl: null,
    image: null
  })

  t.deepStrictEqual(preview('https://www.motaba.net/x', '<title> motaba </title>'), {
    url: 'https://www.motaba.net/x',
    site: 'motaba.net',
    title: 'motaba',
    description: null,
    imageUrl: null,
    image: null
  })
  t.equal(
    preview(
      'https://a.bg/x',
      '<title>a</title><meta property="og:image" content="/i.png?a=1&amp;b=2">'
    )!.imageUrl,
    'https://a.bg/i.png?a=1&b=2',
    'the page’s image, made absolute'
  )
  t.equal(preview('https://a.bg', '<html></html>'), null, 'nothing to show')
  t.equal(host('https://www.a.bg/b?c'), 'a.bg')
})

test('a link to a sound or a video plays, by its file’s extension', (t) => {
  t.equal(media('https://a.bg/notes/hut.mp3'), 'audio')
  t.equal(media('https://a.bg/voice.OGG?dl=1'), 'audio')
  t.equal(media('https://a.bg/clip.mp4#t=10'), 'video')
  t.equal(media('https://a.bg/page.html'), null)
  t.equal(media('https://mp3.bg/'), null, 'not the host')
  t.equal(media('https://a.bg/mp3/list'), null, 'not a folder')
})

test('a picture on GitHub previews as the picture, from its raw file', (t) => {
  t.equal(
    rawImage('https://github.com/Casaide/ekho/blob/main/docs%2Fscreenshots%2Fphone-thread.png'),
    'https://raw.githubusercontent.com/Casaide/ekho/main/docs/screenshots/phone-thread.png'
  )
  t.equal(rawImage('https://github.com/Casaide/ekho/blob/main/README.md'), null)
  t.equal(rawImage('https://github.com/Casaide/ekho'), null)
})

test('a YouTube video previews from its oEmbed', (t) => {
  t.equal(
    oembed('https://www.youtube.com/watch?v=jqGIDP7ZqHg&list=PLdTsEXMtfOYM'),
    'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=jqGIDP7ZqHg&list=PLdTsEXMtfOYM')
  )
  t.ok(oembed('https://youtu.be/jqGIDP7ZqHg'))
  t.equal(oembed('https://www.youtube.com/@motaba'), null)
})

test('a long link is broken into lines that fit, after a / or the like if near', (t) => {
  t.deepStrictEqual(lines('https://www.youtube.com/watch?v=jqGIDP7ZqHg&list=PLdTsEXMtfOYM', 30), [
    'https://www.youtube.com/watch?',
    'v=jqGIDP7ZqHg&list=',
    'PLdTsEXMtfOYM'
  ])
  t.deepStrictEqual(lines('https://a.bg/' + 'x'.repeat(40), 20), [
    'https://a.bg/',
    'xxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxxxxxx'
  ])
  t.deepStrictEqual(lines('https://a.bg/', 20), ['https://a.bg/'])
})
