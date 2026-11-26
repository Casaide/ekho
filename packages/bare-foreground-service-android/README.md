# bare-foreground-service-android

Keep a [Bare](https://github.com/holepunchto/bare) app running on Android while it's off screen, with a foreground service and its ongoing notification. Built like [bare-navigation-android](https://github.com/holepunchto/bare-navigation-android): a native addon with small Java classes, packed into the APK by `bare-build`.

Bare carries on while suspended as long as it has work: open sockets and Bluetooth connections keep its loop busy. What stops it on Android is the system freezing or killing the app once it's in the background. A foreground service prevents that.

Lives in the ekho repo for now; built from source by `scripts/build-addons.sh`.

## Installation

```
npm i ./packages/bare-foreground-service-android --install-links
```

Declare the service and its permissions in your manifest:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING" />

<application ...>
  <service
    android:name="bare.foreground.service.android.KeepAliveService"
    android:exported="false"
    android:foregroundServiceType="connectedDevice|remoteMessaging" />
</application>
```

The service runs as a connected device when a Bluetooth permission is granted, else as messaging only.

## Usage

```js
const service = require('bare-foreground-service-android')

service.start({ title: 'ekho', body: 'connected to your radio' })
service.update({ title: 'ekho', body: 'on irc' })
service.stop()
```

## API

#### `service.start({ title, body, channel })`

Start the service, showing an ongoing notification. `channel` names its notification channel in the app's settings. Throws if the app isn't on screen: Android lets only apps on screen start one.

#### `service.update({ title, body, channel })`

Change the notification of the running service.

#### `service.stop()`

Stop the service and remove its notification.

Swiping the app away from recents stops the service too.

## License

Apache-2.0
