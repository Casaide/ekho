import tap from 'bare-tap'
import { mentions } from '../lib/mentions.ts'

const { test } = tap

test('MeshCore and Meshtastic mentions are found among the text', (t) => {
  t.deepStrictEqual(mentions('@[Root 👾👾]: сам ли си говориш ?'), [
    { text: '@[Root 👾👾]', name: 'Root 👾👾', node: null },
    { text: ': сам ли си говориш ?', name: null, node: null }
  ])
  t.deepStrictEqual(mentions('hi @!0E8666A6, see you'), [
    { text: 'hi ', name: null, node: null },
    { text: '@!0E8666A6', name: null, node: '!0e8666a6' },
    { text: ', see you', name: null, node: null }
  ])
})

test('what only looks like a mention is text', (t) => {
  t.deepStrictEqual(mentions('mail me@x.bg, @[] or @!0e8666a6ff'), [
    { text: 'mail me@x.bg, @[] or @!0e8666a6ff', name: null, node: null }
  ])
})
