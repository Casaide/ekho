const binding = require('./binding')

// Keep the app running while it's off screen, with an ongoing notification
// saying so. Start it while the app is on screen: Android refuses otherwise.

exports.start = function start({ title, body = '', channel = 'Running in the background' }) {
  binding.start(channel, title, body)
}

// Change the notification of a running service, the same way.
exports.update = exports.start

exports.stop = function stop() {
  binding.stop()
}
