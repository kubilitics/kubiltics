# Kubilitics Production Readiness Audit
*Full codebase audit after first successful v0.1.0 build — 2026-02-19*

---

## The One Rule

> **The app must work with just a kubeconfig file. No kubectl. No Docker Desktop. No local Kubernetes. Period.**
> This is how Headlamp and Lens work. This is how Kubilitics must work.

---

## Status After This Audit

| Category | Before | After |
|----------|--------|-------|
| CORS — Tauri origin blocked | ❌ All API calls failed | ✅ Fixed |
| kubectl "Not Found" false alarm | ❌ Showed on every launch | ✅ Fixed |
| Startup blank screen | ❌ Frozen UI for 2–30s | ✅ Fixed with overlay |
| Kubeconfig upload "Load failed" | ❌ CORS + dialog deadlock | ✅ Fixed |
| Cluster auto-detection | ❌ Manual import required | ✅ Auto-reads ~/.kube/config |
| File dialog deadlock | ❌ Could deadlock on macOS | ✅ tokio oneshot |
| beforeBuildCommand empty | ❌ Silent local build failures | ✅ npm run build |
| Backend startup non-blocking | ❌ Hard-fails after 30s | ✅ Emits events, degrades gracefully |
| Go CVEs (5 total) | ❌ govulncheck failing | ✅ go1.24.13 |
| Desktop CI Rust test | ❌ Binary stubs missing | ✅ CI creates stubs |
| Docker arm64 vite missing | ❌ npm --prefer-offline fails cold | ✅ Removed flag |

---

## Architecture Reality Check

```
User's kubeconfig
      │
      ▼
┌─────────────┐     spawn      ┌──────────────────────┐
│  Tauri App  │ ─────────────► │ kubilitics-backend   │
│  (WebView)  │ ◄─────────────  (Go HTTP, port 819)   │
│             │   HTTP + WS     │                      │
│  tauri://   │                 │ Reads kubeconfig     │
│  localhost  │                 │ Calls k8s API        │
└─────────────┘                 │ No docker needed     │
                                └──────────────────────┘
```

**No system dependencies required.** All k8s calls go through the bundled Go backend sidecar.
- `kcli` (bundled) handles all kubectl-style operations
- `kubilitics-backend` (bundled) is the API proxy to k8s
- `kubilitics-ai` (bundled, optional) handles AI features
- System `kubectl` is **only** needed for the terminal/shell tab (optional)

---

## Issues Fixed in This Session

### FIX-1: CORS — `tauri://localhost` Was Blocked (🔴 Most Critical)

**What broke:** Every single API call from the app returned a CORS error. The cluster connect page showed "Connection failed. Ensure the desktop engine is running." — but the engine WAS running. CORS was blocking all requests before they reached the handler.

**Root cause:** Tauri WebView sends `Origin: tauri://localhost` on all `fetch()` calls. The backend CORS policy only listed `http://localhost:5173` (Vite) and `http://localhost:819` (self). `tauri://` was not in the list.

**Files changed:**
- `kubilitics-desktop/src-tauri/src/sidecar.rs` — now passes `KUBILITICS_ALLOWED_ORIGINS=tauri://localhost,tauri://,...` as env var when spawning the backend
- `kubilitics-backend/internal/config/config.go:114` — default `allowed_origins` now includes `tauri://localhost`
- `kubilitics-backend/cmd/server/main.go:51` — fallback hardcoded config also includes Tauri origins
- `kubilitics-backend/cmd/server/main.go:358` — `AllowedHeaders` now includes `X-Kubeconfig` and `X-Kubeconfig-Context`

**Lesson:** Tauri ≠ Electron. Electron can bypass CORS for localhost. Tauri's WebKit WebView enforces CORS strictly. Always add `tauri://localhost` to allowed origins for any Tauri app.

---

### FIX-2: kubectl "Not Found" Banner — False Negative + Wrong Messaging

**What broke:** The app showed a red/amber banner saying "kubectl Not Found" on every launch, even when kubectl was installed. Users thought the app was broken.

**Root cause (technical):** Tauri's process inherits a minimal `PATH` (e.g. `/usr/bin:/bin`). Homebrew (`/opt/homebrew/bin`), nix, asdf, etc. are not in this PATH. So `which kubectl` fails even when kubectl is installed by the user's package manager.

**Root cause (UX):** Even if kubectl really IS missing, the banner was alarming ("kubectl Not Found" in red/destructive style) and implied the app wouldn't work. This is wrong — kubectl is only needed for the terminal tab.

**Files changed:**
- `kubilitics-desktop/src-tauri/src/commands.rs` — `check_kubectl_installed()` now prepends `/opt/homebrew/bin:/usr/local/bin:...` to PATH before running `which kubectl`
- `kubilitics-frontend/src/components/KubectlValidationBanner.tsx` — complete rewrite:
  - Soft, dismissible style (no destructive/red colours)
  - Clear message: "Terminal shell needs kubectl — everything else works fine"
  - Dismisses and remembers via `sessionStorage`
  - On invoke error, defaults to `installed: true` (assume kubectl present, avoid false alarms)

---

### FIX-3: Startup Blank Screen — Backend Startup Must Be Non-Blocking

**What broke:** On cold start, the app showed a blank/frozen window for 2–10 seconds while `wait_for_ready()` polled for the backend health endpoint.

**Root cause:** `start_backend_process()` called `wait_for_ready()` which loops for up to 30 seconds. Even though `start_backend()` runs in an async task, the window is visible but shows nothing useful during this time.

**Files changed:**
- `kubilitics-desktop/src-tauri/src/sidecar.rs`:
  - `start()` now emits `backend-status: starting` event immediately
  - Progress events emitted every 3 seconds during startup
  - `ready` or `error` event emitted when done
  - Backend failure no longer hard-crashes the app — emits error event, lets UI show it
  - Port-already-in-use case treated as "already running" (quick restart scenario)
- `kubilitics-frontend/src/components/BackendStartupOverlay.tsx` — new component:
  - Full-screen overlay shown while backend is starting
  - Listens to `backend-status` Tauri events
  - Auto-disappears on `ready` or `error`
  - Hard timeout of 12 seconds — never permanently blocks UI
  - Shows: "No kubectl, Docker, or local Kubernetes required" reassurance text
- `kubilitics-frontend/src/App.tsx` — imports and renders `BackendStartupOverlay`

---

### FIX-4: Kubeconfig Upload "Load failed"

**Root cause A:** CORS blocked the upload request (fixed by FIX-1).

**Root cause B:** `select_kubeconfig_file()` used `std::sync::mpsc::recv()` (blocking) inside an async Tauri command. On macOS, dialog callbacks run on the main thread — the blocking recv could deadlock.

**Root cause C:** `X-Kubeconfig` and `X-Kubeconfig-Context` headers were not in CORS `AllowedHeaders`, so preflight rejected them.

**Files changed:**
- `kubilitics-desktop/src-tauri/src/commands.rs` — `select_kubeconfig_file()` now uses `tokio::sync::oneshot` instead of `std::sync::mpsc`
- `kubilitics-backend/cmd/server/main.go` — `X-Kubeconfig` and `X-Kubeconfig-Context` added to `AllowedHeaders`

---

### FIX-5: Headlamp/Lens-Style Auto-Cluster Detection

**What was missing:** Users had to manually upload a kubeconfig even when `~/.kube/config` already existed. Headlamp and Lens auto-detect this on startup.

**How it works now:**
1. Sidecar passes `KUBECONFIG=~/.kube/config` as env var to the backend
2. Backend (`main.go:138–167`) already had auto-load logic: reads kubeconfig, iterates contexts, registers all as clusters
3. On first launch with an empty DB, all kubeconfig contexts appear automatically

**Files changed:**
- `kubilitics-desktop/src-tauri/src/sidecar.rs` — resolves `~/.kube/config` and passes as `KUBECONFIG` env var

---

### FIX-6: `tauri.conf.json` `beforeBuildCommand` Empty

**What broke:** Running `cargo tauri build` locally would silently produce a broken build if the developer forgot to run `npm run build` first. The `dist/` folder would be from a previous (possibly stale) build or missing.

**Fix:** Set `"beforeBuildCommand": "npm run build"` in `tauri.conf.json`.

---

## Remaining Known Gaps (Not Blocking Release)

### GAP-1: No Splash Screen / App Icon on First Paint
**Impact:** On very slow machines, brief flash of empty window before overlay shows.
**Fix:** Add a native Tauri splash screen config in `tauri.conf.json`:
```json
"app": { "windows": [{ "visible": false }] }
```
Then emit `window.show()` after backend ready event.
**Priority:** Medium — affects UX on slow machines only.

### GAP-2: Port Collision — Stale Process Detection
**Impact:** If the backend process from a previous crash is still occupying port 819, `is_port_in_use()` returns true and we assume the backend is "already running." But the stale process might be unresponsive.
**Fix:** After detecting port in use, call `/api/v1/version` or `/health` and validate it's actually the Kubilitics backend (e.g. check a custom response header `X-Kubilitics-Version`). If it doesn't respond correctly, attempt to kill the process and restart.
**Priority:** Medium.

### GAP-3: Windows Path Expansion for kubectl
**Impact:** `check_kubectl_installed()` on Windows uses `where.exe kubectl` without PATH expansion. Chocolatey (`C:\ProgramData\chocolatey\bin`), Scoop, and winget installs may not be found.
**Fix:** Add common Windows kubectl install paths to the PATH before running `where.exe`.
**Priority:** Low — most Windows users install kubectl via official docs which adds to system PATH.

### GAP-4: AI Backend Features Silently Missing
**Impact:** If the `kubilitics-ai` binary fails to start, AI features just don't work with no explanation.
**Fix:** Wire `ai_available` state to the frontend via a `get_ai_status` invoke, and dim/disable AI UI elements when AI is unavailable.
**Priority:** Medium.

### GAP-5: No Update Channel in Production
**Impact:** `plugins.updater.active: false` — no auto-updates. Users must manually download.
**Fix:** Set `active: true`, deploy an update server at `releases.kubilitics.dev`, and set the proper endpoint. The signing key and `createUpdaterArtifacts: true` are already configured.
**Priority:** High for GA release.

### GAP-6: Database Persistence Across Reinstalls
**Impact:** On Linux, `dirs::data_local_dir()` returns `~/.local/share/kubilitics`. On macOS, it returns `~/Library/Application Support/com.kubilitics.desktop`. On Windows, `%APPDATA%\kubilitics`. The backend SQLite DB lives here — reinstalling the app does NOT clear this, which is correct. But if the DB schema changes between versions, migrations must be handled.
**Fix:** Implement SQLite migration versioning in the backend.
**Priority:** Medium — important before 1.0.

### GAP-7: CSP Does Not Include Update Server
**Impact:** When auto-updater is enabled (GAP-5), the update endpoint `releases.kubilitics.dev` must be in the CSP `connect-src`. Currently it is not.
**Fix:** Add `https://releases.kubilitics.dev` to `connect-src` in `tauri.conf.json` when enabling the updater.
**Priority:** High (dependent on GAP-5).

---

## Port Reference (Single Source of Truth)

| Port | Service | Where configured |
|------|---------|-----------------|
| **819** | Go backend (desktop sidecar) | `sidecar.rs:9`, `config.go:108`, `main.go:47`, `backendConstants.ts`, CSP |
| **8081** | AI backend (sidecar) | `sidecar.rs:10`, `backendConstants.ts`, CSP |
| **5173** | Vite dev server | `tauri.conf.json:devUrl`, dev only — not in production CSP |
| **8190** | Docker container port (NOT desktop) | `Dockerfile:119`, CI integration tests only |
| **50051** | gRPC (backend ↔ AI) | `sidecar.rs` AI env, `config.go` gRPC port |

**8190 is NOT the desktop app port.** It is the Docker container's exposed port for integration testing. The desktop always uses 819.

---

## No Local Dependencies Required — Verification

| Dependency | Required? | How it's handled |
|-----------|-----------|-----------------|
| `kubectl` | ❌ NOT required | Bundled `kcli` binary handles all k8s API calls; kubectl only needed for built-in terminal tab |
| Docker Desktop | ❌ NOT required | Backend calls k8s API directly via kubeconfig credentials |
| Local Kubernetes (minikube, kind) | ❌ NOT required | Connects to any remote cluster via kubeconfig |
| Internet connection | ❌ NOT required | Works fully offline once connected to cluster |
| Specific OS version | macOS 10.13+, Win 10+, Linux (glibc) | Declared in `tauri.conf.json` |

The only user requirement: **a valid kubeconfig file** (same as `kubectl`, `helm`, Headlamp, Lens).

---

## How Headlamp/Lens Compare

| Concern | Headlamp | Lens | Kubilitics |
|---------|----------|------|-----------|
| k8s API calls | Go backend (bundled) | Electron main process | Go sidecar (bundled) ✅ |
| kubeconfig source | `~/.kube/config` auto | `~/.kube/config` auto | `~/.kube/config` auto ✅ (after FIX-5) |
| kubectl required | ❌ | ❌ | ❌ ✅ (after FIX-2) |
| Docker required | ❌ | ❌ | ❌ ✅ |
| CORS | N/A (Electron bypasses) | N/A (Electron bypasses) | Fixed via FIX-1 ✅ |
| Startup screen | Native splash | Native splash | BackendStartupOverlay ✅ (after FIX-3) |
| Terminal shell | Yes (via bundled kubectl) | Yes (via bundled kubectl) | Yes (via kcli, kubectl optional) ✅ |

---

## Release Checklist for v0.1.0

- [x] Build succeeds on macOS (universal), Windows (x64), Linux (x64, arm64)
- [x] CORS fixed — Tauri origin allowed
- [x] kubectl banner reworded — not alarming, dismissible
- [x] Startup overlay shows during backend init
- [x] Kubeconfig auto-detection on startup
- [x] File dialog fixed (tokio oneshot, no deadlock)
- [x] Go CVEs fixed (go1.24.13)
- [x] All 3 CI pipelines green (Backend, Frontend, Desktop)
- [ ] Smoke test: launch app on macOS with ~/.kube/config → clusters auto-appear
- [ ] Smoke test: launch app with NO ~/.kube/config → "Add cluster" screen shown, no error
- [ ] Smoke test: drag/drop kubeconfig → clusters appear, no "Load failed"
- [ ] Smoke test: kubectl banner NOT shown when kubectl is in PATH
- [ ] Smoke test: kubectl banner IS shown (soft, dismissible) when kubectl missing
- [ ] Auto-updater: enable and configure releases.kubilitics.dev endpoint (GAP-5)

---

*Last updated: 2026-02-19*
