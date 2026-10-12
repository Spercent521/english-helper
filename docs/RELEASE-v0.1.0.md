# English Helper v0.1.0

Initial macOS desktop preview.

## Local Verification

Verified on an Apple Silicon Mac on October 12, 2026:

- `go test -race ./...` and `go vet ./...` passed.
- All five Playwright tests passed, including live lookup/cache reuse and actual
  UK/US MP3 decoding and playback with nonzero sample amplitudes.
- Database tests confirmed no audio bytes/files are persisted and saved words
  do not trigger dictionary requests.
- Desktop, minimum-width and mobile-width screenshots were inspected.
- The packaged native macOS window was launched and visually inspected.
- The binary contains arm64 and x86_64 slices; ad-hoc signature and ZIP SHA-256
  validation passed. Intel execution and native macOS audio output have not been
  separately instrumented; actual playback verification used the browser frontend.

## Changes

- Go + Wails native desktop window with an Edge-inspired interface.
- Embedded SQLite word database; saved words do not need dictionary requests.
- Definitions, available examples and phonetic notation.
- UK/US online pronunciation. Audio is temporary memory data, never saved.
- Word history sorted alphabetically or by creation time.
- Universal Apple Silicon / Intel binary. No Go or Node.js installation needed.

## Limitations

- Preview build uses an ad-hoc signature, not Apple Developer ID signing or
  notarization. Gatekeeper may require explicit user approval.
- Intel hardware and the declared minimum macOS 12 have not been tested locally.
- Public pronunciation and fallback dictionary endpoints are not contracted
  APIs. They may change or stop working. Distribution rights are not verified;
  review provider terms before publicly distributing this preview.
- Definitions may be English or Chinese depending on the provider.
- Some words have no provider examples. Audio playback requires a network.
- No offline audio or paid API credentials are bundled.

The ZIP contains `English Helper.app`. The adjacent SHA-256 file can be used
to verify the archive. Database location and development instructions are in
README.md; provider/privacy details are in docs/PROVIDERS.md.
