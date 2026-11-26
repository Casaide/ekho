#!/bin/sh
# Compile ekho's own native addons (packages/*) for Android, into each one's
# prebuilds/, before `npm install` copies them into node_modules. Needs the
# Android SDK and NDK, as on GitHub's Ubuntu runners.
set -e

command -v bare-make > /dev/null || npm install --global bare-make

for package in packages/*/; do
  (
    cd "$package"
    echo "Building $package"
    # Declared ranges next to what npm has, as for the app's own.
    node -e "const p=require('./package.json');for(const [n,r] of Object.entries({...p.dependencies,...p.devDependencies}))console.log(n,r)" |
      while read -r name range; do echo "  $name $range latest $(npm view "$name" version)"; done
    npm install --no-audit --no-fund
    bare-make generate --platform android --arch arm64 -D ANDROID_PLATFORM=android-34 -D ANDROID_STL=c++_shared
    bare-make build
    bare-make install
    find prebuilds -type f
  )
done
