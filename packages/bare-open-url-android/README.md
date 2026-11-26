# bare-open-url-android

Open a link in the default browser, for the [Bare](https://github.com/holepunchto/bare) runtime. Built like ekho's other addons in `packages/`; compiled by `scripts/build-addons.sh`.

## Usage

```js
const open = require('bare-open-url-android')

open('https://github.com/Casaide/ekho')
```

## API

#### `open(url)`

Open `url` in whatever app handles it, usually the browser. Throws if none can.

## License

Apache-2.0
