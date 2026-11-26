import EventEmitter from 'bare-events'
import type { ModelFiles } from './bergamot.ts'

// A loaded translation model: texts in, translations out, in order.
export interface Model {
  runBatch(texts: string[]): Promise<string[]>
  unload(): Promise<unknown>
}

// The most texts waiting, how many go to the model at once, and the pause
// between batches, in milliseconds.
const QUEUE = 60
const BATCH = 8
const PAUSE = 50

export type TranslatorState = 'off' | 'downloading' | 'loading' | 'on' | 'failed'

// Text in one language, in another, on this device, with one model. Off until
// started; then the model is fetched once (`files`, with progress) and
// loaded (`open`). Each text is translated once: kept for the session, and
// beyond it when given `kept`.
//
// Translating runs on its own, never on the way to showing anything:
// `translation` only reads what's known, `want` and `translate` ask. What's
// asked goes newest first, in small batches with a pause between, and at
// most QUEUE wait: older asks are dropped, as the newest are what's on
// screen. `detect`: what `want` takes without being forced; `prepare`: what
// the model is given for a text.
//
// Events: change, when the state or progress changed; translated (texts),
// once per batch.
export default class Translator extends EventEmitter {
  files: (onprogress: (done: number) => void) => Promise<ModelFiles>
  open: (files: ModelFiles) => Promise<Model>
  detect: (text: string) => boolean
  prepare: (text: string) => string
  kept: {
    get(text: string): Promise<string | null>
    put(text: string, out: string): Promise<unknown>
  } | null
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
    open: (files: ModelFiles) => Promise<Model>,
    opts: {
      detect?: (text: string) => boolean
      prepare?: (text: string) => string
      kept?: Translator['kept']
    } = {}
  ) {
    super()
    this.files = files
    this.open = open
    this.detect = opts.detect ?? (() => false)
    this.prepare = opts.prepare ?? ((text) => text)
    this.kept = opts.kept ?? null
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

  // The translation of a text: ready, or null while it's on its way
  // (`translated` says when), and null for one not asked for that `detect`
  // doesn't pick, or when off.
  translation(text: string): string | null {
    return this._known.get(text) ?? null
  }

  // Translate these, oldest first, if `detect` takes them: as they arrive,
  // and the latest of a conversation as it opens.
  want(texts: string[]): void {
    for (const text of texts) {
      if (!this.detect(text) || this._known.has(text) || this._queue.includes(text)) continue
      this._queue.push(text)
    }
    if (this._queue.length > QUEUE) this._queue.splice(0, this._queue.length - QUEUE)
    this._run()
  }

  // Translate this text whatever it looks like: its translation comes from
  // `translation` once `translated` says so.
  translate(text: string): void {
    if (this._known.has(text) || this._queue.includes(text)) return
    this._queue.push(text)
    this._run()
  }

  // One at a time, in the order asked: what's waiting goes as one batch.
  // Newest first, a few at a time: kept ones from the bee, the rest from the
  // model, then a pause so the app keeps up.
  async _run(): Promise<void> {
    if (this._running || this._model === null || this._queue.length === 0) return
    this._running = true
    const texts = this._queue.splice(-BATCH).reverse()
    const fresh: string[] = []
    for (const text of texts) {
      const kept = this.kept === null ? null : await this.kept.get(text)
      if (kept === null) fresh.push(text)
      else this._known.set(text, kept)
    }
    if (fresh.length > 0) {
      try {
        const out = await this._model.runBatch(fresh.map(this.prepare))
        fresh.forEach((text, i) => {
          const english = out[i].trim()
          this._known.set(text, english)
          this.kept?.put(text, english)
        })
      } catch {
        // A text the model can't take stays as written.
        for (const text of fresh) this._known.set(text, text)
      }
    }
    this.emit('translated', texts)
    await new Promise((resolve) => setTimeout(resolve, PAUSE))
    this._running = false
    this._run()
  }

  _set(state: TranslatorState): void {
    this.state = state
    if (state !== 'failed') this.error = null
    this.emit('change')
  }
}

// Some Bulgarian in it, most likely, on this mesh: a word in Cyrillic of two
// letters or more, or two of any length. People mix in English terms
// ("колко е hop to gw"), which the model leaves as they are.
export function bulgarian(text: string): boolean {
  const words = (text.match(/\p{L}+/gu) ?? []).filter((w) => /\p{Script=Cyrillic}/u.test(w))
  return words.length >= 2 || words.some((w) => w.length >= 2)
}

// What the Bulgarian model is given: Bulgarian typed in Latin letters is
// spelled in Cyrillic first, as the model reads Cyrillic.
export function forModel(text: string): string {
  return latin(text) && !bulgarian(text) ? cyrillic(text) : text
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
