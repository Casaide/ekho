package bare.open.url.android;

import android.app.Application;
import android.content.Intent;
import android.net.Uri;

public class OpenBridge {
  private static Application app;

  public static void init(Application a) {
    app = a;
  }

  // In whatever app handles it, usually the browser. Throws if none does.
  public static void open(String url) {
    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    app.startActivity(intent);
  }
}
