#import <assert.h>
#import <bare.h>
#import <js.h>
#import <stdlib.h>
#import <utf.h>

#import <AppKit/AppKit.h>

static js_value_t *
undefined(js_env_t *env) {
  js_value_t *result;
  int err = js_get_undefined(env, &result);
  assert(err == 0);
  return result;
}

// open(url): in the default browser, or whatever app handles the scheme.
static js_value_t *
bare_open_url_darwin_open(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];
  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  size_t len;
  err = js_get_value_string_utf8(env, argv[0], NULL, 0, &len);
  assert(err == 0);

  utf8_t *str = malloc(len + 1);
  err = js_get_value_string_utf8(env, argv[0], str, len + 1, &len);
  assert(err == 0);

  NSString *value = [[NSString alloc] initWithBytes:str length:len encoding:NSUTF8StringEncoding];
  free(str);

  NSURL *url = [NSURL URLWithString:value];
  if (url == nil || ![[NSWorkspace sharedWorkspace] openURL:url]) {
    js_throw_error(env, NULL, "Could not open the link");
  }

  return undefined(env);
}

static js_value_t *
bare_open_url_darwin_exports(js_env_t *env, js_value_t *exports) {
  int err;

  js_value_t *fn;
  err = js_create_function(env, "open", -1, bare_open_url_darwin_open, NULL, &fn);
  assert(err == 0);
  err = js_set_named_property(env, exports, "open", fn);
  assert(err == 0);

  return exports;
}

BARE_MODULE(bare_open_url_darwin, bare_open_url_darwin_exports)
