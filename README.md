# English Helper

A small macOS dictionary built with Go, Wails and SQLite.

## Development

Requires Go, Node.js and Xcode command line tools.

```sh
npm ci
npm run build
go test ./...
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
wails dev
```

## Git Flow

`main` contains releases; `develop` is the integration branch.
Development uses `feature/*`, releases use `release/*`, and urgent fixes
use `hotfix/*`. No branches use the `codex/` prefix.
