#!/bin/sh
# QVAC's native runtime for each host we build for (android-arm64,
# darwin-arm64, darwin-x64). npm installs only the build machine's own, as
# an optional dependency of @qvac/fabric, so the others are added here, at
# fabric's version.
set -e
version=$(node -p "require('./node_modules/@qvac/fabric/package.json').version")
packages=""
for host in "$@"; do packages="$packages @qvac/fabric-$host@$version"; done
npm install --no-save --force $packages
