#include <assert.h>
#include <bare.h>
#include <jnitl.h>
#include <js.h>
#include <stdint.h>
#include <stdlib.h>

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

// open(url)
static js_value_t *
bare_open_url_android_open(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  WITH_JNI

  jstring url = to_jstring(env, jni, argv[0]);
  jmethodID open = jni->GetStaticMethodID(bridge_class_ref, "open", "(Ljava/lang/String;)V");
  jni->CallStaticVoidMethod(bridge_class_ref, open, url);
  jni->DeleteLocalRef(url);
  rethrow(env, jni);

  return undefined(env);
}

static js_value_t *
bare_open_url_android_exports(js_env_t *env, js_value_t *exports) {
  int err;

  {
    WITH_JNI

    jclass bridge_class = load_app_class(jni, "bare.open.url.android.OpenBridge");
    bridge_class_ref = (jclass) jni->NewGlobalRef(bridge_class);
    jni->DeleteLocalRef(bridge_class);

    auto app = get_application(jni);
    jmethodID init = jni->GetStaticMethodID(bridge_class_ref, "init", "(Landroid/app/Application;)V");
    jni->CallStaticVoidMethod(bridge_class_ref, init, (jobject) app);
  }

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("open", bare_open_url_android_open)
#undef V

  return exports;
}

BARE_MODULE(bare_open_url_android, bare_open_url_android_exports)
