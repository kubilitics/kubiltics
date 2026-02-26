# Kubilitics — Build & Release Guide

> **Canonical reference** for building every artifact and shipping a release.
> Read this document top-to-bottom at least once before executing a release.
> For governance rules and known pitfalls see [`RELEASE-STANDARDS.md`](RELEASE-STANDARDS.md).
> For a quick git-tag-focused runbook see [`release-steps.md`](release-steps.md).

---

## Table of Contents

1. [Repository & Artifact Map](#1-repository--artifact-map)
2. [Prerequisites](#2-prerequisites)
3. [Version Pins — Stay in Sync](#3-version-pins--stay-in-sync)
4. [Building Locally (All Components)](#4-building-locally-all-components)
   - 4.1 [Backend binary](#41-backend-binary)
   - 4.2 [kcli binary](#42-kcli-binary)
   - 4.3 [AI backend binary](#43-ai-backend-binary)
   - 4.4 [Frontend (browser / production)](#44-frontend-browser--production)
   - 4.5 [Frontend (Tauri / desktop mode)](#45-frontend-tauri--desktop-mode)
   - 4.6 [Desktop app — macOS universal DMG](#46-desktop-app--macos-universal-dmg)
   - 4.7 [Desktop app — Windows NSIS installer](#47-desktop-app--windows-nsis-installer)
   - 4.8 [Desktop app — Linux AppImage / DEB / RPM](#48-desktop-app--linux-appimage--deb--rpm)
   - 4.9 [Docker image — backend](#49-docker-image--backend)
   - 4.10 [Docker image — AI backend](#410-docker-image--ai-backend)
5. [One-shot Desktop Build Script](#5-one-shot-desktop-build-script)
6. [Pre-Release Gate — All Checks Must Pass](#6-pre-release-gate--all-checks-must-pass)
7. [Release Procedure — End to End](#7-release-procedure--end-to-end)
8. [CI/CD Pipeline Reference](#8-cicd-pipeline-reference)
9. [Artifact Reference Table](#9-artifact-reference-table)
10. [Secrets & Code Signing](#10-secrets--code-signing)
11. [Enabling Windows / Linux Desktop Builds](#11-enabling-windows--linux-desktop-builds)
12. [Hotfix Releases](#12-hotfix-releases)
13. [Rollback a Bad Release](#13-rollback-a-bad-release)
14. [Troubleshooting Common Build Failures](#14-troubleshooting-common-build-failures)

---

## 1. Repository & Artifact Map

```
kubilitics-os-emergent/
├── kubilitics-backend/     → Go REST API + WebSocket server
│   └── Dockerfile          → Multi-arch (linux/amd64 + linux/arm64) Docker image
├── kcli/                   → AI-powered kubectl CLI replacement
├── kubilitics-ai/          → AI inference backend (Go)
├── kubilitics-frontend/    → React + TypeScript + Vite SPA
├── kubilitics-desktop/     → Tauri v2 desktop shell
│   ├── dist/               → Frontend dist copied here before Tauri build
│   └── src-tauri/
│       ├── binaries/       → Go sidecar binaries (backend, kcli, AI) with platform triple suffix
│       ├── tauri.conf.json → App config, window settings, CSP, version
│       └── Cargo.toml      → Rust/Tauri metadata
├── scripts/
│   ├── build-desktop.sh         → One-shot local desktop build
│   └── prepare-desktop-binaries.sh  → Copies built binaries into src-tauri/binaries/
├── .github/workflows/
│   ├── release.yml         → Tag-triggered release CI (builds ALL artifacts)
│   ├── backend-ci.yml      → PR/push CI for kubilitics-backend
│   └── kcli-ci.yml         → PR/push CI for kcli
└── docs/                   → You are here
```

**What a release produces:**

| Artifact | Format | Platform |
|---|---|---|
| `kubilitics-backend-linux-amd64` | Binary | Linux x86_64 |
| `kubilitics-backend-linux-arm64` | Binary | Linux ARM64 |
| `kubilitics-ai-linux-amd64` | Binary | Linux x86_64 |
| `kubilitics-ai-darwin-amd64` | Binary | macOS Intel |
| `kubilitics-ai-darwin-arm64` | Binary | macOS Apple Silicon |
| `kcli-linux-amd64` | Binary | Linux x86_64 |
| `kcli-linux-arm64` | Binary | Linux ARM64 |
| `kcli-darwin-amd64` | Binary | macOS Intel |
| `kcli-darwin-arm64` | Binary | macOS Apple Silicon |
| `kcli-windows-amd64.exe` | Binary | Windows x86_64 |
| `Kubilitics_<version>_universal.dmg` | Installer | macOS (Intel + Apple Silicon) |
| `ghcr.io/kubilitics/kubilitics-backend:<version>` | Docker | linux/amd64 + linux/arm64 |
| `ghcr.io/kubilitics/kubilitics-ai:<version>` | Docker | linux/amd64 |

---

## 2. Prerequisites

### All platforms

| Tool | Minimum version | Install |
|---|---|---|
| Git | 2.x | `brew install git` / system |
| Go | **1.25.7** (see [§3](#3-version-pins--stay-in-sync)) | https://go.dev/dl/ |
| Node.js | 20.x LTS | https://nodejs.org |
| npm | 10.x (bundled with Node 20) | — |

### macOS desktop builds (additional)

| Tool | Install |
|---|---|
| Xcode Command Line Tools | `xcode-select --install` |
| Rust (stable) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Tauri CLI v2 | `cargo install tauri-cli --version ^2.0` |
| macOS universal targets | `rustup target add aarch64-apple-darwin x86_64-apple-darwin` |

### Windows desktop builds (additional)

| Tool | Install |
|---|---|
| Rust (stable, MSVC toolchain) | https://rustup.rs |
| Tauri CLI v2 | `cargo install tauri-cli --version ^2.0` |
| Visual Studio Build Tools | Install "Desktop development with C++" workload |
| WebView2 Runtime | Ships with Windows 11; download separately for Windows 10 |

### Linux desktop builds (additional)

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

Plus Rust + Tauri CLI as above.

### Security scanning (required before release)

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
```

---

## 3. Version Pins — Stay in Sync

These values **must** be identical across all files before tagging a release.

| What | Current value | File(s) to update |
|---|---|---|
| Go toolchain | `1.25.7` | `kubilitics-backend/Dockerfile` `ARG GO_VERSION` · `backend-ci.yml` · `kcli-ci.yml` · `release.yml` |
| Alpine image | `3.21` | `kubilitics-backend/Dockerfile` `ARG ALPINE_VERSION` |
| kubectl in Docker | `v1.33.3` | `kubilitics-backend/Dockerfile` `ARG KUBECTL_VERSION` |
| App version | `0.1.3` | `kubilitics-frontend/package.json` · `kubilitics-desktop/src-tauri/tauri.conf.json` · `CHANGELOG.md` |

> **Rule — Go version cascade:** `kcli/go.mod` drives the minimum (`go 1.25.0` due to `k8s.io/api v0.35.x`). The Dockerfile and all CI `GO_VERSION` pins must be ≥ this value. Check with:
> ```bash
> grep "^go " kubilitics-backend/go.mod kcli/go.mod kubilitics-ai/go.mod
> ```
> If a dependency bump raises any module's `go` directive, update all three files listed above.

---

## 4. Building Locally (All Components)

Set your shell variables first — every snippet below uses them:

```bash
# Repo root
ROOT="$(git rev-parse --show-toplevel)"
VERSION="0.1.3"   # no "v" prefix
```

---

### 4.1 Backend binary

The backend is a plain Go binary. CGO is disabled for cross-platform portability.

```bash
cd "$ROOT/kubilitics-backend"

# Native (current OS/arch — fastest for local testing)
go build -ldflags="-s -w" -o bin/kubilitics-backend ./cmd/server

# Cross-compile — Linux amd64 (release target)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o bin/kubilitics-backend-linux-amd64 ./cmd/server

# Cross-compile — Linux arm64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
  go build -ldflags="-s -w" -o bin/kubilitics-backend-linux-arm64 ./cmd/server
```

**Verify:**
```bash
./bin/kubilitics-backend --version 2>/dev/null || ./bin/kubilitics-backend --help | head -3
```

---

### 4.2 kcli binary

```bash
cd "$ROOT/kcli"

# Native
CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/kcli ./cmd/kcli

# All release targets
CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o bin/kcli-linux-amd64   ./cmd/kcli
CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -ldflags="-s -w" -o bin/kcli-linux-arm64   ./cmd/kcli
CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o bin/kcli-darwin-amd64  ./cmd/kcli
CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -ldflags="-s -w" -o bin/kcli-darwin-arm64  ./cmd/kcli
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o bin/kcli-windows-amd64.exe ./cmd/kcli
```

---

### 4.3 AI backend binary

```bash
cd "$ROOT/kubilitics-ai"

# Native
CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/kubilitics-ai ./cmd/server/main.go

# macOS (desktop sidecar targets)
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o bin/kubilitics-ai-darwin-amd64 ./cmd/server/main.go
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o bin/kubilitics-ai-darwin-arm64 ./cmd/server/main.go
```

> **Note:** The Docker image for the AI backend uses `CGO_ENABLED=1` (sqlite, pty support) and
> only builds for `linux/amd64`. Desktop sidecar builds always use `CGO_ENABLED=0`.

---

### 4.4 Frontend (browser / production)

```bash
cd "$ROOT/kubilitics-frontend"
npm ci                    # install exact deps from package-lock.json
npm run build             # outputs to dist/
```

The `dist/` output is served by any static web server or CDN. This is **not** the Tauri build.

**Verify:**
```bash
ls -lh dist/              # index.html + assets/ should be present
du -sh dist/              # typically 3–8 MB
```

---

### 4.5 Frontend (Tauri / desktop mode)

The Tauri build uses different Vite settings:
- `base: './'` — relative asset paths (required for `tauri://` protocol)
- No `crossorigin` attributes on `<script>`/`<link>` (strips CORS headers)
- No Rollup chunk splitting (avoids WKWebView circular-import crashes)

```bash
cd "$ROOT/kubilitics-frontend"
TAURI_BUILD=true npm run build    # outputs to dist/ with Tauri-specific config

# Copy to where Tauri expects it (frontendDist: "../dist" in tauri.conf.json)
rm -rf "$ROOT/kubilitics-desktop/dist"
cp -r dist "$ROOT/kubilitics-desktop/dist"
```

> **Never use the regular `npm run build` output for Tauri.** The absolute paths and
> `crossorigin` attributes in the standard build will cause a blank white screen in WKWebView.

---

### 4.6 Desktop app — macOS universal DMG

macOS requires sidecar binaries for **both** `x86_64-apple-darwin` and `aarch64-apple-darwin`,
plus a `lipo`-merged `universal-apple-darwin` fat binary for the universal target.

#### Step 1 — Build sidecar binaries

```bash
mkdir -p "$ROOT/kubilitics-desktop/src-tauri/binaries"
BINS="$ROOT/kubilitics-desktop/src-tauri/binaries"

# Backend sidecar
cd "$ROOT/kubilitics-backend"
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" \
  -o "$BINS/kubilitics-backend-x86_64-apple-darwin"   ./cmd/server
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" \
  -o "$BINS/kubilitics-backend-aarch64-apple-darwin"  ./cmd/server
lipo -create \
  "$BINS/kubilitics-backend-x86_64-apple-darwin" \
  "$BINS/kubilitics-backend-aarch64-apple-darwin" \
  -output "$BINS/kubilitics-backend-universal-apple-darwin"

# kcli sidecar
cd "$ROOT/kcli"
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" \
  -o "$BINS/kcli-x86_64-apple-darwin"  ./cmd/kcli
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" \
  -o "$BINS/kcli-aarch64-apple-darwin" ./cmd/kcli
lipo -create \
  "$BINS/kcli-x86_64-apple-darwin" \
  "$BINS/kcli-aarch64-apple-darwin" \
  -output "$BINS/kcli-universal-apple-darwin"

# AI sidecar (optional — skip if kubilitics-ai is not ready)
cd "$ROOT/kubilitics-ai"
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" \
  -o "$BINS/kubilitics-ai-x86_64-apple-darwin"   ./cmd/server/main.go
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" \
  -o "$BINS/kubilitics-ai-aarch64-apple-darwin"  ./cmd/server/main.go
lipo -create \
  "$BINS/kubilitics-ai-x86_64-apple-darwin" \
  "$BINS/kubilitics-ai-aarch64-apple-darwin" \
  -output "$BINS/kubilitics-ai-universal-apple-darwin"

# Make all binaries executable
chmod +x "$BINS/"*
```

**Expected binaries after this step:**
```
src-tauri/binaries/
  kubilitics-backend-x86_64-apple-darwin
  kubilitics-backend-aarch64-apple-darwin
  kubilitics-backend-universal-apple-darwin
  kcli-x86_64-apple-darwin
  kcli-aarch64-apple-darwin
  kcli-universal-apple-darwin
  kubilitics-ai-x86_64-apple-darwin       (optional)
  kubilitics-ai-aarch64-apple-darwin      (optional)
  kubilitics-ai-universal-apple-darwin    (optional)
```

#### Step 2 — Build frontend in Tauri mode (see §4.5)

#### Step 3 — Run Tauri build

```bash
cd "$ROOT/kubilitics-desktop/src-tauri"

# Unsigned build (no Apple Developer certificate)
CI=true cargo tauri build \
  --target universal-apple-darwin \
  --bundles app,dmg \
  --config '{"bundle":{"macOS":{"signingIdentity":null},"createUpdaterArtifacts":false}}'
```

**Output:**
```
kubilitics-desktop/src-tauri/target/universal-apple-darwin/release/bundle/
  macos/
    Kubilitics.app
  dmg/
    Kubilitics_<version>_universal.dmg
```

> **CI=true** disables the AppleScript Finder customization in `bundle_dmg.sh` which fails
> on headless runners (not authorized to send Apple Events).

---

### 4.7 Desktop app — Windows NSIS installer

> Windows builds are **currently disabled** in the release CI matrix.
> To re-enable, uncomment the windows matrix entry in `release.yml` (see [§11](#11-enabling-windows--linux-desktop-builds)).

```bash
# On a Windows machine with Rust (MSVC) and Tauri CLI installed:
BINS="$ROOT/kubilitics-desktop/src-tauri/binaries"
mkdir -p "$BINS"

# Build sidecar (PowerShell — use YAML env: block in CI, not inline prefix)
cd kubilitics-backend
$env:CGO_ENABLED="0"; $env:GOOS="windows"; $env:GOARCH="amd64"
go build -ldflags="-s -w" -o "$BINS\kubilitics-backend-x86_64-pc-windows-msvc.exe" .\cmd\server

cd ..\kcli
$env:CGO_ENABLED="0"; $env:GOOS="windows"; $env:GOARCH="amd64"
go build -ldflags="-s -w" -o "$BINS\kcli-x86_64-pc-windows-msvc.exe" .\cmd\kcli

# Tauri build
cd kubilitics-desktop\src-tauri
cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis,msi `
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

---

### 4.8 Desktop app — Linux AppImage / DEB / RPM

> Linux desktop builds are **currently disabled** in the release CI matrix.

```bash
BINS="$ROOT/kubilitics-desktop/src-tauri/binaries"
mkdir -p "$BINS"

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o "$BINS/kubilitics-backend-x86_64-unknown-linux-gnu" \
  "$ROOT/kubilitics-backend/cmd/server"

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags="-s -w" -o "$BINS/kcli-x86_64-unknown-linux-gnu" \
  "$ROOT/kcli/cmd/kcli"

chmod +x "$BINS/"*

cd "$ROOT/kubilitics-desktop/src-tauri"
cargo tauri build \
  --target x86_64-unknown-linux-gnu \
  --bundles appimage,deb,rpm \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

---

### 4.9 Docker image — backend

The Dockerfile lives in `kubilitics-backend/` but the build **context is the repo root**
because it also needs to copy `kcli/` for the bundled kubectl wrapper.

```bash
# Single-arch (local test)
docker build \
  --build-arg GO_VERSION=1.25.7 \
  --build-arg ALPINE_VERSION=3.21 \
  --build-arg KUBECTL_VERSION=v1.33.3 \
  -t kubilitics-backend:dev \
  -f kubilitics-backend/Dockerfile .

# Multi-arch (linux/amd64 + linux/arm64) — requires Docker Buildx
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg GO_VERSION=1.25.7 \
  --build-arg ALPINE_VERSION=3.21 \
  --build-arg KUBECTL_VERSION=v1.33.3 \
  -t ghcr.io/kubilitics/kubilitics-backend:dev \
  -f kubilitics-backend/Dockerfile \
  --push .
```

> **Context = repo root** is mandatory. The Dockerfile COPYs `kubilitics-backend/` and `kcli/`
> from the root context. Running `docker build` from inside `kubilitics-backend/` will fail.

---

### 4.10 Docker image — AI backend

```bash
# linux/amd64 only (CGO_ENABLED=1 requires native sqlite; arm64 cross-compile needs extra tooling)
docker build \
  -t ghcr.io/kubilitics/kubilitics-ai:dev \
  kubilitics-ai/

# Push to GHCR (requires `docker login ghcr.io`)
docker push ghcr.io/kubilitics/kubilitics-ai:dev
```

---

## 5. One-shot Desktop Build Script

For local development and testing the entire desktop stack:

```bash
# Full build (backend + kcli + AI + frontend Tauri mode + Tauri bundle)
./scripts/build-desktop.sh

# Skip AI sidecar (faster, AI features disabled)
./scripts/build-desktop.sh --skip-ai

# Hot-reload dev mode (frontend HMR; Go sidecars restart on demand)
./scripts/build-desktop.sh --dev
```

The script runs all 5 steps in order:
1. Build `kubilitics-backend` binary
2. Build `kcli` binary
3. Build `kubilitics-ai` binary (skippable)
4. Copy all binaries into `src-tauri/binaries/` with correct platform-triple suffixes
5. Build frontend in Tauri mode → copy to `kubilitics-desktop/dist/`

---

## 6. Pre-Release Gate — All Checks Must Pass

**Every item must be green before pushing a tag.** A failing check discovered post-tag requires a new PATCH version.

```bash
# ─── Backend ────────────────────────────────────────────────────────────────
cd "$ROOT/kubilitics-backend"
go build ./cmd/server                     # Must: zero errors
go test -count=1 ./...                    # Must: all packages ok
go vet ./...                              # Must: zero issues
govulncheck ./...                         # Must: no vulnerabilities

# ─── kcli ───────────────────────────────────────────────────────────────────
cd "$ROOT/kcli"
CGO_ENABLED=0 go build ./cmd/kcli        # Must: zero errors
go test -count=1 -timeout=120s ./...     # Must: all packages ok
go vet ./...                             # Must: zero issues

# ─── Frontend ───────────────────────────────────────────────────────────────
cd "$ROOT/kubilitics-frontend"
npm ci                                   # Clean install
npm run build                            # Must: zero errors (chunk warnings OK)
npm run test                             # Must: all tests pass
npm audit --audit-level=high             # Must: no high/critical

# ─── Version string consistency check ───────────────────────────────────────
grep '"version"' kubilitics-frontend/package.json
grep '"version"' kubilitics-desktop/src-tauri/tauri.conf.json
# Both must show the same value as $VERSION
```

Run all of the above in one shot with:
```bash
make test   # if Makefile exists, or chain the commands above
```

---

## 7. Release Procedure — End to End

```bash
VERSION="0.1.4"   # set the new version (no "v" prefix)
```

### Step 1 — Sync main

```bash
git checkout main && git pull origin main
```

### Step 2 — Run the full pre-release gate (§6)

Fix every failure before continuing. **Never tag a broken commit.**

### Step 3 — Bump version strings

```bash
# Frontend
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" \
  kubilitics-frontend/package.json

# Desktop Tauri config
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" \
  kubilitics-desktop/src-tauri/tauri.conf.json

# Verify both
grep '"version"' kubilitics-frontend/package.json \
                 kubilitics-desktop/src-tauri/tauri.conf.json
```

### Step 4 — Update CHANGELOG.md

Add a new section **above** the previous version:

```markdown
## [v0.1.4] - YYYY-MM-DD

### Fixed
- …

### Added
- …

### Changed
- …
```

### Step 5 — Stage & commit

```bash
git add kubilitics-frontend/package.json \
        kubilitics-desktop/src-tauri/tauri.conf.json \
        CHANGELOG.md
# Add any other changed files (bug fixes, docs, etc.)
git add <other-files>
git status    # review — no .env files, no build artifacts, no binaries

git commit -m "$(cat <<'EOF'
chore: release v${VERSION}

<2-3 sentence summary of what changed>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### Step 6 — Create annotated tag

```bash
git tag -a "v${VERSION}" -m "$(cat <<EOF
v${VERSION} — <release title>

<bullet 1: most important fix or feature>
<bullet 2>
<bullet 3>

macOS universal DMG only (Windows/Linux desktop builds to follow).
EOF
)"
```

### Step 7 — Confirm tag points to HEAD

```bash
git log --oneline -1
git show "v${VERSION}" --stat | head -5
# Both lines must show the same commit hash
```

### Step 8 — Push branch then tag

```bash
git push origin main         # push the release commit
git push origin "v${VERSION}"   # ← triggers release.yml CI
```

> **This is the point of no return for public repos.** Once pushed, the tag is live.
> CI will immediately start building all artifacts.

### Step 9 — Monitor CI

1. Open **Actions → Release** on GitHub.
2. Watch the following jobs:
   - `kcli` — 5 platform binaries
   - `kubilitics-ai` — 5 platform binaries
   - `backend` — Linux amd64/arm64 binaries
   - `docker-backend` — multi-arch Docker image pushed to GHCR
   - `docker-ai` — Docker image pushed to GHCR
   - `desktop (macos)` — universal DMG (macOS only; Windows/Linux disabled)
   - `release` — downloads all artifacts and creates GitHub Release
3. **Expected total time:** 25–45 minutes (desktop build dominates).

### Step 10 — Verify the GitHub Release

1. Go to **Releases** → confirm `v${VERSION}` is listed.
2. Confirm these artifacts are attached:
   - `Kubilitics_${VERSION}_universal.dmg`
   - `kcli-darwin-amd64`, `kcli-darwin-arm64`
   - `kcli-linux-amd64`, `kcli-linux-arm64`
   - `kcli-windows-amd64.exe`
   - `kubilitics-backend-linux-amd64`, `kubilitics-backend-linux-arm64`
3. Confirm GHCR images are tagged:
   - `ghcr.io/kubilitics/kubilitics-backend:${VERSION}`
   - `ghcr.io/kubilitics/kubilitics-backend:latest`
   - `ghcr.io/kubilitics/kubilitics-ai:${VERSION}`
   - `ghcr.io/kubilitics/kubilitics-ai:latest`

### Step 11 — Post-release housekeeping

- [ ] Edit the GitHub Release description to add user-facing notes.
- [ ] Reset `CHANGELOG.md` for the next development cycle (add empty `[Unreleased]` heading).
- [ ] Announce the release (Discord, GitHub Discussions, social media).
- [ ] Review and merge/close any open Dependabot PRs targeting `main`.

---

## 8. CI/CD Pipeline Reference

The release workflow (`.github/workflows/release.yml`) triggers on any tag matching `v*`.

```
Tag push v*
    │
    ├──► [kcli]            ubuntu-latest   Build 5 platform binaries (Linux/Darwin/Windows)
    ├──► [kubilitics-ai]   ubuntu-latest   Build 5 platform binaries (matrix strategy)
    ├──► [backend]         ubuntu-latest   Build Linux amd64 + arm64 binaries
    ├──► [docker-backend]  ubuntu-latest   Build & push multi-arch Docker image to GHCR
    ├──► [docker-ai]       ubuntu-latest   Build & push linux/amd64 Docker image to GHCR
    └──► [desktop]         macos-latest    Build universal macOS DMG
              │
              ▼
         [release]         ubuntu-latest   Downloads all artifacts → creates GitHub Release
                           (runs if: !cancelled() — proceeds even if desktop has errors)
```

**Key CI behaviours:**

| Property | Value | Reason |
|---|---|---|
| `concurrency.cancel-in-progress` | `false` | Never cancel a release mid-flight |
| `desktop: continue-on-error` | `true` | Desktop failures don't block CLI/Docker release |
| `release: if: !cancelled()` | Always runs | Ensures release is created even if some jobs fail |
| `beforeBuildCommand` in tauri.conf.json | `""` | Frontend is built separately and copied; Tauri must not re-invoke npm |
| `CI=true` on cargo tauri build | Set | Disables AppleScript Finder customization (fails on headless runners) |

**Frontend dist flow (desktop):**

```
kubilitics-frontend/     TAURI_BUILD=true npm run build
         │
         ▼
kubilitics-frontend/dist/     ← Vite output with Tauri settings
         │  cp -r
         ▼
kubilitics-desktop/dist/      ← tauri.conf.json: frontendDist: "../dist"
```

---

## 9. Artifact Reference Table

### GitHub Release assets

| File name | Built by job | Description |
|---|---|---|
| `Kubilitics_<ver>_universal.dmg` | `desktop (macos)` | macOS installer (Intel + Apple Silicon) |
| `kcli-darwin-amd64` | `kcli` | kcli for macOS Intel |
| `kcli-darwin-arm64` | `kcli` | kcli for macOS Apple Silicon |
| `kcli-linux-amd64` | `kcli` | kcli for Linux x86_64 |
| `kcli-linux-arm64` | `kcli` | kcli for Linux ARM64 |
| `kcli-windows-amd64.exe` | `kcli` | kcli for Windows x86_64 |
| `kubilitics-backend-linux-amd64` | `backend` | Standalone backend for Linux x86_64 |
| `kubilitics-backend-linux-arm64` | `backend` | Standalone backend for Linux ARM64 |
| `kubilitics-ai-darwin-amd64` | `kubilitics-ai` | AI backend for macOS Intel |
| `kubilitics-ai-darwin-arm64` | `kubilitics-ai` | AI backend for macOS Apple Silicon |
| `kubilitics-ai-linux-amd64` | `kubilitics-ai` | AI backend for Linux x86_64 |

### Docker images (GHCR)

| Image | Tags | Platforms |
|---|---|---|
| `ghcr.io/kubilitics/kubilitics-backend` | `<version>` · `<major.minor>` · `<major>` · `latest` | linux/amd64, linux/arm64 |
| `ghcr.io/kubilitics/kubilitics-ai` | `<version>` · `<major.minor>` · `<major>` · `latest` | linux/amd64 |

### Desktop sidecar binaries (internal, inside `.app` bundle)

These live inside `Kubilitics.app/Contents/MacOS/` and are **not** shipped as separate downloads:

| File | Description |
|---|---|
| `kubilitics-backend-universal-apple-darwin` | Backend sidecar (fat binary) |
| `kcli-universal-apple-darwin` | kcli sidecar (fat binary) |
| `kubilitics-ai-universal-apple-darwin` | AI sidecar (fat binary) |

---

## 10. Secrets & Code Signing

### Required GitHub Actions secrets

| Secret name | Used by | Required? | What it does |
|---|---|---|---|
| `GITHUB_TOKEN` | All jobs | **Auto-provided** | Push to GHCR, create release |
| `TAURI_SIGNING_PRIVATE_KEY` | `desktop` | Optional | Signs `.dmg.sig` updater artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `desktop` | Optional | Password for above key |
| `APPLE_CERTIFICATE` | `desktop` | Optional | Apple Developer `.p12` certificate (base64) |
| `APPLE_CERTIFICATE_PASSWORD` | `desktop` | Optional | Password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `desktop` | Optional | e.g. `"Developer ID Application: Acme Corp (TEAMID)"` |
| `APPLE_ID` | `desktop` | Optional | Apple ID email for notarization |
| `APPLE_PASSWORD` | `desktop` | Optional | App-specific password for notarization |
| `APPLE_TEAM_ID` | `desktop` | Optional | 10-char Apple Team ID |

**Without signing secrets:** The CI build still succeeds and produces a working unsigned `.dmg` — macOS will show a "developer cannot be verified" warning. Users must right-click → Open to bypass Gatekeeper.

**With signing:** CI imports the certificate, codesigns the `.app`, and notarizes via `notarytool`. The DMG is Gatekeeper-transparent and requires no user override.

### Generating a Tauri update signing key

```bash
# On any machine with Tauri CLI:
cargo tauri signer generate -w ~/.tauri/kubilitics.key
# Outputs:
#   Private key: ~/.tauri/kubilitics.key    → TAURI_SIGNING_PRIVATE_KEY secret
#   Public key:  in tauri.conf.json plugins.updater.pubkey
```

---

## 11. Enabling Windows / Linux Desktop Builds

Windows and Linux desktop builds are commented out in the CI matrix. To re-enable:

```yaml
# .github/workflows/release.yml — desktop job matrix:
matrix:
  include:
    - os: macos-latest
      name: macos
    - os: windows-latest      # ← uncomment to enable
      name: windows
    - os: ubuntu-latest       # ← uncomment to enable
      name: linux
```

**Before enabling Windows builds**, verify:
- `CGO_ENABLED` must be set via the YAML `env:` block, **not** inline (`CGO_ENABLED=0 go build` is invalid PowerShell).
- `shell: bash` is set on all cross-platform steps (converts to Git Bash on Windows runners).

**Before enabling Linux builds**, verify:
- The `apt-get install` step for GTK/WebKit2 dependencies is present.
- Test the `AppImage` output by running it on a clean Ubuntu VM before shipping.

---

## 12. Hotfix Releases

Use when `main` has moved on and a critical fix is needed against a specific shipped release:

```bash
HOTFIX_VERSION="0.1.4"
BASE_TAG="v0.1.3"

# Branch from the broken tag, not from main
git checkout -b "hotfix/v${HOTFIX_VERSION}" "${BASE_TAG}"

# Apply the minimal targeted fix
# ... edit files ...

# Run the pre-release gate (§6)

# Follow the full release procedure (§7, steps 3–11)
# Then merge back to main:
git checkout main
git merge "hotfix/v${HOTFIX_VERSION}"
git push origin main
git branch -d "hotfix/v${HOTFIX_VERSION}"
```

---

## 13. Rollback a Bad Release

**Never delete a pushed tag** — it may be cached in users' kubeconfig updaters and other tooling.

1. Immediately mark the GitHub Release as **Pre-release** to reduce download visibility.
2. Cut a hotfix PATCH release (§12) as quickly as possible.
3. Edit the bad release description:
   ```
   ⚠️ DEPRECATED — this release contains a critical bug.
   Please download v<hotfix_version> instead: <link>
   ```
4. If the Docker image is the problem, retag `latest` to the hotfix:
   ```bash
   docker pull ghcr.io/kubilitics/kubilitics-backend:<hotfix_version>
   docker tag  ghcr.io/kubilitics/kubilitics-backend:<hotfix_version> \
               ghcr.io/kubilitics/kubilitics-backend:latest
   docker push ghcr.io/kubilitics/kubilitics-backend:latest
   ```

---

## 14. Troubleshooting Common Build Failures

### `new URL() invalid base` — WS crash on app load

```
TypeError: "/ws/resources" cannot be parsed as a URL against "ws//localhost:819"
```

**Cause:** `${protocol}//${host}` missing the `:`.
**Fix:** `useBackendWebSocket.ts` — use `${protocol}://${host}`. Already fixed in v0.1.3+.

---

### Addon card icons blank in desktop

**Cause:** Tauri CSP `img-src` only allowed `self/data/asset/tauri/blob`, blocking all `https://` CDN URLs (ArtifactHub icons).
**Fix:** Add `https: http:` to `img-src` in `tauri.conf.json`. Already fixed in v0.1.3+.

---

### Blank white screen in Tauri (WKWebView)

**Cause 1:** Frontend built without `TAURI_BUILD=true` → absolute asset paths cause 404 under `tauri://` protocol.
**Fix:** Always set `TAURI_BUILD=true npm run build` for desktop builds.

**Cause 2:** `crossorigin` attributes on `<script>` tags → WKWebView blocks CORS-mode requests for `tauri://` assets.
**Fix:** The `removeCrossOriginPlugin` Vite plugin strips these automatically when `TAURI_BUILD=true`.

**Cause 3:** Rollup chunk splitting → circular ES module imports crash WKWebView (React.forwardRef undefined).
**Fix:** `vite.config.ts` disables `manualChunks` for Tauri builds.

---

### `go.mod requires go >= 1.25.0 (running go 1.24.x; GOTOOLCHAIN=local)`

**Cause:** Dockerfile or CI pinned to an older Go version. `kcli/go.mod` requires Go ≥1.25.0.
**Fix:** Bump `ARG GO_VERSION` in `kubilitics-backend/Dockerfile` and `GO_VERSION` in `backend-ci.yml`, `kcli-ci.yml`, `release.yml`. See [§3](#3-version-pins--stay-in-sync).

---

### `govulncheck` reports vulnerabilities

**Fix:** Bump the affected dependency:
```bash
cd kubilitics-backend
go get <module>@<patched-version>
go mod tidy
go test -count=1 ./...
govulncheck ./...   # must be clean before tagging
```

---

### `CGO_ENABLED=0: The term 'CGO_ENABLED=0' is not recognized` (Windows CI)

**Cause:** Unix inline env-var syntax is invalid in PowerShell.
**Fix:** Use the YAML `env:` block on any step running on `windows-*` runners:
```yaml
- env:
    CGO_ENABLED: "0"
  run: go build ./...
```

---

### Tauri build fails: `binaries directory is empty`

**Cause:** Go sidecar binaries were not built before running `cargo tauri build`.
**Fix:** Always run the sidecar build steps (§4.6 Step 1) before Tauri. The `scripts/build-desktop.sh` script does this automatically.

---

### `lipo: can't open input file` during universal binary creation

**Cause:** One of the thin binaries (x86_64 or aarch64) failed to build silently.
**Fix:** Check each `go build` command for errors individually before running `lipo`.

---

*See also:*
- [`RELEASE-STANDARDS.md`](RELEASE-STANDARDS.md) — Governance rules, P-01 through P-08 known pitfalls
- [`release-steps.md`](release-steps.md) — Quick git-tag runbook
- [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md) — CI/CD pipeline architecture overview
- [`DESKTOP-SIDECAR.md`](DESKTOP-SIDECAR.md) — Sidecar lifecycle and IPC design
- [`DISTRIBUTION.md`](DISTRIBUTION.md) — Artifact signing and Helm chart publishing
