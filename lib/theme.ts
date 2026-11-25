// Dark, terminal look from the mockups: monospace everywhere, phosphor green
// for LoRa and our own messages, amber for IRC, red for failures.
const colors = {
  ground: '#0A0D0C',
  panel: '#111614',
  line: '#1E2522',
  // Row dividers, a shade fainter than section lines.
  faint: '#161C1A',
  edge: '#2A332F',
  text: '#D8E2DD',
  soft: '#A9B5B0',
  muted: '#7C8A84',
  accent: '#5CF29B',
  // Path tags: LoRa softer than the accent, so state colours stand out.
  lora: '#8FD9AE',
  irc: '#E8B04B',
  failed: '#F07178'
}

const fonts: Record<string, string> = {
  darwin: 'Menlo',
  ios: 'Menlo',
  android: 'monospace',
  linux: 'monospace',
  win32: 'Consolas'
}

export default { colors, font: fonts[Bare.platform] ?? 'monospace' }
