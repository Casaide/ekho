#import <assert.h>
#import <bare.h>
#import <js.h>
#import <stdint.h>
#import <stdlib.h>
#import <utf.h>

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

static js_threadsafe_function_t *open_tsfn = NULL;
static js_threadsafe_function_t *permission_tsfn = NULL;

// Shows notifications while the app is active too (ekho posts only when its
// window isn't in front), and passes taps on to JS.
@interface BareNotificationsDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation BareNotificationsDelegate

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  int32_t id = (int32_t) response.notification.request.identifier.intValue;
  if (open_tsfn != NULL) {
    js_call_threadsafe_function(open_tsfn, (void *) (intptr_t) id, js_threadsafe_function_nonblocking);
  }
  completionHandler();
}

@end

static BareNotificationsDelegate *delegate = nil;

static js_value_t *
undefined(js_env_t *env) {
  js_value_t *result;
  int err = js_get_undefined(env, &result);
  assert(err == 0);
  return result;
}

static NSString *
to_string(js_env_t *env, js_value_t *value) {
  int err;

  size_t len;
  err = js_get_value_string_utf8(env, value, NULL, 0, &len);
  assert(err == 0);

  utf8_t *str = malloc(len + 1);
  err = js_get_value_string_utf8(env, value, str, len + 1, &len);
  assert(err == 0);

  NSString *result = [[NSString alloc] initWithBytes:str length:len encoding:NSUTF8StringEncoding];
  free(str);

  return result;
}

static void
open_cb(js_env_t *env, js_value_t *fn, void *ctx, void *data) {
  if (fn == NULL) return;

  js_value_t *argv[1];
  js_create_int32(env, (int32_t) (intptr_t) data, &argv[0]);

  js_value_t *global;
  js_get_global(env, &global);

  js_value_t *result;
  js_call_function(env, global, fn, 1, argv, &result);
}

static void
permission_cb(js_env_t *env, js_value_t *fn, void *ctx, void *data) {
  if (fn == NULL) return;

  js_value_t *argv[1];
  js_get_boolean(env, data != NULL, &argv[0]);

  js_value_t *global;
  js_get_global(env, &global);

  js_value_t *result;
  js_call_function(env, global, fn, 1, argv, &result);
}

static void
on_permission(BOOL granted) {
  if (permission_tsfn == NULL) return;
  js_call_threadsafe_function(permission_tsfn, granted ? (void *) 1 : NULL, js_threadsafe_function_nonblocking);
}

// init(onopen, onpermission): reports the permission as it stands, and taps
// from then on.
static js_value_t *
bare_notifications_darwin_init(js_env_t *env, js_callback_info_t *info) {
  int err;

  if (open_tsfn != NULL) return undefined(env);

  size_t argc = 2;
  js_value_t *argv[2];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[0], 0, 1, NULL, NULL, NULL, open_cb, &open_tsfn);
  assert(err == 0);
  err = js_unref_threadsafe_function(env, open_tsfn);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[1], 0, 1, NULL, NULL, NULL, permission_cb, &permission_tsfn);
  assert(err == 0);
  err = js_unref_threadsafe_function(env, permission_tsfn);
  assert(err == 0);

  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  delegate = [[BareNotificationsDelegate alloc] init];
  center.delegate = delegate;

  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    on_permission(settings.authorizationStatus == UNAuthorizationStatusAuthorized);
  }];

  return undefined(env);
}

static js_value_t *
bare_notifications_darwin_request(js_env_t *env, js_callback_info_t *info) {
  UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound;
  [[UNUserNotificationCenter currentNotificationCenter]
    requestAuthorizationWithOptions:options
                  completionHandler:^(BOOL granted, NSError *error) {
                    on_permission(granted);
                  }];

  return undefined(env);
}

// show(id, title, body)
static js_value_t *
bare_notifications_darwin_show(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 3;
  js_value_t *argv[3];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  int32_t id;
  err = js_get_value_int32(env, argv[0], &id);
  assert(err == 0);

  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
  content.title = to_string(env, argv[1]);
  content.body = to_string(env, argv[2]);
  content.sound = [UNNotificationSound defaultSound];

  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:[@(id) stringValue] content:content trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:nil];

  return undefined(env);
}

// cancel(id), or cancel() for all
static js_value_t *
bare_notifications_darwin_cancel(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];

  if (argc == 0) {
    [center removeAllDeliveredNotifications];
  } else {
    int32_t id;
    err = js_get_value_int32(env, argv[0], &id);
    assert(err == 0);

    [center removeDeliveredNotificationsWithIdentifiers:@[ [@(id) stringValue] ]];
  }

  return undefined(env);
}

static js_value_t *
bare_notifications_darwin_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("init", bare_notifications_darwin_init)
  V("request", bare_notifications_darwin_request)
  V("show", bare_notifications_darwin_show)
  V("cancel", bare_notifications_darwin_cancel)
#undef V

  return exports;
}

BARE_MODULE(bare_notifications_darwin, bare_notifications_darwin_exports)
