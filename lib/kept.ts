import Hyperbee from 'hyperbee'
import type { Kept, KeptPreview } from './previews.ts'

// Previews kept between sessions, in a Hyperbee by link. The core is local:
// nothing announces it, so it's never replicated.
export default class KeptPreviews implements Kept {
  bee: any

  constructor(core: unknown) {
    this.bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  }

  async get(url: string): Promise<KeptPreview | null> {
    const node = await this.bee.get(url)
    return node === null ? null : node.value
  }

  put(url: string, value: KeptPreview): Promise<unknown> {
    return this.bee.put(url, value)
  }
}
