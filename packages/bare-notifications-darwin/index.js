const EventEmitter = require('bare-events')
const binding = require('./binding')

// Notifications on macOS, with the same shape as bare-notifications-android:
// show, cancel, ask for the permission, and hear when one is tapped.
class Notifications extends EventEmitter {
  constructor() {
    super()
    this._ready = false
    // As macOS last said; checked when ready, so false until then.
    this._granted = false
  }

  // macOS names the app's notifications after the app, so `channel` is unused.
  ready() {
    if (this._ready) return
    this._ready = true
    binding.init(
      (id) => this.emit('open', id),
      (granted) => {
        this._granted = granted
        this.emit('permission', granted)
      }
    )
  }

  get granted() {
    this.ready()
    return this._granted
  }

  request() {
    this.ready()
    return new Promise((resolve) => {
      this.once('permission', resolve)
      binding.request()
    })
  }

  show(id, { title, body = '' }) {
    this.ready()
    binding.show(id, title, body)
  }

  cancel(id) {
    this.ready()
    if (id === undefined) binding.cancel()
    else binding.cancel(id)
  }
}

module.exports = new Notifications()
