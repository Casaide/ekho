// Linking codes: ten characters a person can read off one screen and type on
// another, from an alphabet without look-alikes (no 0, 1, i, l or o). About
// 49 bits: the code is what keys the pairing, so it must not be guessable in
// the minutes it's open.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const LENGTH = 10

// A code from random bytes, as `xxxxx-xxxxx`.
export function format(random: Uint8Array): string {
  let code = ''
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[random[i] % ALPHABET.length]
  return code.slice(0, 5) + '-' + code.slice(5)
}

// A code as typed: any case, spaces or dashes. Null if it isn't one.
export function parse(typed: string): string | null {
  const code = typed.toLowerCase().replace(/[\s-]/g, '')
  if (code.length !== LENGTH) return null
  for (const char of code) {
    if (!ALPHABET.includes(char)) return null
  }
  return code
}
