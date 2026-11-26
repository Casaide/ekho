#!/bin/sh
# Compile ekho's own native addons (packages/*) into each one's prebuilds/,
# before `npm install` copies them into node_modules.
#
#   sh scripts/build-addons.sh android   # packages/*-android, for arm64; needs the Android SDK and NDK
#   sh scripts/build-addons.sh darwin    # packages/*-darwin, for arm64 and x64; on a Mac
set -e

platform="$1"
case "$platform" in
  android) archs="arm64"; flags="-D ANDROID_PLATFORM=android-34 -D ANDROID_STL=c++_shared" ;;
  darwin) archs="arm64 x64"; flags="" ;;
  *) echo "usage: build-addons.sh android|darwin" >&2; exit 1 ;;
esac

command -v bare-make > /dev/null || npm install --global bare-make

for package in packages/*-"$platform"/; do
  (
    cd "$package"
    echo "Building $package"
    # Declared ranges next to what npm has, as for the app's own.
    node -e "const p=require('./package.json');for(const [n,r] of Object.entries({...p.dependencies,...p.devDependencies}))console.log(n,r)" |
      while read -r name range; do echo "  $name $range latest $(npm view "$name" version)"; done
    npm install --no-audit --no-fund
    for arch in $archs; do
      # shellcheck disable=SC2086
      bare-make generate --build "build/$arch" --platform "$platform" --arch "$arch" $flags
      bare-make build --build "build/$arch"
      bare-make install --build "build/$arch"
    done
    find prebuilds -type f
  )
done
