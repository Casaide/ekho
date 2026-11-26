const EventEmitter = require('bare-events')
const binding = require('./binding')

// Notifications on Android: show, cancel, ask for the permission, and hear
// when one is tapped. One instance per app.
class Notifications extends EventEmitter {
  constructor() {
    super()
    this._ready = false
  }

  // Set up the channel, named as the user sees it in the app's settings.
  // Called by the first other call if not before.
  ready(channel = 'Messages') {
    if (this._ready) return
    this._ready = true
    binding.init(
      channel,
      (id) => this.emit('open', id),
      (granted) => this.emit('permission', granted)
    )
  }

  get granted() {
    this.ready()
    return binding.granted()
  }

  // Ask for the permission, once an activity is on screen; resolves with the
  // answer.
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
