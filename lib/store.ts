import fs from 'bare-fs'
import path from 'bare-path'
import b4a from 'b4a'

// ekho's saved state as one JSON file on the device: contacts, threads and
// settings. Written to a temporary file first and renamed, so a crash
// mid-write never leaves a half-written file.
export default class Store {
  file: string

  constructor(file: string) {
    this.file = file
  }

  // The saved state, or null on first run.
  load(): any {
    if (!fs.existsSync(this.file)) return null
    return JSON.parse(b4a.toString(fs.readFileSync(this.file)))
  }

  save(data: unknown): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })

    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, this.file)
  }
}
