#!/bin/sh
# Build ekho for macOS (Apple Silicon and Intel in one app) and zip it.
# Run on a Mac, after npm install. Unsigned builds get an ad-hoc signature,
# so they run, with Gatekeeper asking once.
set -e

out=build/macos
rm -rf "$out" && mkdir -p "$out/icon.iconset"

# The app icon, as an .icns, from the same artwork as the Android one.
for size in 16 32 128 256 512; do
  sips -z $size $size assets/icon.png --out "$out/icon.iconset/icon_${size}x${size}.png" > /dev/null
  double=$((size * 2))
  sips -z $double $double assets/icon.png --out "$out/icon.iconset/icon_${size}x${size}@2x.png" > /dev/null
done
iconutil -c icns "$out/icon.iconset" -o "$out/ekho.icns"

npx bare-build app.ts \
  --host darwin-arm64 \
  --host darwin-x64 \
  --runtime bare-native/runtime \
  --name ekho \
  --identifier casa.cassidy.ekho \
  --icon "$out/ekho.icns" \
  --info-plist macos/Info.plist \
  --out "$out"

app=$(find "$out" -maxdepth 2 -name '*.app' | head -1)
echo "Built $app"
plutil -p "$app/Contents/Info.plist" | grep -E 'Bluetooth|Identifier|ShortVersion'
lipo -archs "$app/Contents/MacOS/ekho"
ditto -c -k --keepParent "$app" build/ekho-macos.zip
ls -la build/ekho-macos.zip
