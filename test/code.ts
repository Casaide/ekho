import tap from 'bare-tap'
import { format, parse } from '../lib/code.ts'

const { test } = tap

test('a linking code reads as two groups of five, and parses back however typed', (t) => {
  const code = format(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
  t.equal(code, 'abcde-fghjk')
  t.equal(parse('ABCDE FGHJK'), 'abcdefghjk')
  t.equal(parse(' abcde-fghjk '), 'abcdefghjk')
  t.equal(parse('abcde-fghj'), null, 'too short')
  t.equal(parse('abcde-fghj0'), null, 'not in the alphabet')
})
