import Hyperbee from 'hyperbee'

// Small things kept between sessions, in a Hyperbee by key: link previews,
// translations. Each on a local core of its own: nothing announces it, so
// it's never replicated.
export default class Kept<T> {
  bee: any

  constructor(core: unknown) {
    this.bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  }

  async get(key: string): Promise<T | null> {
    const node = await this.bee.get(key)
    return node === null ? null : node.value
  }

  put(key: string, value: T): Promise<unknown> {
    return this.bee.put(key, value)
  }
}
