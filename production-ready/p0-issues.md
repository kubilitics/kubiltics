# Kubilitics P0 Production Issues — Runtime Fix Tracker

> Generated after first successful CI build (v0.1.0). The app builds but has critical runtime failures.
> Every item here is a blocker — the app is non-functional without these fixes.

---

## Summary of All P0 Issues

| # | Issue | Severity | Status | Root Cause |
|---|-------|----------|--------|------------|
| P0-1 | CORS blocks `tauri://localhost` origin | 🔴 CRITICAL | ❌ Open | `AllowedOrigins` missing Tauri origins |
| P0-2 | kubectl "Not Found" banner shown incorrectly | 🔴 CRITICAL | ❌ Open | Checks system PATH only; should use bundled `kcli` |
| P0-3 | "Connection failed. Ensure the desktop engine is running" | 🔴 CRITICAL | ❌ Open | CORS failure cascades to cluster fetch failure |
| P0-4 | Kubeconfig upload "Load failed" | 🔴 CRITICAL | ❌ Open | CORS fails before upload; kubeconfig not passed correctly |
| P0-5 | App shows port 819 in DevTools but user changed it to 8190 | 🟡 HIGH | ❌ Open | Confusion: 8190 is Docker-only. Desktop uses 819 correctly |
| P0-6 | Docker Desktop dependency assumption | 🟡 HIGH | ❌ Open | Backend/sidecar startup may fail gracefully but UI doesn't explain kubeconfig-only mode |
| P0-7 | `http://localhost:8081/health` connection refused in console | 🟠 MEDIUM | ❌ Open | AI sidecar binary not bundled / not starting |
| P0-8 | `KUBILITICS_ALLOWED_ORIGINS` not set when sidecar spawns | 🔴 CRITICAL | ❌ Open | Tauri sidecar spawns backend without passing allowed Tauri origins |

---

## P0-1 — CORS: `tauri://localhost` Blocked

### Symptom
DevTools console shows:
```
Access to fetch at 'http://localhost:819/api/v1/clusters' from origin 'tauri://localhost'
has been blocked by CORS policy: Response to preflight request doesn't pass access control
check: The 'Access-Control-Allow-Origin' header has a value 'http://localhost:5173'...
```

### Root Cause
**File:** `kubilitics-backend/internal/config/config.go:114`
```go
viper.SetDefault("allowed_origins", []string{"http://localhost:5173", "http://localhost:819"})
```
**File:** `kubilitics-backend/cmd/server/main.go:51`
```go
AllowedOrigins: []string{"http://localhost:5173", "http://localhost:819"},
```

The backend's CORS policy does NOT include `tauri://localhost` or `tauri://` scheme.
When Tauri renders the WebView, the HTTP origin is `tauri://localhost` — this is blocked.

Note: The config comment even says:
> "For Tauri desktop, set `KUBILITICS_ALLOWED_ORIGINS` to include the WebView origin (e.g. `tauri://localhost`)"
…but this env var is never set when the sidecar is spawned.

### Fix Required
**In `kubilitics-desktop/src-tauri/src/sidecar.rs` — `start_backend_process()`:**
```rust
let (_rx, _child) = sidecar_command
    .env("KUBILITICS_PORT", BACKEND_PORT.to_string())
    .env("KCLI_BIN", kcli_bin_path)
    // ADD THIS:
    .env("KUBILITICS_ALLOWED_ORIGINS", "tauri://localhost,tauri://,http://localhost:5173,http://localhost:819")
    .spawn()?;
```

**In `kubilitics-backend/internal/config/config.go` — update defaults for desktop mode:**
```go
// If running as sidecar (KUBILITICS_PORT is set), also allow tauri:// origins
viper.SetDefault("allowed_origins", []string{
    "tauri://localhost",
    "tauri://",
    "http://localhost:5173",
    "http://localhost:819",
})
```

**Also update `kubilitics-backend/cmd/server/main.go:51` hardcoded fallback:**
```go
AllowedOrigins: []string{
    "tauri://localhost",
    "tauri://",
    "http://localhost:5173",
    "http://localhost:819",
},
```

### Files to Change
- `kubilitics-desktop/src-tauri/src/sidecar.rs` → Add `KUBILITICS_ALLOWED_ORIGINS` env var when spawning
- `kubilitics-backend/internal/config/config.go:114` → Add Tauri origins to default
- `kubilitics-backend/cmd/server/main.go:51` → Add Tauri origins to fallback

---

## P0-2 — kubectl "Not Found" Banner (False Negative)

### Symptom
App shows "kubectl Not Found — kubectl is required for shell features to work" even when kubectl is installed on the system.

### Root Cause
**File:** `kubilitics-desktop/src-tauri/src/commands.rs:726-782`

The `check_kubectl_installed()` command runs:
```rust
std::process::Command::new("which").arg("kubectl").output()
```

On macOS with Tauri, the app's `PATH` is **not** the shell's `PATH`. The WebView process inherits a minimal system `PATH` (e.g., `/usr/bin:/bin`) that doesn't include Homebrew (`/opt/homebrew/bin`) or other package managers where `kubectl` is typically installed.

`which kubectl` fails not because kubectl is missing, but because Tauri's process PATH is stripped.

### Fix Required

**Option A (Recommended) — Expand PATH when checking:**
```rust
pub async fn check_kubectl_installed() -> Result<KubectlStatus, String> {
    // Expand PATH to include common installation locations
    let extended_path = format!(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
        std::env::var("PATH").unwrap_or_default()
    );

    let which_output = std::process::Command::new("which")
        .arg("kubectl")
        .env("PATH", &extended_path)
        .output();
    // ...
}
```

**Option B — Check bundled kcli binary first, treat kcli as kubectl:**
The bundled `kcli` binary IS the Kubernetes CLI wrapper. If `kcli` sidecar exists, report kubectl as "available via bundled kcli". The kubectl banner should be suppressed if kcli is available.

```rust
// In check_kubectl_installed():
// First check if bundled kcli exists — if yes, kubectl features work via kcli
if self.app_handle.shell().sidecar("kcli").is_ok() {
    return Ok(KubectlStatus {
        installed: true,
        version: Some("bundled kcli".to_string()),
        path: Some("bundled".to_string()),
    });
}
```

**Option C — Only show banner when shell features are actually attempted:**
Don't show the kubectl banner on startup at all. Only show it when the user opens a terminal/shell tab and the command fails.

### Files to Change
- `kubilitics-desktop/src-tauri/src/commands.rs:726-782` → Fix PATH expansion
- `kubilitics-frontend/src/components/KubectlValidationBanner.tsx` → Only show when kcli also unavailable

---

## P0-3 — "Connection failed. Ensure the desktop engine is running"

### Symptom
Cluster connect page shows red error banner: "Connection failed. Ensure the desktop engine is running."

### Root Cause
**File:** `kubilitics-frontend/src/pages/ClusterConnect.tsx:364-373`

The error shows when:
1. `isBackendConfigured` is true (backend URL is set)
2. `clustersFromBackend.error` OR `discoveredClustersRes.error` is truthy
3. No registered clusters exist

The `clustersFromBackend.error` is truthy because the fetch to `http://localhost:819/api/v1/clusters` is **blocked by CORS** (P0-1). The CORS block makes the fetch throw a network error, which is interpreted as "backend not running."

### Fix Required
This is a **cascade from P0-1**. Fix P0-1 (CORS) first.

Additionally, improve the error message to distinguish between:
- Backend not started (port not listening) → "Desktop engine not running"
- CORS/network error (port listening but request blocked) → "Connection error — check backend config"
- No clusters configured → "No clusters found — add a kubeconfig"

**File to update:** `kubilitics-frontend/src/pages/ClusterConnect.tsx`
```tsx
// Better error detection:
const isBackendDown = !isPortResponding(819); // check via Tauri invoke
const isCORSError = error?.message?.includes('CORS') || error?.message?.includes('blocked');

{isCORSError && <span>API connection blocked — check CORS configuration</span>}
{isBackendDown && <span>Desktop engine not running. Restart the app.</span>}
{!isCORSError && !isBackendDown && <span>No clusters found. Add a kubeconfig to get started.</span>}
```

### Files to Change
- Fix P0-1 first
- `kubilitics-frontend/src/pages/ClusterConnect.tsx` → Improve error categorization

---

## P0-4 — Kubeconfig Upload "Load failed"

### Symptom
When manually selecting a kubeconfig file via "Browse" or drag-and-drop, the UI shows "Load failed."

### Root Cause (Multiple)

**Root Cause A — CORS blocks the upload POST:**
The kubeconfig upload sends a POST to `http://localhost:819/api/v1/clusters` with `X-Kubeconfig: <base64>` header. This request is blocked by CORS (P0-1) before it even reaches the backend.

**Root Cause B — File picker dialog issues on macOS:**
`select_kubeconfig_file` uses `tauri_plugin_dialog` with a blocking `mpsc::channel`. On macOS, dialog APIs must run on the main thread. A blocking channel in an async context can deadlock.

**File:** `kubilitics-desktop/src-tauri/src/commands.rs:293-319`
```rust
// PROBLEM: blocking recv() in async context
let (tx, rx) = mpsc::channel();  // std::sync::mpsc — BLOCKING
app_handle.dialog().file()...pick_file(move |file_path| {
    let _ = tx.send(path_str);
});
match rx.recv() {  // THIS BLOCKS THE ASYNC EXECUTOR
    Ok(path) => Ok(path),
    ...
}
```

### Fix Required

**Fix A:** Resolve P0-1 (CORS) first.

**Fix B — Use async oneshot channel for file dialog:**
```rust
#[command]
pub async fn select_kubeconfig_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    let (tx, rx) = oneshot::channel();

    app_handle.dialog()
        .file()
        .set_title("Select Kubeconfig File")
        .add_filter("Kubeconfig", &["yaml", "yml"])
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path| {
            let path_str = file_path.and_then(|p| match p {
                tauri_plugin_dialog::FilePath::Path(path) => Some(path.to_string_lossy().to_string()),
                tauri_plugin_dialog::FilePath::Url(url) => Some(url.to_string()),
            });
            let _ = tx.send(path_str);
        });

    rx.await.map_err(|_| "Dialog channel closed".to_string())
}
```

**Fix C — Also add `X-Kubeconfig` to backend CORS AllowedHeaders:**
```go
// kubilitics-backend/cmd/server/main.go
AllowedHeaders: []string{
    "Content-Type", "Authorization", "X-Request-ID",
    "X-Confirm-Destructive", "X-API-Key",
    "X-Kubeconfig",            // ADD THIS
    "X-Kubeconfig-Context",    // ADD THIS
},
```

### Files to Change
- Fix P0-1 first (CORS origins)
- `kubilitics-desktop/src-tauri/src/commands.rs:293-319` → Use `tokio::sync::oneshot` instead of `std::sync::mpsc`
- `kubilitics-backend/cmd/server/main.go` → Add `X-Kubeconfig` and `X-Kubeconfig-Context` to AllowedHeaders

---

## P0-5 — Port Confusion: 8190 vs 819

### Symptom
User changed backend to port `8190` for "standardization" but app still connects to port `819`.

### Clarification
**Port 8190 is NOT the desktop port.** Looking at the codebase:

- `kubilitics-backend/Dockerfile:119` → `EXPOSE 8190` — This is the Docker **container** port for integration tests and server deployments
- `kubilitics-desktop/src-tauri/src/sidecar.rs:9` → `const BACKEND_PORT: u16 = 819` — Desktop sidecar port
- Integration test YAML files use `localhost:8190` for Docker Compose mapped port

**819 is correct for the desktop app.** The app is NOT broken here — it was intentional.

### Action Required
Verify intent: Should the desktop sidecar also use 8190? If yes:

**Files to change:**
- `kubilitics-desktop/src-tauri/src/sidecar.rs:9` → `const BACKEND_PORT: u16 = 8190`
- `kubilitics-desktop/src-tauri/tauri.conf.json:86` → Update CSP: change `http://localhost:819 ws://localhost:819` to `http://localhost:8190 ws://localhost:8190`
- `kubilitics-frontend/src/lib/backendConstants.ts:8` → `|| 8190`
- `kubilitics-frontend/.env.local` → `VITE_BACKEND_PORT=8190`, `VITE_BACKEND_URL=http://localhost:8190`
- `kubilitics-backend/internal/config/config.go:108` → `viper.SetDefault("port", 8190)`
- `kubilitics-backend/cmd/server/main.go:47` → `Port: 8190`
- `kubilitics-ai/internal/config/defaults.go:15` → `cfg.Backend.HTTPBaseURL = "http://localhost:8190"`
- `kubilitics-ai/internal/mcp/server/backend_http.go:40` → `baseURL = "http://localhost:8190"`

**Recommendation:** Keep 819 for now unless the Docker/k8s deployment also needs alignment. Don't change port unless there's a specific conflict reason — changing port requires updating 10+ files.

---

## P0-6 — Docker Desktop Dependency / "Kubeconfig-Only" Mode

### Symptom
App implies it needs "desktop engine running" (Docker Desktop / local k8s). User expects it to work like Headlamp/Lens — just needs a kubeconfig file.

### How Headlamp/Lens Work
- **No local k8s dependency**
- Read kubeconfig (`~/.kube/config`) on startup
- Connect to remote cluster APIs directly from the desktop app using the kubeconfig credentials
- No sidecar backend needed for basic cluster operations

### Current Kubilitics Architecture
- Tauri desktop spawns a Go backend sidecar (port 819)
- Frontend talks to the local Go backend, which talks to k8s API
- This is correct — the Go backend acts as a secure proxy/intermediary
- The issue is: the Go backend itself needs to be given the kubeconfig

### Root Cause
The backend starts WITHOUT a kubeconfig. The frontend is supposed to send kubeconfig via `X-Kubeconfig` header on every request. But this pipeline breaks because:
1. CORS blocks the request (P0-1)
2. Even if CORS is fixed, auto-detection of `~/.kube/config` may not work in sidecar context

### Fix Required

**Step 1:** Fix CORS (P0-1) — this enables the kubeconfig header flow to work.

**Step 2:** Ensure backend sidecar auto-reads `~/.kube/config` on startup as fallback:

**File:** `kubilitics-desktop/src-tauri/src/sidecar.rs`
```rust
// In start_backend_process(), pass KUBECONFIG env var:
let kubeconfig_path = dirs::home_dir()
    .map(|h| h.join(".kube").join("config"))
    .filter(|p| p.exists())
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or_default();

let (_rx, _child) = sidecar_command
    .env("KUBILITICS_PORT", BACKEND_PORT.to_string())
    .env("KCLI_BIN", kcli_bin_path)
    .env("KUBILITICS_ALLOWED_ORIGINS", "tauri://localhost,tauri://,http://localhost:5173")
    .env("KUBECONFIG", kubeconfig_path)  // ADD THIS
    .spawn()?;
```

**Step 3:** On first app launch, auto-detect and auto-load `~/.kube/config`:

**File:** `kubilitics-frontend/src/pages/ClusterConnect.tsx` or equivalent
- If backend is running and `~/.kube/config` exists → automatically discover clusters
- Show clusters without requiring manual kubeconfig upload
- Match Headlamp/Lens UX: open the app and see your clusters

### Files to Change
- `kubilitics-desktop/src-tauri/src/sidecar.rs` → Pass `KUBECONFIG` env var to backend
- Frontend auto-detect flow (ClusterConnect or equivalent) → Auto-call discover on startup if no clusters are configured

---

## P0-7 — AI Backend (`localhost:8081`) Connection Refused

### Symptom
DevTools console shows: `GET http://localhost:8081/health net::ERR_CONNECTION_REFUSED`

### Root Cause
The AI backend sidecar (`kubilitics-ai`) fails to start. Possible causes:
1. AI binary is not compiled/bundled in the release build
2. AI binary is for wrong target triple
3. `KUBILITICS_BACKEND_ADDRESS: localhost:50051` references a gRPC port that doesn't exist

### Fix Required

**Step 1:** Check if AI binary is in the release bundle:
```bash
ls -la kubilitics-desktop/src-tauri/binaries/ | grep kubilitics-ai
```

**Step 2:** If not bundled, either:
- Build and add AI binary to `binaries/` AND `tauri.conf.json` `externalBin`
- OR make AI backend optional and handle gracefully (it already has `check_ai_binary_exists` logic)

**Step 3:** Improve sidecar startup error logging — surface AI startup failure to user via notification:
```rust
match self.start_ai_backend_process().await {
    Ok(_) => { /* ... */ }
    Err(e) => {
        eprintln!("Failed to start AI backend: {}", e);
        // Show user notification that AI features are unavailable
        // Don't block app startup
        *self.ai_available.lock().unwrap() = false;
    }
}
```

**Step 4:** The AI health check at startup shouldn't block the main app. AI features should be clearly marked "optional" in the UI.

### Files to Change
- `kubilitics-desktop/src-tauri/binaries/` → Ensure `kubilitics-ai` binary exists for all target platforms
- `kubilitics-desktop/src-tauri/src/sidecar.rs` → Surface AI start failure as a non-blocking notification
- Frontend AI components → Show "AI features unavailable" gracefully when AI backend is down

---

## P0-8 — `KUBILITICS_ALLOWED_ORIGINS` Not Passed to Sidecar (Root of P0-1)

### This is the single most important fix. The backend config comment explicitly says to set this env var for Tauri desktop, but `sidecar.rs` never does.

**File:** `kubilitics-desktop/src-tauri/src/sidecar.rs:64-72`

Current code:
```rust
let (_rx, _child) = sidecar_command
    .env("KUBILITICS_PORT", BACKEND_PORT.to_string())
    .env("KCLI_BIN", kcli_bin_path)
    .spawn()?;
```

Required fix:
```rust
let (_rx, _child) = sidecar_command
    .env("KUBILITICS_PORT", BACKEND_PORT.to_string())
    .env("KCLI_BIN", kcli_bin_path)
    .env("KUBILITICS_ALLOWED_ORIGINS", "tauri://localhost,tauri://,http://localhost:5173,http://localhost:819")
    .spawn()?;
```

---

## Fix Priority Order

```
1. P0-8 / P0-1  →  Fix CORS (add KUBILITICS_ALLOWED_ORIGINS in sidecar spawn + update backend default)
2. P0-4 (Fix B) →  Fix file dialog blocking channel (tokio oneshot)
3. P0-4 (Fix C) →  Add X-Kubeconfig header to CORS AllowedHeaders
4. P0-6          →  Pass KUBECONFIG env var to sidecar so backend auto-reads ~/.kube/config
5. P0-2          →  Fix kubectl PATH detection (expand PATH or check kcli bundle)
6. P0-3          →  Improves automatically once P0-1 is fixed; update error messages
7. P0-7          →  Check AI binary, make startup non-blocking, show graceful UI
8. P0-5          →  Confirm port 819 vs 8190 decision with team; update all files if changing
```

---

## Files Changed Per Fix (Quick Reference)

| Fix | Files |
|-----|-------|
| CORS origins | `sidecar.rs`, `config.go`, `main.go` (backend) |
| CORS headers | `main.go` (backend) — add X-Kubeconfig |
| File dialog fix | `commands.rs` — use tokio oneshot |
| kubectl detection | `commands.rs` — expand PATH |
| KUBECONFIG passthrough | `sidecar.rs` — add KUBECONFIG env var |
| Port change (if needed) | `sidecar.rs`, `tauri.conf.json`, `backendConstants.ts`, `.env.local`, `config.go`, `main.go` (backend), `defaults.go` (AI), `backend_http.go` (AI) |
| AI binary | `binaries/` directory, CI build script |

---

## How Headlamp and Lens Do It (Reference Architecture)

| Concern | Headlamp | Lens | Kubilitics (Current) | Kubilitics (Fix) |
|---------|----------|------|----------------------|------------------|
| k8s API calls | Direct from Go backend | Direct from Electron main | Via Go sidecar (819) | Via Go sidecar (819) ✅ |
| kubeconfig | Auto-reads ~/.kube/config | Auto-reads ~/.kube/config | Sent via X-Kubeconfig header | Should also auto-read via `KUBECONFIG` env |
| Docker Desktop | Not required | Not required | Not required (but CORS prevents it working) | Fixed via P0-1 |
| kubectl binary | Bundled | Bundled | Bundled (kcli) | Fix PATH check |
| CORS | N/A (Electron has no CORS) | N/A (Electron has no CORS) | Must add tauri:// origin | Fix via P0-8 |

> **Note:** Tauri uses WebKit WebView which enforces CORS (unlike Electron's Chromium which can bypass CORS for local requests). This is the fundamental architectural difference that requires `tauri://localhost` to be in the allowed origins list.

---

*Last updated: 2026-02-19 — post first successful build of v0.1.0*
