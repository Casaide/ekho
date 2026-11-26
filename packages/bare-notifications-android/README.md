# bare-notifications-android

Android notifications for the [Bare](https://github.com/holepunchto/bare) runtime: show and cancel them, ask for the permission, and hear when one is tapped. Built like [bare-navigation-android](https://github.com/holepunchto/bare-navigation-android): a native addon with a small Java class, packed into the APK by `bare-build`.

Lives in the ekho repo for now; built from source by `scripts/build-addons.sh`.

## Installation

```
npm i ./packages/bare-notifications-android --install-links
```

Add the permission to your manifest (Android 13 and up ask the user for it):

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

A white-on-transparent `res/drawable/ic_notification` is used as the small icon if the app has one; otherwise the launcher icon.

## Usage

```js
const notifications = require('bare-notifications-android')

notifications.ready('Messages')
if (!notifications.granted) await notifications.request()

notifications.show(1, { title: 'Ivan', body: 'leaving at 9' })
notifications.on('open', (id) => console.log('tapped', id))
```

## API

#### `notifications.ready([channel])`

Create the notification channel, named as the user sees it in the app's settings (default `Messages`). Called by any other method if not before.

#### `notifications.granted`

Whether the app may post notifications.

#### `const granted = await notifications.request()`

Ask for the permission. If no activity is on screen yet, asks when one is. Resolves when the dialog closes.

#### `notifications.show(id, { title, body })`

Show a notification, replacing any with the same `id`. Tapping it brings the app to the front.

#### `notifications.cancel([id])`

Remove one notification, or all of them.

#### `notifications.on('open', id)`

A notification was tapped. Emitted when the app comes back to the front: the latest one gone since, and not swiped away, is the one tapped.

## License

Apache-2.0
