#!/bin/sh
# QVAC's native runtime for each Android host we build for (android-arm64).
# npm installs only the build machine's own, as an optional dependency of
# @qvac/fabric, so the others are added here, at fabric's version. Its GPU
# backends (Vulkan, OpenCL, RPC: about 88 MB) are removed: the translation
# model (Bergamot) runs on the CPU, and fabric loads only the backends it
# finds.
set -e
version=$(node -p "require('./node_modules/@qvac/fabric/package.json').version")
for host in "$@"; do
  npm install --no-save --force "@qvac/fabric-$host@$version"
  find "node_modules/@qvac/fabric-$host" -name 'libqvac-ggml-vulkan*' -delete
  find "node_modules/@qvac/fabric-$host" -name 'libqvac-ggml-opencl*' -delete
  find "node_modules/@qvac/fabric-$host" -name 'libqvac-ggml-rpc*' -delete
done
