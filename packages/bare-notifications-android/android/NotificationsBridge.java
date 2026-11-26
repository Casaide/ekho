package bare.notifications.android;

import android.app.Activity;
import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.StatusBarNotification;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class NotificationsBridge {
  private static final String CHANNEL = "messages";
  private static final String PERMISSION = "android.permission.POST_NOTIFICATIONS";
  // Context.RECEIVER_NOT_EXPORTED, API 33.
  private static final int RECEIVER_NOT_EXPORTED = 4;

  private static final Handler main = new Handler(Looper.getMainLooper());

  private static Application app;
  private static NotificationManager manager;
  private static String dismissAction;
  private static volatile Activity current;
  // Asked for before any activity was on screen; and the dialog shown, its
  // answer due when the activity comes back.
  private static boolean pending = false;
  private static boolean waiting = false;

  // Shown and not yet gone, in order; and those swiped away.
  private static final List<Integer> shown = new ArrayList<>();
  private static final Set<Integer> dismissed = new HashSet<>();

  static native void nativeOnOpen(int id);

  static native void nativeOnPermission(boolean granted);

  public static void init(Application a, String channelName) {
    app = a;
    manager = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
    manager.createNotificationChannel(
        new NotificationChannel(CHANNEL, channelName, NotificationManager.IMPORTANCE_HIGH));

    dismissAction = app.getPackageName() + ".bare.notifications.DISMISS";
    app.registerReceiver(
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context context, Intent intent) {
            synchronized (shown) {
              dismissed.add(intent.getIntExtra("id", 0));
            }
          }
        },
        new IntentFilter(dismissAction),
        RECEIVER_NOT_EXPORTED);

    app.registerActivityLifecycleCallbacks(
        new Application.ActivityLifecycleCallbacks() {
          @Override
          public void onActivityCreated(Activity a, Bundle b) {}

          @Override
          public void onActivityStarted(Activity a) {}

          @Override
          public void onActivityResumed(Activity a) {
            current = a;
            if (waiting) {
              waiting = false;
              nativeOnPermission(granted());
            } else if (pending) {
              pending = false;
              ask(a);
            }
            opened();
          }

          @Override
          public void onActivityPaused(Activity a) {
            if (current == a) current = null;
          }

          @Override
          public void onActivityStopped(Activity a) {}

          @Override
          public void onActivitySaveInstanceState(Activity a, Bundle b) {}

          @Override
          public void onActivityDestroyed(Activity a) {}
        });
  }

  public static boolean granted() {
    return app.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED;
  }

  // Ask for the permission now if an activity is on screen, else when one
  // comes back. The answer arrives as nativeOnPermission once it closes.
  public static void request() {
    main.post(
        () -> {
          if (granted()) {
            nativeOnPermission(true);
            return;
          }
          Activity a = current;
          if (a == null) pending = true;
          else ask(a);
        });
  }

  // The dialog pauses the activity: its next resume is the answer.
  private static void ask(Activity a) {
    waiting = true;
    a.requestPermissions(new String[] {PERMISSION}, 0x6e6f);
  }

  public static void show(int id, String title, String body) {
    Intent launch = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
    PendingIntent open =
        PendingIntent.getActivity(
            app, id, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    Intent dismiss = new Intent(dismissAction).setPackage(app.getPackageName()).putExtra("id", id);
    PendingIntent gone =
        PendingIntent.getBroadcast(
            app, id, dismiss, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    Notification notification =
        new Notification.Builder(app, CHANNEL)
            .setSmallIcon(icon(app))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(open)
            .setDeleteIntent(gone)
            .build();

    synchronized (shown) {
      shown.remove(Integer.valueOf(id));
      shown.add(id);
      dismissed.remove(id);
    }
    manager.notify(id, notification);
  }

  public static void cancel(int id) {
    synchronized (shown) {
      shown.remove(Integer.valueOf(id));
    }
    manager.cancel(id);
  }

  public static void cancelAll() {
    synchronized (shown) {
      shown.clear();
    }
    manager.cancelAll();
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

  // Tapping a notification removes it and brings the app back: of those gone
  // since, and not swiped away, the latest is the one tapped.
  private static void opened() {
    Set<Integer> active = new HashSet<>();
    for (StatusBarNotification n : manager.getActiveNotifications()) active.add(n.getId());

    int tapped = -1;
    synchronized (shown) {
      for (int i = shown.size() - 1; i >= 0; i--) {
        int id = shown.get(i);
        if (active.contains(id)) continue;
        if (tapped == -1 && !dismissed.contains(id)) tapped = id;
        shown.remove(i);
      }
      dismissed.clear();
    }
    if (tapped != -1) nativeOnOpen(tapped);
  }
}
