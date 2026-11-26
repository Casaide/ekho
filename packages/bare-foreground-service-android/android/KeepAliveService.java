package bare.foreground.service.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

// Keeps the app's process running, and so its Bare runtime, while its
// activity is off screen. Android shows its notification for as long.
public class KeepAliveService extends Service {
  static final String CHANNEL = "service";
  static final int ID = 0x656b686f;

  // ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE and, API 34,
  // FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING.
  static final int CONNECTED_DEVICE = 16;
  static final int REMOTE_MESSAGING = 512;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    // Restarted by the system after the process died: there is no runtime
    // left to keep running.
    if (intent == null) {
      stopSelf();
      return START_NOT_STICKY;
    }

    NotificationManager manager = getSystemService(NotificationManager.class);
    manager.createNotificationChannel(
        new NotificationChannel(
            CHANNEL, intent.getStringExtra("channel"), NotificationManager.IMPORTANCE_LOW));

    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);

    Notification notification =
        new Notification.Builder(this, CHANNEL)
            .setSmallIcon(ServiceBridge.icon(this))
            .setContentTitle(intent.getStringExtra("title"))
            .setContentText(intent.getStringExtra("body"))
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
            .build();

    // Connected device needs a Bluetooth permission granted; without it, run
    // as messaging alone.
    try {
      startForeground(ID, notification, CONNECTED_DEVICE | REMOTE_MESSAGING);
    } catch (SecurityException e) {
      startForeground(ID, notification, REMOTE_MESSAGING);
    }

    return START_NOT_STICKY;
  }

  // Swiped away from recents: the app is closing.
  @Override
  public void onTaskRemoved(Intent intent) {
    stopSelf();
  }
}
