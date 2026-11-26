import fs from 'bare-fs'
import b4a from 'b4a'
import path from 'bare-path'
import type { Fetch } from './previews.ts'

// Mozilla's translation models (Firefox Translations, Bergamot), as Firefox
// itself gets them: the list from Remote Settings, the files from its CDN.
const RECORDS =
  'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records'
const FILES = 'https://firefox-settings-attachments.cdn.mozilla.net/'

export interface ModelFiles {
  model: string
  srcVocab: string
  dstVocab: string
}

interface Record {
  name: string
  fromLang: string
  toLang: string
  fileType?: string
  version?: string
  filter_expression?: string
  attachment?: { location: string; size: number }
}

// The files of the model from `from` to `to`, in `dir`: kept from before, or
// downloaded now. `onprogress` gets the share done, 0 to 1.
export async function modelFiles(
  from: string,
  to: string,
  dir: string,
  opts: { fetch: Fetch; onprogress?: (done: number) => void }
): Promise<ModelFiles> {
  const kept = path.join(dir, 'files.json')
  if (fs.existsSync(kept)) return JSON.parse(b4a.toString(fs.readFileSync(kept)))

  const res = await opts.fetch(RECORDS, {})
  if (!res.ok) throw new Error('the model list said ' + res.status)
  const records: Record[] = JSON.parse(await res.text()).data
  const pick = pickFiles(records, from, to)
  if (pick === null) throw new Error('no ' + from + '-' + to + ' model')

  await fs.promises.mkdir(dir, { recursive: true })
  const wanted = [
    pick.model,
    pick.srcVocab,
    ...(pick.dstVocab === pick.srcVocab ? [] : [pick.dstVocab])
  ]
  const total = wanted.reduce((sum, r) => sum + r.attachment!.size, 0)
  let done = 0
  for (const record of wanted) {
    const file = path.join(dir, record.name)
    const got = await opts.fetch(FILES + record.attachment!.location, {})
    if (!got.ok) throw new Error(record.name + ' said ' + got.status)
    const bytes = new Uint8Array(await got.arrayBuffer())
    await fs.promises.writeFile(file + '.part', bytes)
    await fs.promises.rename(file + '.part', file)
    done += record.attachment!.size
    opts.onprogress?.(done / total)
  }

  const files = {
    model: path.join(dir, pick.model.name),
    srcVocab: path.join(dir, pick.srcVocab.name),
    dstVocab: path.join(dir, pick.dstVocab.name)
  }
  // Written last: its being there says every file is.
  await fs.promises.writeFile(kept, JSON.stringify(files))
  return files
}

// From Mozilla's list, the newest released model for a pair and its
// vocabularies: one shared, or one for each side. Records for Nightly only
// (with a filter) are left out.
export function pickFiles(
  records: Record[],
  from: string,
  to: string
): { model: Record; srcVocab: Record; dstVocab: Record } | null {
  const pair = records.filter(
    (r) =>
      r.fromLang === from &&
      r.toLang === to &&
      r.attachment !== undefined &&
      (r.filter_expression ?? '') === ''
  )
  const newest = (type: string) => {
    const found = pair.filter((r) => kind(r) === type)
    found.sort((a, b) => compare(b.version ?? '0', a.version ?? '0'))
    return found[0] ?? null
  }
  const model = newest('model')
  const shared = newest('vocab')
  const srcVocab = shared ?? newest('srcvocab')
  const dstVocab = shared ?? newest('trgvocab')
  if (model === null || srcVocab === null || dstVocab === null) return null
  return { model, srcVocab, dstVocab }
}

function kind(record: Record): string {
  return record.fileType ?? record.name.split('.')[0]
}

// Versions such as 1.0 and 2.1: by each number in turn.
function compare(a: string, b: string): number {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0)
  const y = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  }
  return 0
}
