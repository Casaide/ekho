import tap from 'bare-tap'
import Translator, { bulgarian } from '../lib/translator.ts'
import { pickFiles } from '../lib/bergamot.ts'
import { settle } from './helpers.ts'

const { test } = tap

const files = { model: 'm', srcVocab: 'v', dstVocab: 'v' }

function translator(batches: string[][] = []) {
  return new Translator(
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
    })
  )
}

test('Bulgarian is told from English by its letters', (t) => {
  t.ok(bulgarian('Да аз днеска за 6 часа го вдигнах'))
  t.ok(bulgarian('Обиждам лесно'))
  t.notOk(bulgarian('claude ? codex ?'))
  t.notOk(bulgarian('ok'))
  t.notOk(bulgarian('Hi Иван, see you at the hut tonight'))
})

test('once on, a Bulgarian message comes back in English', async (t) => {
  const batches: string[][] = []
  const tr = translator(batches)
  const states: string[] = []
  tr.on('change', () => states.push(tr.state))
  const done: string[] = []
  tr.on('translated', (text: string) => done.push(text))

  t.equal(tr.english('Обиждам лесно'), null, 'off: nothing')
  await tr.start()
  t.deepStrictEqual([...new Set(states)], ['downloading', 'loading', 'on'])

  t.equal(tr.english('Обиждам лесно'), null, 'on its way')
  t.equal(tr.english('hello there'), null, 'English is left alone')
  await settle()
  t.deepStrictEqual(done, ['Обиждам лесно'])
  t.equal(tr.english('Обиждам лесно'), 'en:Обиждам лесно')
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
