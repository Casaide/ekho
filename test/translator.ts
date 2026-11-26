import tap from 'bare-tap'
import Translator, { bulgarian, cyrillic, forModel } from '../lib/translator.ts'
import { pickFiles } from '../lib/bergamot.ts'
import { settle } from './helpers.ts'

const { test } = tap

const files = { model: 'm', srcVocab: 'v', dstVocab: 'v' }

function translator(batches: string[][] = []) {
  const tr = new Translator(
    async (onprogress) => {
      onprogress(0.5)
      onprogress(1)
      return files
    },
    async () => ({
      runBatch: async (texts: string[]) => {
        batches.push(texts)
        return texts.map((t) => 'en:' + t)
      },
      unload: async () => {}
    }),
    { detect: bulgarian, prepare: forModel }
  )
  return tr
}

test('Bulgarian is told from English by its letters', (t) => {
  t.ok(bulgarian('Да аз днеска за 6 часа го вдигнах'))
  t.ok(bulgarian('Обиждам лесно'))
  t.notOk(bulgarian('claude ? codex ?'))
  t.notOk(bulgarian('ok'))
  t.ok(bulgarian('В malla колко е hop to gw'), 'English terms in a Bulgarian line')
  t.ok(bulgarian('и hops to gateway в malla'), 'two Cyrillic words, however short')
  t.notOk(bulgarian('see you в 9'), 'one letter alone isn’t enough')
})

test('once on, a Bulgarian message comes back in English', async (t) => {
  const batches: string[][] = []
  const tr = translator(batches)
  const states: string[] = []
  tr.on('change', () => states.push(tr.state))
  const done: string[][] = []
  tr.on('translated', (texts: string[]) => done.push(texts))

  tr.want(['Обиждам лесно'])
  t.equal(tr.translation('Обиждам лесно'), null, 'not until the model is in')
  await tr.start()
  t.deepStrictEqual([...new Set(states)], ['downloading', 'loading', 'on'])

  tr.want(['Обиждам лесно', 'hello there'])
  await settle()
  t.equal(tr.translation('hello there'), null, 'English is left alone')
  t.deepStrictEqual(done, [['Обиждам лесно']])
  t.equal(tr.translation('Обиждам лесно'), 'en:Обиждам лесно')
  t.deepStrictEqual(batches, [['Обиждам лесно']], 'translated once')
})

test('a failed download says why, and can be tried again', async (t) => {
  let tries = 0
  const tr = new Translator(
    async () => {
      if (tries++ === 0) throw new Error('offline')
      return files
    },
    async () => ({ runBatch: async (texts: string[]) => texts, unload: async () => {} })
  )
  await tr.start()
  t.equal(tr.state, 'failed')
  t.equal(tr.error, 'offline')
  await tr.start()
  t.equal(tr.state, 'on')
})

test('the newest released model of a pair is picked, with its vocabulary', (t) => {
  const at = (location: string) => ({ location, size: 1 })
  const records = [
    {
      name: 'model.bgen.intgemm.alphas.bin',
      fromLang: 'bg',
      toLang: 'en',
      fileType: 'model',
      version: '1.0',
      attachment: at('a')
    },
    {
      name: 'model.bgen.intgemm.alphas.bin',
      fromLang: 'bg',
      toLang: 'en',
      fileType: 'model',
      version: '2.0',
      attachment: at('b')
    },
    {
      name: 'model.bgen.intgemm.alphas.bin',
      fromLang: 'bg',
      toLang: 'en',
      fileType: 'model',
      version: '3.0',
      filter_expression: 'nightly',
      attachment: at('c')
    },
    {
      name: 'vocab.bgen.spm',
      fromLang: 'bg',
      toLang: 'en',
      fileType: 'vocab',
      version: '2.0',
      attachment: at('d')
    },
    {
      name: 'model.enbg.intgemm.alphas.bin',
      fromLang: 'en',
      toLang: 'bg',
      fileType: 'model',
      version: '9.0',
      attachment: at('e')
    }
  ]
  const pick = pickFiles(records, 'bg', 'en')!
  t.equal(pick.model.attachment!.location, 'b')
  t.equal(pick.srcVocab.name, 'vocab.bgen.spm')
  t.equal(pick.dstVocab.name, 'vocab.bgen.spm')
  t.equal(pickFiles(records, 'bg', 'de'), null)
})

test('any text can be translated when asked, Latin Bulgarian spelled in Cyrillic first', async (t) => {
  const batches: string[][] = []
  const tr = translator(batches)
  await tr.start()

  tr.want(['eiiiii kvo gotvite ?'])
  await settle()
  t.equal(tr.translation('eiiiii kvo gotvite ?'), null, 'not taken for Bulgarian by itself')
  t.deepStrictEqual(batches, [])

  tr.translate('eiiiii kvo gotvite ?')
  await settle()
  t.deepStrictEqual(batches, [['еиииии кво готвите ?']])
  t.equal(tr.translation('eiiiii kvo gotvite ?'), 'en:еиииии кво готвите ?')
})

test('Latin Bulgarian in Cyrillic: letters, pairs and chat habits', (t) => {
  t.equal(cyrillic('Zdravei, kak si?'), 'Здравеи, как си?')
  t.equal(cyrillic('shte doida v 6'), 'ще доида в 6')
  t.equal(cyrillic('4akai, 6efe'), 'чакаи, шефе')
  t.equal(cyrillic('Zhivotat e hubav'), 'Животат е хубав')
})

test('translations are kept, and the next session needs no model run', async (t) => {
  const store = new Map<string, string>()
  const kept = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => store.set(k, v)
  }
  const first: string[][] = []
  const one = new Translator(
    async () => files,
    async () => ({
      runBatch: async (texts: string[]) => (first.push(texts), texts.map((x) => 'en:' + x)),
      unload: async () => {}
    }),
    { detect: bulgarian, kept }
  )
  await one.start()
  one.want(['Обиждам лесно'])
  await new Promise((r) => setTimeout(r, 100))

  const second: string[][] = []
  const two = new Translator(
    async () => files,
    async () => ({
      runBatch: async (texts: string[]) => (second.push(texts), texts),
      unload: async () => {}
    }),
    { detect: bulgarian, kept }
  )
  await two.start()
  two.want(['Обиждам лесно'])
  await new Promise((r) => setTimeout(r, 100))
  t.equal(two.translation('Обиждам лесно'), 'en:Обиждам лесно')
  t.deepStrictEqual(second, [], 'from what was kept')
})

test('the newest asked go first, and only so many wait', async (t) => {
  const batches: string[][] = []
  const tr = translator(batches)
  const texts = Array.from({ length: 70 }, (_, i) => 'съобщение ' + i)
  tr.want(texts)
  await tr.start()
  t.deepStrictEqual(batches[0], texts.slice(-8).reverse(), 'the newest first')
  await new Promise((r) => setTimeout(r, 600))
  t.equal(batches.flat().length, 60, 'the oldest ten dropped')
})
