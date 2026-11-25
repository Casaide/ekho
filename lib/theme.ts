// Dark, terminal look from the mockups: monospace everywhere, phosphor green
// for LoRa and our own messages, amber for IRC, red for failures.
export const colors = {
  ground: '#0A0D0C',
  panel: '#111614',
  line: '#1E2522',
  edge: '#2A332F',
  text: '#D8E2DD',
  soft: '#A9B5B0',
  muted: '#7C8A84',
  accent: '#5CF29B',
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

export const font = fonts[Bare.platform] ?? 'monospace'
