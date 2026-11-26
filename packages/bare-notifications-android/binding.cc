#include <assert.h>
#include <bare.h>
#include <jnitl.h>
#include <js.h>
#include <stdint.h>
#include <stdlib.h>

static js_threadsafe_function_t *open_tsfn = NULL;
static js_threadsafe_function_t *permission_tsfn = NULL;
static jclass bridge_class_ref = NULL;

static inline java_vm_t
get_jvm() {
  return java_vm_t::get_created().value();
}

static inline java_object_t<"android/app/Application">
get_application(JNIEnv *env) {
  auto cls = java_class_t<"android/app/ActivityThread">(env);
  auto current_app = cls.get_static_method<java_object_t<"android/app/Application">()>("currentApplication");
  return java_object_t<"android/app/Application">(env, current_app());
}

// FindClass uses the system class loader from non-main threads and won't find
// app DEX classes. Load via the app class loader instead.
static jclass
load_app_class(JNIEnv *jni, const char *name) {
  auto app = get_application(jni);

  jclass context_cls = jni->FindClass("android/content/Context");
  jmethodID get_cl = jni->GetMethodID(context_cls, "getClassLoader", "()Ljava/lang/ClassLoader;");
  jni->DeleteLocalRef(context_cls);

  jobject cl = jni->CallObjectMethod((jobject) app, get_cl);

  jclass cl_cls = jni->FindClass("java/lang/ClassLoader");
  jmethodID load_class = jni->GetMethodID(cl_cls, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
  jni->DeleteLocalRef(cl_cls);

  jstring jname = jni->NewStringUTF(name);
  jclass result = (jclass) jni->CallObjectMethod(cl, load_class, jname);
  jni->DeleteLocalRef(jname);
  jni->DeleteLocalRef(cl);

  return result;
}

// A JS string as a Java one, through UTF-16: NewStringUTF wants modified
// UTF-8, which emoji are not.
static jstring
to_jstring(js_env_t *env, JNIEnv *jni, js_value_t *value) {
  int err;

  size_t len;
  err = js_get_value_string_utf16le(env, value, NULL, 0, &len);
  assert(err == 0);

  utf16_t *str = (utf16_t *) malloc((len + 1) * sizeof(utf16_t));
  err = js_get_value_string_utf16le(env, value, str, len + 1, &len);
  assert(err == 0);

  jstring result = jni->NewString((const jchar *) str, (jsize) len);
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
on_open_jni(JNIEnv *, jclass, jint id) {
  if (open_tsfn == NULL) return;
  js_call_threadsafe_function(open_tsfn, (void *) (intptr_t) id, js_threadsafe_function_nonblocking);
}

static void
on_permission_jni(JNIEnv *, jclass, jboolean granted) {
  if (permission_tsfn == NULL) return;
  js_call_threadsafe_function(permission_tsfn, granted ? (void *) 1 : NULL, js_threadsafe_function_nonblocking);
}

#define WITH_JNI \
  auto jvm = get_jvm(); \
  auto maybe_env = jvm.get_env(); \
  auto guard = maybe_env.has_value() ? std::move(*maybe_env) : jvm.attach_current_thread(); \
  JNIEnv *jni = guard;

// A Java exception, cleared and thrown in JS instead: left pending, the next
// JNI call would abort the process.
static void
rethrow(js_env_t *env, JNIEnv *jni) {
  jthrowable e = jni->ExceptionOccurred();
  if (e == NULL) return;
  jni->ExceptionClear();

  jclass cls = jni->FindClass("java/lang/Throwable");
  jmethodID to_string = jni->GetMethodID(cls, "toString", "()Ljava/lang/String;");
  jstring message = (jstring) jni->CallObjectMethod(e, to_string);
  const char *utf = jni->GetStringUTFChars(message, NULL);
  js_throw_error(env, NULL, utf);
  jni->ReleaseStringUTFChars(message, utf);
  jni->DeleteLocalRef(message);
  jni->DeleteLocalRef(cls);
  jni->DeleteLocalRef(e);
}

static js_value_t *
undefined(js_env_t *env) {
  js_value_t *result;
  int err = js_get_undefined(env, &result);
  assert(err == 0);
  return result;
}

// init(channelName, onopen, onpermission)
static js_value_t *
bare_notifications_android_init(js_env_t *env, js_callback_info_t *info) {
  int err;

  if (open_tsfn != NULL) return undefined(env);

  size_t argc = 3;
  js_value_t *argv[3];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[1], 0, 1, NULL, NULL, NULL, open_cb, &open_tsfn);
  assert(err == 0);
  err = js_unref_threadsafe_function(env, open_tsfn);
  assert(err == 0);

  err = js_create_threadsafe_function(env, argv[2], 0, 1, NULL, NULL, NULL, permission_cb, &permission_tsfn);
  assert(err == 0);
  err = js_unref_threadsafe_function(env, permission_tsfn);
  assert(err == 0);

  WITH_JNI

  auto app = get_application(jni);
  jstring name = to_jstring(env, jni, argv[0]);
  jmethodID init = jni->GetStaticMethodID(bridge_class_ref, "init", "(Landroid/app/Application;Ljava/lang/String;)V");
  jni->CallStaticVoidMethod(bridge_class_ref, init, (jobject) app, name);
  jni->DeleteLocalRef(name);
  rethrow(env, jni);

  return undefined(env);
}

static js_value_t *
bare_notifications_android_granted(js_env_t *env, js_callback_info_t *info) {
  int err;

  WITH_JNI

  jmethodID granted = jni->GetStaticMethodID(bridge_class_ref, "granted", "()Z");
  jboolean value = jni->CallStaticBooleanMethod(bridge_class_ref, granted);

  js_value_t *result;
  err = js_get_boolean(env, value, &result);
  assert(err == 0);
  return result;
}

static js_value_t *
bare_notifications_android_request(js_env_t *env, js_callback_info_t *info) {
  WITH_JNI

  jmethodID request = jni->GetStaticMethodID(bridge_class_ref, "request", "()V");
  jni->CallStaticVoidMethod(bridge_class_ref, request);
  rethrow(env, jni);

  return undefined(env);
}

// show(id, title, body)
static js_value_t *
bare_notifications_android_show(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 3;
  js_value_t *argv[3];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  int32_t id;
  err = js_get_value_int32(env, argv[0], &id);
  assert(err == 0);

  WITH_JNI

  jstring title = to_jstring(env, jni, argv[1]);
  jstring body = to_jstring(env, jni, argv[2]);
  jmethodID show = jni->GetStaticMethodID(bridge_class_ref, "show", "(ILjava/lang/String;Ljava/lang/String;)V");
  jni->CallStaticVoidMethod(bridge_class_ref, show, (jint) id, title, body);
  jni->DeleteLocalRef(title);
  jni->DeleteLocalRef(body);
  rethrow(env, jni);

  return undefined(env);
}

// cancel(id), or cancel() for all
static js_value_t *
bare_notifications_android_cancel(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  WITH_JNI

  if (argc == 0) {
    jmethodID all = jni->GetStaticMethodID(bridge_class_ref, "cancelAll", "()V");
    jni->CallStaticVoidMethod(bridge_class_ref, all);
  } else {
    int32_t id;
    err = js_get_value_int32(env, argv[0], &id);
    assert(err == 0);

    jmethodID cancel = jni->GetStaticMethodID(bridge_class_ref, "cancel", "(I)V");
    jni->CallStaticVoidMethod(bridge_class_ref, cancel, (jint) id);
  }
  rethrow(env, jni);

  return undefined(env);
}

static js_value_t *
bare_notifications_android_exports(js_env_t *env, js_value_t *exports) {
  int err;

  {
    WITH_JNI

    jclass bridge_class = load_app_class(jni, "bare.notifications.android.NotificationsBridge");

    JNINativeMethod native_methods[] = {
      {"nativeOnOpen", "(I)V", (void *) on_open_jni},
      {"nativeOnPermission", "(Z)V", (void *) on_permission_jni},
    };
    jni->RegisterNatives(bridge_class, native_methods, 2);

    bridge_class_ref = (jclass) jni->NewGlobalRef(bridge_class);
    jni->DeleteLocalRef(bridge_class);
  }

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("init", bare_notifications_android_init)
  V("granted", bare_notifications_android_granted)
  V("request", bare_notifications_android_request)
  V("show", bare_notifications_android_show)
  V("cancel", bare_notifications_android_cancel)
#undef V

  return exports;
}

BARE_MODULE(bare_notifications_android, bare_notifications_android_exports)
