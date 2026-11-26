import EventEmitter from 'bare-events'
import type { ModelFiles } from './bergamot.ts'

// A loaded translation model: texts in, translations out, in order.
export interface Model {
  runBatch(texts: string[]): Promise<string[]>
  unload(): Promise<unknown>
}

export type TranslatorState = 'off' | 'downloading' | 'loading' | 'on' | 'failed'

// Messages in Bulgarian, in English, on this device. Off until started; then
// the model is fetched once (`files`, with progress) and loaded (`open`).
// Each text is translated once and kept for the session.
//
// Events: change, when the state or progress changed; translated (text).
export default class Translator extends EventEmitter {
  files: (onprogress: (done: number) => void) => Promise<ModelFiles>
  open: (files: ModelFiles) => Promise<Model>
  state: TranslatorState
  // While downloading, the share done, 0 to 1; when failed, why.
  progress: number
  error: string | null

  _model: Model | null
  _known: Map<string, string>
  _queue: string[]
  _running: boolean

  constructor(
    files: (onprogress: (done: number) => void) => Promise<ModelFiles>,
    open: (files: ModelFiles) => Promise<Model>
  ) {
    super()
    this.files = files
    this.open = open
    this.state = 'off'
    this.progress = 0
    this.error = null
    this._model = null
    this._known = new Map()
    this._queue = []
    this._running = false
  }

  async start(): Promise<void> {
    if (this.state !== 'off' && this.state !== 'failed') return
    this._set('downloading')
    try {
      const files = await this.files((done) => {
        this.progress = done
        this.emit('change')
      })
      // Turned off meanwhile: left off.
      if (this.state === 'off') return
      this._set('loading')
      const model = await this.open(files)
      if (this.state === 'off') return void (await model.unload())
      this._model = model
      this._set('on')
      this._run()
    } catch (err) {
      this.error = (err as Error).message
      this._set('failed')
    }
  }

  async stop(): Promise<void> {
    const model = this._model
    this._model = null
    this._queue = []
    this._set('off')
    if (model !== null) await model.unload()
  }

  // The English for a Bulgarian text: ready, or null while it's on its way
  // (`translated` says when). Null too for anything else, or when off.
  english(text: string): string | null {
    const known = this._known.get(text)
    if (known !== undefined) return known
    if (bulgarian(text)) this.translate(text)
    return null
  }

  // Translate this text whatever it looks like, when asked: the English
  // comes from `english` once `translated` says so.
  translate(text: string): void {
    if (this.state === 'off' || this._known.has(text) || this._queue.includes(text)) return
    this._queue.push(text)
    this._run()
  }

  // One at a time, in the order asked: what's waiting goes as one batch.
  async _run(): Promise<void> {
    if (this._running || this._model === null || this._queue.length === 0) return
    this._running = true
    const texts = this._queue.splice(0, 16)
    try {
      // The model reads Cyrillic: Bulgarian typed in Latin letters is
      // spelled in Cyrillic first.
      const out = await this._model.runBatch(texts.map((t) => (latin(t) ? cyrillic(t) : t)))
      texts.forEach((text, i) => {
        this._known.set(text, out[i].trim())
        this.emit('translated', text)
      })
    } catch {
      // A text the model can't take stays in Bulgarian.
      for (const text of texts) this._known.set(text, text)
    }
    this._running = false
    this._run()
  }

  _set(state: TranslatorState): void {
    this.state = state
    if (state !== 'failed') this.error = null
    this.emit('change')
  }
}

// Mostly Cyrillic letters, so most likely Bulgarian on this mesh.
export function bulgarian(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? []
  const cyrillic = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length
  return cyrillic >= 2 && cyrillic * 2 > letters.length
}

// Mostly Latin letters.
function latin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? []
  return letters.filter((c) => /[a-z]/i.test(c)).length * 2 > letters.length
}

// Bulgarian typed in Latin letters, as people do in chat, in Cyrillic: the
// official transliteration backwards, plus chat habits (4 for ч, 6 for ш,
// w for в, q for я). Rough, but enough for the model to read.
const PAIRS: [string, string][] = [
  ['sht', 'щ'],
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['zh', 'ж'],
  ['ts', 'ц'],
  ['yu', 'ю'],
  ['ju', 'ю'],
  ['ya', 'я'],
  ['ja', 'я'],
  ['a', 'а'],
  ['b', 'б'],
  ['c', 'ц'],
  ['d', 'д'],
  ['e', 'е'],
  ['f', 'ф'],
  ['g', 'г'],
  ['h', 'х'],
  ['i', 'и'],
  ['j', 'й'],
  ['k', 'к'],
  ['l', 'л'],
  ['m', 'м'],
  ['n', 'н'],
  ['o', 'о'],
  ['p', 'п'],
  ['q', 'я'],
  ['r', 'р'],
  ['s', 'с'],
  ['t', 'т'],
  ['u', 'у'],
  ['v', 'в'],
  ['w', 'в'],
  ['x', 'кс'],
  ['y', 'ъ'],
  ['z', 'з']
]

export function cyrillic(text: string): string {
  // 4 and 6 stand for letters only inside a word, not in "at 6".
  const spelled = text
    .replace(/(?<=\p{L})4|4(?=\p{L})/gu, 'ч')
    .replace(/(?<=\p{L})6|6(?=\p{L})/gu, 'ш')
  let out = ''
  let i = 0
  outer: while (i < spelled.length) {
    for (const [from, to] of PAIRS) {
      const part = spelled.slice(i, i + from.length)
      if (part.toLowerCase() !== from) continue
      out +=
        part[0] === part[0].toUpperCase() && part[0] !== part[0].toLowerCase()
          ? to[0].toUpperCase() + to.slice(1)
          : to
      i += from.length
      continue outer
    }
    out += spelled[i]
    i++
  }
  return out
}
