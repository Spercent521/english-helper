#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
wails="$(go env GOPATH)/bin/wails"
if [ ! -x "$wails" ]; then
  printf '%s\n' 'Install Wails first: go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0' >&2
  exit 1
fi
npm ci
npm run build
"$wails" build -platform darwin/universal -trimpath -nocolour -s
archive="build/bin/English-Helper-v${version}-macos-universal.zip"
ditto -c -k --sequesterRsrc --keepParent "build/bin/English Helper.app" "$archive"
shasum -a 256 "$archive" > "${archive}.sha256"
printf 'Package: %s\n' "$archive"
