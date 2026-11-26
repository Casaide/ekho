package bare.foreground.service.android;

import android.app.Application;
import android.content.Context;
import android.content.Intent;

public class ServiceBridge {
  private static Application app;

  public static void init(Application a) {
    app = a;
  }

  // Start, or update the notification of the running service. Throws if the
  // app is in the background: Android lets only apps on screen start one.
  public static void start(String channel, String title, String body) {
    Intent intent =
        new Intent(app, KeepAliveService.class)
            .putExtra("channel", channel)
            .putExtra("title", title)
            .putExtra("body", body);
    app.startForegroundService(intent);
  }

  public static void stop() {
    app.stopService(new Intent(app, KeepAliveService.class));
  }

  // The app's own small icon if it has one (res/drawable/ic_notification),
  // else its launcher icon.
  static int icon(Context context) {
    int id =
        context
            .getResources()
            .getIdentifier("ic_notification", "drawable", context.getPackageName());
    return id != 0 ? id : context.getApplicationInfo().icon;
  }
}
