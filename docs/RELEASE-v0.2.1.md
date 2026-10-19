# English Helper v0.2.1

- Suspend the Web Audio engine when pronunciation ends, fails or is stopped.
- Stop playback and suspend audio when the document becomes hidden or leaves.
- Ignore a cancelled playback immediately after audio activation, before fetching
  a recording.
- Keep audio network-only and memory-only. Resume the same context on the next
  explicit playback request.

## Power Investigation

Measured locally on October 20, 2026, on an Apple Silicon Mac:

- Before any playback, idle CPU was near zero. No application polling timers,
  continuous render loops or always-visible animations were found.
- In v0.2.0, after pronunciation ended, WebKit's content process continued using
  approximately 0.6%-1.5% CPU in five-second samples. Its GPU process used
  approximately 0.3%-0.4%. A three-second thread sample caught the audio rendering
  thread executing audio render callbacks despite there being no audible playback.
- In v0.2.1, after pronunciation ended, seven samples spanning 30 seconds showed
  0.0% CPU for the associated WebKit content, GPU and networking processes.
  The Go application used 0.0%-0.1%. A three-second thread sample showed the audio
  rendering thread waiting on a semaphore throughout.
- Native playback was checked again after suspension, including switching accents.

These are short CPU and thread measurements, not isolated battery or watt
measurements. They establish an avoidable idle audio workload and its removal,
not a specific battery-life improvement or zero power consumption.

## Verification

- `go test -race ./...` and `go vet ./...` passed.
- All 16 browser tests passed with public-provider integration enabled.
  New checks exercise lazy audio initialization, natural completion, replay,
  manual stop, accent and view changes, visibility/pagehide events, failed
  requests and cancellation while a recording is pending.
- Both real online accents decoded and played successfully.
- Universal macOS build, ad-hoc signature and ZIP checksum verification passed.

The app remains ad-hoc signed, not notarized.
