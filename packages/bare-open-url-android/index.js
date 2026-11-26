const binding = require('./binding')

// Open a link in the default browser. Throws if nothing can open it.
module.exports = function open(url) {
  binding.open(url)
}
