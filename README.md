# English Helper

A small macOS dictionary built with Go, Wails and SQLite. Edge-inspired
teal interface, Chinese navigation, online UK/US pronunciation, local word history.

## Features

- One search box: saved words load locally; new words are fetched and saved.
- Definitions, available examples, phonetic notation and online pronunciation.
- Browse the local database alphabetically, newest first or oldest first.
- No accounts, API keys, background updates or paid services.
- Audio is fetched only on playback and retained only in memory. No audio files
  or audio bytes are stored in SQLite. Offline pronunciation is not provided.
- New words query Free Dictionary API and a public Youdao endpoint concurrently.
  Each successful result is shown in its own source tab and saved independently;
  a faster result no longer discards a slower source. Definitions may be English
  or Chinese depending on source.
- Saved words load offline. Legacy entries retain their original source; use
  "查询此来源" to explicitly fetch any missing source. Unavailable sources have
  separate status indicators and retry controls.
- Missing provider examples are displayed as missing, not invented.

## macOS Installation

The universal ZIP in `build/bin` contains `English Helper.app`. Extract and move
the app to Applications. Runs natively on Apple Silicon and Intel Macs.
The declared minimum OS is macOS 12; older versions and Intel hardware have not
been tested locally.

The minimum follows the Go 1.26 runtime requirement:
https://go.dev/doc/go1.26#darwin

This build has an ad-hoc signature, not an Apple Developer ID signature, and is
not notarized. Gatekeeper may block a copy received from the Internet. Review
and trust the source before using macOS's explicit approval flow. Do not disable
Gatekeeper globally.

## Local Launch

From the project root, launch the built macOS app with:

```sh
open english_helper.app
```

`english_helper.app` is a tracked relative symbolic link to
`build/bin/English Helper.app`. You can move the entire project folder and keep
using the same command. Keep the internal directory structure intact; moving
only the link or only the app will break it.

The compiled app is not tracked in Git. On a fresh clone, build it first:

```sh
./scripts/package-macos.sh
open english_helper.app
```

Building requires the development tools below; launching an existing build
does not require Go, Node.js, or an additional server. Rebuilding the app keeps
the same link valid.

## Database

SQLite was selected because it is a transactional single-file embedded database
with no separate process or installation. Definitions are small; audio is not
stored, keeping the database lightweight. This build uses SQLite via CGO to avoid
bundling a much larger pure-Go database runtime.

The database lives at:

```text
~/Library/Application Support/English Helper/dictionary.db
```

Word timestamps are stored in UTC and displayed in the user's local timezone.
There is no built-in delete/export function; the app deliberately has only
search, cache reuse and database browsing.

## Development

Requires Go, Node.js and Xcode command line tools.

```sh
npm ci
npm run build
go test ./...
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
wails dev
```

Install the Wails CLI once, and ensure `$(go env GOPATH)/bin` is on `PATH`.
Frontend dependencies are build-time only. Users of the app need neither Go nor
Node.js installed.

## Tests

```sh
go test -race ./...
go vet ./...
npx playwright install chromium
npm run build
npm run test:ui
LIVE_DICTIONARY_TEST=1 go test -v ./internal/dictionary -run TestLiveProviders
LIVE_UI_TEST=1 npm run test:ui
```

Live tests are opt-in because they depend on third-party network availability.
UI tests start and stop a loopback Go preview server with a disposable database.
Use `PLAYWRIGHT_CHANNEL=chrome` to run against an installed Google Chrome instead.
Screenshots and temporary test outputs go to ignored `artifacts/`.

## Release Build

```sh
wails build -platform darwin/universal -trimpath
ditto -c -k --sequesterRsrc --keepParent "build/bin/English Helper.app" \
  "build/bin/English-Helper-v0.1.0-macos-universal.zip"
shasum -a 256 "build/bin/English-Helper-v0.1.0-macos-universal.zip"
```

Or run `./scripts/package-macos.sh` to build, archive and generate a SHA-256 file.
GitHub Actions runs offline tests, browser checks and a universal build on
pushes to `main`/`develop` and release tags. Live-provider tests are not run in CI.

See `docs/PROVIDERS.md` for availability and distribution limitations.

## Git Flow

`main` contains releases; `develop` is the integration branch.
Development uses `feature/*`, releases use `release/*`, and urgent fixes
use `hotfix/*`. No branches use the `codex/` prefix.

Features merge into `develop` using `--no-ff`. A tested `release/0.1.0` branch
merges into `main`, receives tag `v0.1.0`, and merges back into `develop`.
