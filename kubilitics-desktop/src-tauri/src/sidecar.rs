use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

/// Drain a sidecar's stdout/stderr receiver in a background task.
/// Without draining, the OS pipe buffer fills up and the child process blocks
/// on write. Logs valid UTF-8 lines with a `[label]` prefix; silently drops
/// binary frames (gRPC/protobuf bytes) so they never reach the host log viewer.
fn drain_sidecar_output(
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    label: &'static str,
) {
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    if let Ok(text) = std::str::from_utf8(&bytes) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            println!("[{}] {}", label, trimmed);
                        }
                    }
                    // Binary / non-UTF8 bytes are intentionally dropped here.
                    // They are typically raw gRPC/protobuf frames written to
                    // stdout by the Go binary and would show as garbage in any
                    // log viewer that expects text.
                }
                CommandEvent::Terminated(p) => {
                    println!("[{}] process exited (code={:?})", label, p.code);
                    break;
                }
                _ => {}
            }
        }
    });
}

use crate::backend_ports::BACKEND_PORT;
const MAX_RESTART_ATTEMPTS: u32 = 3;
const HEALTH_CHECK_INTERVAL_SECS: u64 = 10;
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 5;

/// True if we can bind to 127.0.0.1:port right now.
fn can_bind(port: u16) -> bool {
    std::net::TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok()
}

/// Ask the OS for a free TCP port on 127.0.0.1.
fn pick_free_port() -> Option<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").ok()?;
    listener.local_addr().ok().map(|a| a.port())
}

pub struct BackendManager {
    app_handle: AppHandle,
    restart_count: Arc<Mutex<u32>>,
    is_running: Arc<Mutex<bool>>,
    /// True once the backend has emitted "ready" — lets get_backend_status answer immediately.
    is_ready: Arc<Mutex<bool>>,
    /// TASK-SIDECAR-001: Store process handle so we can kill on exit, not just send HTTP shutdown.
    backend_process: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
    /// Port the backend actually listens on. Prefer BACKEND_PORT (8190) — gives
    /// the user a curl-able default. If 8190 is occupied (stale dev, another
    /// Kubilitics instance, an unrelated app), fall back to an OS-assigned
    /// free port; the frontend's `apiUrl()` / `wsUrl()` helpers (Option B —
    /// see src/lib/backendUrl.ts) read the real URL at runtime via
    /// `invoke('get_backend_url')` and follow along — no Vite-proxy mismatch
    /// possible because there is no Vite proxy. Resolved once at start() and
    /// reused across restarts.
    resolved_port: Arc<Mutex<u16>>,
}

impl BackendManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            restart_count: Arc::new(Mutex::new(0)),
            is_running: Arc::new(Mutex::new(false)),
            is_ready: Arc::new(Mutex::new(false)),
            backend_process: Arc::new(Mutex::new(None)),
            resolved_port: Arc::new(Mutex::new(BACKEND_PORT)),
        }
    }

    pub fn is_ready(&self) -> bool {
        *self.is_ready.lock().unwrap()
    }

    /// Port the backend is currently running on. Equals BACKEND_PORT in the common
    /// case; a different, OS-assigned port if 8190 was already in use at start.
    pub fn port(&self) -> u16 {
        *self.resolved_port.lock().unwrap()
    }

    /// Backend URL for frontend fetches. Always reflects the resolved port.
    pub fn url(&self) -> String {
        format!("http://localhost:{}", self.port())
    }

    /// Best-effort PID lookup for whoever is holding `port`. Used only for the
    /// human-facing error message. Cross-platform:
    ///   - Unix: `lsof -ti tcp:PORT -sTCP:LISTEN`
    ///   - Windows: `netstat -ano -p TCP` + parse the LISTENING row for :PORT
    /// Returns None if the lookup tool isn't on PATH (e.g. minimal containers)
    /// or the port is somehow already free between bind-check and lookup.
    fn port_holder_pid(port: u16) -> Option<String> {
        #[cfg(unix)]
        {
            let out = std::process::Command::new("lsof")
                .args(["-ti", &format!("tcp:{}", port), "-sTCP:LISTEN"])
                .output()
                .ok()?;
            if !out.status.success() {
                return None;
            }
            return String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
        #[cfg(windows)]
        {
            // netstat -ano output (TCP rows):
            //   Proto  Local Address     Foreign Address  State       PID
            //   TCP    0.0.0.0:8190      0.0.0.0:0        LISTENING   12345
            let out = std::process::Command::new("netstat")
                .args(["-ano", "-p", "TCP"])
                .output()
                .ok()?;
            if !out.status.success() {
                return None;
            }
            let needle = format!(":{}", port);
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let line = line.trim();
                if !line.starts_with("TCP") || !line.contains("LISTENING") {
                    continue;
                }
                let cols: Vec<&str> = line.split_whitespace().collect();
                // cols: [TCP, local, foreign, LISTENING, PID]
                if cols.len() >= 5 && cols[1].ends_with(&needle) {
                    return Some(cols[4].to_string());
                }
            }
            return None;
        }
        #[cfg(not(any(unix, windows)))]
        {
            None
        }
    }

    /// Format a friendly port-conflict error pointing the user at the PID and
    /// the exact command to free the port. Uses the platform-native command in
    /// the hint so users can copy-paste without translation.
    fn port_conflict_message(port: u16) -> String {
        let pid = Self::port_holder_pid(port);
        let kill_hint = if cfg!(windows) {
            match pid.as_deref() {
                Some(p) => format!("`taskkill /F /PID {p}`"),
                None => format!(
                    "`for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{port} ^| findstr LISTENING') do taskkill /F /PID %a`"
                ),
            }
        } else {
            match pid.as_deref() {
                Some(p) => format!("`kill -9 {p}`"),
                None => format!("`lsof -ti tcp:{port} | xargs kill -9`"),
            }
        };
        match pid {
            Some(p) => format!(
                "Port {port} is in use by PID {p}. Quit that process and relaunch, or run {kill_hint}. \
                 Kubilitics binds {port} on purpose — the dev frontend's Vite proxy targets that exact port, \
                 and silently falling back to a different port produces ECONNREFUSED on every API call."
            ),
            None => format!(
                "Port {port} is already in use. Quit the conflicting process ({kill_hint}) and relaunch."
            ),
        }
    }

    /// Start backend and health monitor. Takes Arc<Self> so the health monitor can restart
    /// the same instance (P1-2) instead of creating a new BackendManager.
    pub async fn start(self: Arc<Self>) -> Result<(), Box<dyn std::error::Error>> {
        // Emit startup event so the frontend can show a loading state.
        let _ = self.app_handle.emit("backend-status", serde_json::json!({
            "status": "starting",
            "message": "Starting backend engine…"
        }));

        // Prefer BACKEND_PORT (8190) so dev users keep a familiar curl-able
        // URL. If it's occupied (stale Kubilitics instance, unrelated app),
        // ask the OS for a guaranteed-free port. The frontend reads the real
        // URL at runtime via invoke('get_backend_url') and routes through
        // apiUrl()/wsUrl() — there is no Vite proxy to mismatch.
        //
        // Piggybacking on an existing :8190 listener is still off the table:
        // that produced orphaned UI + backend pairs every time it fired.
        let chosen_port = if can_bind(BACKEND_PORT) {
            BACKEND_PORT
        } else {
            match pick_free_port() {
                Some(p) => {
                    let holder = Self::port_holder_pid(BACKEND_PORT);
                    eprintln!(
                        "Port {} is occupied{} — backend will use OS-assigned port {} instead. \
                         The frontend follows along via apiUrl().",
                        BACKEND_PORT,
                        holder.map(|p| format!(" by PID {}", p)).unwrap_or_default(),
                        p
                    );
                    p
                }
                None => {
                    // Both 8190 AND a fresh OS-assigned port failed — likely
                    // network stack misconfiguration. Surface the error.
                    let msg = Self::port_conflict_message(BACKEND_PORT);
                    eprintln!("Backend cannot start: {}", msg);
                    let _ = self.app_handle.emit("backend-status", serde_json::json!({
                        "status": "error",
                        "message": msg,
                    }));
                    return Ok(());
                }
            }
        };
        *self.resolved_port.lock().unwrap() = chosen_port;

        match self.start_backend_process().await {
            Ok(()) => {
                *self.is_ready.lock().unwrap() = true;
                let _ = self.app_handle.emit("backend-status", serde_json::json!({
                    "status": "ready",
                    "message": "Backend engine ready"
                }));
                let _ = self.app_handle.emit("backend-circuit-reset", ());
            }
            Err(e) => {
                // FIX TASK-013: Use {:#} (alternate format) for better error messages.
                // Plain {} on boxed errors often produces empty string or unhelpful Rust internals.
                eprintln!("Backend failed to start: {:#}", e);
                let _ = self.app_handle.emit("backend-status", serde_json::json!({
                    "status": "error",
                    "message": format!("Backend engine failed to start: {:#}", e)
                }));
            }
        }

        Self::start_health_monitor(self.clone());

        Ok(())
    }

    /// P0-E / P1-1: Restart the backend process (e.g. from "Restart Engine" in UI).
    /// Emits backend-status: starting, then on success backend-status: ready and backend-circuit-reset.
    pub async fn restart(&self) -> Result<(), Box<dyn std::error::Error>> {
        let _ = self.app_handle.emit("backend-status", serde_json::json!({
            "status": "starting",
            "message": "Restarting backend engine…"
        }));
        self.start_backend_process().await?;
        let _ = self.app_handle.emit("backend-status", serde_json::json!({
            "status": "ready",
            "message": "Backend engine ready"
        }));
        let _ = self.app_handle.emit("backend-circuit-reset", ());
        Ok(())
    }

    async fn start_backend_process(&self) -> Result<(), Box<dyn std::error::Error>> {
        let sidecar_command = self.app_handle.shell().sidecar("kubilitics-backend")?;
        let port = self.port();

        // Resolve kcli binary path for bundled binary
        let kcli_bin_path = self.resolve_kcli_binary_path().await?;

        // Resolve kubeconfig path so the backend can auto-load clusters on startup
        // (mirrors how Headlamp/Lens work — no manual kubeconfig import required)
        let kubeconfig_path = dirs::home_dir()
            .map(|h| h.join(".kube").join("config"))
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        // Tauri WebView uses the origin `tauri://localhost` for all fetch() requests.
        // The backend's CORS policy must explicitly allow this origin — it will NOT
        // be included in the default config because the default is browser-only.
        // FIX TASK-011: Include http://tauri.localhost for Windows (Tauri 2.0 on Windows
        // uses http://tauri.localhost instead of the tauri:// custom-protocol scheme).
        let tauri_allowed_origins = format!(
            "tauri://localhost,tauri://,http://tauri.localhost,http://localhost:5173,http://localhost:{}",
            port
        );

        // P0-J: Resolve user-writable DB path.
        // Default "./kubilitics.db" writes into the .app bundle on signed macOS, which is
        // read-only under Gatekeeper. Always write to the OS-standard app data directory.
        // macOS: ~/Library/Application Support/kubilitics/kubilitics.db
        // Linux: ~/.local/share/kubilitics/kubilitics.db
        let db_path = dirs::data_local_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
            .join("kubilitics");
        // Create the directory if it doesn't exist (best-effort; backend will also try)
        let _ = std::fs::create_dir_all(&db_path);
        let db_file = db_path.join("kubilitics.db");

        // FIX TASK-015: Only set KUBECONFIG env var when path is non-empty.
        // Passing KUBECONFIG="" causes some k8s client versions to skip the default
        // kubeconfig search instead of falling back to ~/.kube/config.
        let mut cmd = sidecar_command
            .env("KUBILITICS_PORT", port.to_string())
            // Allow tauri:// origin so fetch() calls from the WebView are not blocked by CORS
            .env("KUBILITICS_ALLOWED_ORIGINS", tauri_allowed_origins)
            // P0-J: Write SQLite DB to user-writable location (not read-only .app bundle)
            .env("KUBILITICS_DATABASE_PATH", db_file.to_string_lossy().as_ref())
            // AI wiring — backend proxies chat/capabilities to the brain sidecar.
            // Without these three env vars, /api/v1/ai/* returns 404 and the
            // Chat panel shows "AI Unreachable" even when the brain itself is up.
            //   KUBILITICS_AI_ENABLED=true         → register the /ai routes
            //   KUBILITICS_AI_ENDPOINT             → brain gRPC (matches BRAIN_GRPC_PORT)
            //   KUBILITICS_AI_HTTP_ENDPOINT        → brain HTTP  (matches BRAIN_HTTP_PORT)
            .env("KUBILITICS_AI_ENABLED", "true")
            .env("KUBILITICS_AI_ENDPOINT", {
                // Use the resolved gRPC port from BrainManager so a port-fallback
                // brain is still reachable from the backend.
                self.app_handle
                    .try_state::<Arc<BrainManager>>()
                    .map(|m| m.grpc_target())
                    .unwrap_or_else(|| format!("localhost:{}", BRAIN_GRPC_PORT))
            })
            .env("KUBILITICS_AI_HTTP_ENDPOINT", {
                // Use the resolved brain URL from BrainManager state so a
                // port-fallback brain is still reachable from the backend.
                self.app_handle
                    .try_state::<Arc<BrainManager>>()
                    .map(|m| m.url())
                    .unwrap_or_else(|| format!("http://localhost:{}", BRAIN_HTTP_PORT))
            });

        // Only set KCLI_BIN when the sidecar actually found a real path.
        // Setting KCLI_BIN="" or KCLI_BIN="kcli" (bare name) causes the backend to
        // hard-fail on os.Stat() without trying system PATH or common install locations.
        if !kcli_bin_path.is_empty() {
            cmd = cmd.env("KCLI_BIN", &kcli_bin_path);
        }

        if !kubeconfig_path.is_empty() {
            cmd = cmd.env("KUBECONFIG", &kubeconfig_path);
        }

        let (rx, child) = cmd.spawn()?;
        drain_sidecar_output(rx, "backend");

        // TASK-SIDECAR-001: Store the process handle so stop() can kill it on force-quit.
        *self.backend_process.lock().unwrap() = Some(child);
        *self.is_running.lock().unwrap() = true;
        println!("Kubilitics backend started on http://localhost:{}", port);

        // Wait for backend to be ready
        self.wait_for_ready().await?;

        Ok(())
    }

    async fn wait_for_ready(&self) -> Result<(), Box<dyn std::error::Error>> {
        let url = format!("http://localhost:{}/health", self.port());

        // Performance optimization: Allow up to 60 seconds (120 attempts × 500ms) for the backend to start.
        // Go binary cold-start on first launch can take 10-15 seconds on a slow machine.
        // Add 22 SQLite migrations on first launch, which adds more time.
        // Emit progress events less frequently (every 2 seconds instead of 3) to reduce overhead.
        // Backend starts in background - UI is not blocked (handled by non-blocking overlay).
        for attempt in 1..=120 {
            if let Ok(response) = reqwest::get(&url).await {
                if response.status().is_success() {
                    println!("Backend is ready after {} attempts", attempt);
                    return Ok(());
                }
            }
            // Emit progress every 2 seconds (every 4 attempts) - less frequent to reduce overhead
            // UI is not blocked, so frequent updates aren't needed
            if attempt % 4 == 0 {
                let elapsed = attempt / 2; // seconds
                let _ = self.app_handle.emit("backend-status", serde_json::json!({
                    "status": "starting",
                    "message": format!("Starting backend engine… ({}s)", elapsed)
                }));
            }
            sleep(Duration::from_millis(500)).await;
        }

        Err("Backend failed to become ready within 60 seconds. Check that port 8190 is not blocked by another application.".into())
    }

    /// P1-11: Only treat port as "in use by our backend" if the health response is from kubilitics-backend.
    /// Another HTTP server on 8190 would otherwise be treated as ready and we'd skip spawning.
    /// P1-2: Use the same Arc<BackendManager> so restart_count is shared and we don't create a new manager on each restart.
    fn start_health_monitor(this: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS)).await;

                let running = {
                    let guard = this.is_running.lock().unwrap();
                    *guard
                };

                if !running {
                    continue;
                }

                if !Self::check_health(this.port()).await {
                    println!("Backend health check failed. Attempting restart...");

                    let count = {
                        let mut guard = this.restart_count.lock().unwrap();
                        *guard += 1;
                        *guard
                    };

                    if count <= MAX_RESTART_ATTEMPTS {
                        if let Err(e) = this.start_backend_process().await {
                            eprintln!("Failed to restart backend: {}", e);
                        } else {
                            println!("Backend restarted successfully (attempt {})", count);
                            let _ = this.app_handle.emit("backend-status", serde_json::json!({
                                "status": "ready",
                                "message": "Backend engine ready"
                            }));
                            let _ = this.app_handle.emit("backend-circuit-reset", ());
                        }
                    } else {
                        eprintln!("Max restart attempts reached. Backend will not restart.");
                        let mut guard = this.is_running.lock().unwrap();
                        *guard = false;
                    }
                }
            }
        });
    }

    async fn check_health(port: u16) -> bool {
        let url = format!("http://localhost:{}/health", port);
        
        match tokio::time::timeout(
            Duration::from_secs(HEALTH_CHECK_TIMEOUT_SECS),
            reqwest::get(&url)
        ).await {
            Ok(Ok(response)) => response.status().is_success(),
            _ => false,
        }
    }

    pub async fn stop(&self) {
        *self.is_running.lock().unwrap() = false;

        // Try graceful HTTP shutdown; fall through to SIGKILL on failure or force-quit.
        let url = format!("http://localhost:{}/api/v1/shutdown", self.port());
        let client = reqwest::Client::new();
        let _ = client.post(&url).send().await;

        // Wait briefly for graceful exit, then kill the process handle if still alive.
        sleep(Duration::from_millis(1500)).await;
        if let Ok(mut guard) = self.backend_process.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
                println!("Backend process killed on exit");
            }
        }

        println!("Backend stopped");
    }

    /// P1-10: Resolve kcli binary deterministically by target triple so universal builds pick the correct arch.
    async fn resolve_kcli_binary_path(&self) -> Result<String, Box<dyn std::error::Error>> {
        let kcli_sidecar_exists = self.app_handle.shell().sidecar("kcli").is_ok();

        if kcli_sidecar_exists {
            let dirs_to_check = vec![
                self.app_handle.path().resource_dir().ok(),
                std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())),
            ];

            // Build expected name from compile-time target triple
            let target = std::env::consts::ARCH;
            let os = std::env::consts::OS;
            let vendor = match os { "macos" | "ios" => "apple", "windows" => "pc", _ => "unknown" };
            let os_suffix = match os { "macos" => "darwin", "ios" => "ios", "linux" => "linux-gnu", "windows" => "windows-msvc", _ => os };
            let expected_base = format!("kcli-{}-{}-{}", target, vendor, os_suffix);
            #[cfg(windows)] let expected_name = format!("{}.exe", expected_base);
            #[cfg(not(windows))] let expected_name = expected_base;

            for dir_opt in dirs_to_check {
                if let Some(dir) = dir_opt {
                    if let Ok(entries) = std::fs::read_dir(&dir) {
                        let mut fallback_path: Option<std::path::PathBuf> = None;

                        for entry in entries.flatten() {
                            let path = entry.path();
                            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                            let is_executable = path.metadata().ok().map(|m| {
                                #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; m.permissions().mode() & 0o111 != 0 }
                                #[cfg(windows)] { file_name.ends_with(".exe") || file_name == "kcli" }
                                #[cfg(not(any(unix, windows)))] { true }
                            }).unwrap_or(false);

                            if !is_executable { continue; }
                            
                            if file_name == expected_name {
                                return Ok(path.to_string_lossy().to_string());
                            }
                            if (file_name == "kcli" || file_name == "kcli.exe" || file_name.starts_with("kcli-")) && fallback_path.is_none() {
                                fallback_path = Some(path.clone());
                            }
                        }
                        if let Some(p) = fallback_path {
                            return Ok(p.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
        
        // Fallback: try to find kcli in PATH
        let which_cmd = if cfg!(target_os = "windows") { "where.exe" } else { "which" };
        if let Ok(output) = std::process::Command::new(which_cmd)
            .arg("kcli")
            .output()
        {
            if output.status.success() {
                if let Ok(path_str) = String::from_utf8(output.stdout) {
                    let trimmed = path_str.lines().next().unwrap_or("").trim();
                    if !trimmed.is_empty() {
                        return Ok(trimmed.to_string());
                    }
                }
            }
        }

        // Last resort: return empty string to signal "not found by sidecar".
        // The backend's resolveKCLIBinary will perform its own PATH + common-location search.
        // IMPORTANT: Previously this returned "kcli" which caused the backend to set KCLI_BIN="kcli",
        // then os.Stat("kcli") failed (relative path), and the backend hard-errored without
        // trying system PATH or common install locations. Returning "" lets the backend skip the
        // KCLI_BIN check entirely and fall through to its full resolution chain.
        Ok(String::new())
    }
}

pub fn start_backend(app_handle: &AppHandle) -> Result<Arc<BackendManager>, Box<dyn std::error::Error>> {
    let manager = Arc::new(BackendManager::new(app_handle.clone()));
    
    // Store manager in app state
    app_handle.manage(manager.clone());
    
    let manager_clone = manager.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = manager_clone.start().await {
            eprintln!("Failed to start backend: {}", e);
        }
    });
    
    Ok(manager)
}

/// Returns the actual backend URL the frontend should hit. Equals
/// http://localhost:8190 in the common case; a different URL when 8190 was
/// already in use at startup and the sidecar bound to an OS-assigned port.
///
/// The frontend must invoke this on mount — before any API calls — and store
/// the result in backendConfigStore. Without this, a dynamic port is invisible
/// to the webview and every fetch lands on the wrong process (or nothing).
#[tauri::command]
pub fn get_backend_url(app_handle: AppHandle) -> String {
    match app_handle.try_state::<Arc<BackendManager>>() {
        Some(m) => m.url(),
        None => format!("http://localhost:{}", BACKEND_PORT),
    }
}

/// Returns the current backend ready state. The frontend calls this on mount to handle
/// the race where backend-status:ready fires before the JS event listener is registered.
#[tauri::command]
pub fn get_backend_status(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let manager = app_handle.try_state::<Arc<BackendManager>>();
    let ready = manager.map(|m| m.is_ready()).unwrap_or(false);
    Ok(serde_json::json!({
        "status": if ready { "ready" } else { "starting" },
        "message": if ready { "Backend engine ready" } else { "Starting backend engine…" }
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// BrainManager — kubilitics-ai-server sidecar (Phase 6 F.2)
//
// Spawns the brain as a sibling sidecar to the backend. The brain exposes an
// HTTP health endpoint on :8081 (config-driven; see kubilitics-ai Helm chart)
// and its gRPC API on :50051. We wait for /health before marking ready.
//
// Missing-sidecar is non-fatal: if the kubilitics-ai-server binary isn't
// shipped (dev bundle, partial build), we log and skip — the AI chat panel
// will show "AI disabled" but the rest of the app works.
// ─────────────────────────────────────────────────────────────────────────────

const BRAIN_HTTP_PORT: u16 = 8081;

// 50061 to avoid collision with kubilitics-backend's gRPC on 50051.
const BRAIN_GRPC_PORT: u16 = 50061;
const BRAIN_READY_TIMEOUT_SECS: u64 = 90;

pub struct BrainManager {
    app_handle: AppHandle,
    is_ready: Arc<Mutex<bool>>,
    brain_process: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
    /// Resolved HTTP port — equals BRAIN_HTTP_PORT in the common case; a
    /// different OS-assigned port when BRAIN_HTTP_PORT was already in use.
    resolved_http_port: Arc<Mutex<u16>>,
    /// Resolved gRPC port — equals BRAIN_GRPC_PORT (50061) in the common case;
    /// a different OS-assigned port when 50061 was already in use.
    resolved_grpc_port: Arc<Mutex<u16>>,
}

impl BrainManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            is_ready: Arc::new(Mutex::new(false)),
            brain_process: Arc::new(Mutex::new(None)),
            resolved_http_port: Arc::new(Mutex::new(BRAIN_HTTP_PORT)),
            resolved_grpc_port: Arc::new(Mutex::new(BRAIN_GRPC_PORT)),
        }
    }

    pub fn is_ready(&self) -> bool {
        *self.is_ready.lock().unwrap()
    }

    /// HTTP port the brain sidecar is actually bound to.
    pub fn port(&self) -> u16 {
        *self.resolved_http_port.lock().unwrap()
    }

    /// gRPC port the brain sidecar is actually bound to.
    pub fn grpc_port(&self) -> u16 {
        *self.resolved_grpc_port.lock().unwrap()
    }

    /// Base URL for HTTP calls to the brain (e.g. health checks, provider config).
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port())
    }

    /// gRPC target for the brain (host:port, no scheme — for tonic/gRPC clients).
    pub fn grpc_target(&self) -> String {
        format!("localhost:{}", self.grpc_port())
    }

    pub async fn start(self: Arc<Self>) -> Result<(), Box<dyn std::error::Error>> {
        let _ = self.app_handle.emit("brain-status", serde_json::json!({
            "status": "starting",
            "message": "Starting AI engine…"
        }));

        let sidecar = match self.app_handle.shell().sidecar("kubilitics-ai-server") {
            Ok(s) => s,
            Err(e) => {
                // Binary not bundled. Emit "unavailable" and return Ok — the app
                // remains usable without AI.
                println!("kubilitics-ai-server sidecar not found ({}); AI disabled", e);
                let _ = self.app_handle.emit("brain-status", serde_json::json!({
                    "status": "unavailable",
                    "message": "AI engine binary not bundled; chat disabled"
                }));
                return Ok(());
            }
        };

        // Two directories matter here and they can differ across OSes:
        //   config_dir  — where ai_config::save_ai_config writes config.yaml
        //                 + keychain-managed API keys (macOS: Library/Application
        //                 Support, Linux: ~/.config, Windows: %AppData%)
        //   data_dir    — where the brain writes its SQLite DB (macOS:
        //                 Library/Application Support, Linux: ~/.local/share,
        //                 Windows: %LocalAppData%)
        // Point the brain at the correct one for each. Missing dirs are
        // created best-effort.
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
            .join("kubilitics");
        let data_dir = dirs::data_local_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
            .join("kubilitics");
        let _ = std::fs::create_dir_all(&config_dir);
        let _ = std::fs::create_dir_all(&data_dir);

        // Brain spawns with no API key on purpose — reading the keychain
        // at spawn time triggers a macOS permission dialog on every dev
        // rebuild (the binary hash changes, so the ACL stored against the
        // old hash doesn't match). Instead, save_ai_config hot-wires the
        // brain via POST /api/v1/config/provider whenever the user saves
        // a key, so the keychain is only read once per save action (by
        // the same Tauri process that wrote it, which macOS trusts).
        //
        // Net effect: brain comes up in "provider configured, no key"
        // mode until the user clicks Save & Test — which both happens
        // implicitly on Quick Connect AND is idempotent for returning
        // users. No repeating keychain dialogs.
        let http_port = self.port();
        let grpc_port = self.grpc_port();
        let cmd = sidecar
            .env("KUBILITICS_AI_HTTP_PORT", http_port.to_string())
            .env("KUBILITICS_AI_GRPC_PORT", grpc_port.to_string())
            .env("KUBILITICS_DATABASE_PATH", data_dir.join("kubilitics-ai.db").to_string_lossy().as_ref())
            // Brain must know where the backend actually landed — use the resolved
            // port from BackendManager, not the compile-time default, so a backend
            // that fell back to a free port is still reachable from the brain.
            .env("KUBILITICS_BACKEND_URL", {
                let backend = self.app_handle.try_state::<Arc<BackendManager>>();
                match backend {
                    Some(m) => m.url(),
                    None => format!("http://localhost:{}", BACKEND_PORT),
                }
            });

        let (rx, child) = cmd.spawn()?;
        drain_sidecar_output(rx, "brain");
        *self.brain_process.lock().unwrap() = Some(child);
        println!("kubilitics-ai-server started on http://localhost:{} (gRPC :{})", http_port, grpc_port);

        // Wait for /health.
        match self.wait_for_ready().await {
            Ok(()) => {
                *self.is_ready.lock().unwrap() = true;
                let _ = self.app_handle.emit("brain-status", serde_json::json!({
                    "status": "ready",
                    "message": "AI engine ready"
                }));
            }
            Err(e) => {
                eprintln!("Brain failed to become ready: {:#}", e);
                let _ = self.app_handle.emit("brain-status", serde_json::json!({
                    "status": "error",
                    "message": format!("AI engine failed to start: {:#}", e)
                }));
            }
        }
        Ok(())
    }

    async fn wait_for_ready(&self) -> Result<(), Box<dyn std::error::Error>> {
        let url = format!("http://localhost:{}/health", self.port());
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(HEALTH_CHECK_TIMEOUT_SECS))
            .build()?;
        let attempts = BRAIN_READY_TIMEOUT_SECS * 2; // 500 ms cadence
        for i in 0..attempts {
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => return Ok(()),
                _ => {
                    if i % 10 == 0 && i > 0 {
                        println!("Waiting for brain /health... ({}s)", i / 2);
                    }
                    sleep(Duration::from_millis(500)).await;
                }
            }
        }
        Err(format!("brain did not become ready within {}s", BRAIN_READY_TIMEOUT_SECS).into())
    }

    pub async fn stop(&self) {
        if let Some(child) = self.brain_process.lock().unwrap().take() {
            let _ = child.kill();
            println!("kubilitics-ai-server stopped");
        }
    }

    /// Restart the brain after config.yaml / keychain changes so it
    /// picks up the new provider / model / API key. Called from
    /// ai_config::save_ai_config.
    pub async fn restart(self: Arc<Self>) -> Result<(), Box<dyn std::error::Error>> {
        // Kill the current child and clear the ready flag.
        if let Some(child) = self.brain_process.lock().unwrap().take() {
            let _ = child.kill();
        }
        *self.is_ready.lock().unwrap() = false;
        let _ = self.app_handle.emit("brain-status", serde_json::json!({
            "status": "starting",
            "message": "Reloading AI engine with new configuration…"
        }));
        // Give the OS a moment to release the port, then start fresh.
        sleep(Duration::from_millis(500)).await;
        self.start().await
    }
}

pub fn start_brain(app_handle: &AppHandle) -> Result<Arc<BrainManager>, Box<dyn std::error::Error>> {
    let manager = Arc::new(BrainManager::new(app_handle.clone()));

    // Resolve both brain ports now (sync) so all callers can read the real
    // addresses via BrainManager methods before the async start completes.
    let resolved_http = if can_bind(BRAIN_HTTP_PORT) {
        BRAIN_HTTP_PORT
    } else {
        let fallback = pick_free_port().unwrap_or(BRAIN_HTTP_PORT);
        eprintln!(
            "Brain HTTP port {} is occupied — using OS-assigned port {} instead",
            BRAIN_HTTP_PORT, fallback
        );
        fallback
    };
    *manager.resolved_http_port.lock().unwrap() = resolved_http;

    let resolved_grpc = if can_bind(BRAIN_GRPC_PORT) {
        BRAIN_GRPC_PORT
    } else {
        let fallback = pick_free_port().unwrap_or(BRAIN_GRPC_PORT);
        eprintln!(
            "Brain gRPC port {} is occupied — using OS-assigned port {} instead",
            BRAIN_GRPC_PORT, fallback
        );
        fallback
    };
    *manager.resolved_grpc_port.lock().unwrap() = resolved_grpc;

    app_handle.manage(manager.clone());
    let manager_clone = manager.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = manager_clone.start().await {
            eprintln!("Failed to start brain: {}", e);
        }
    });
    Ok(manager)
}

#[tauri::command]
pub fn get_brain_status(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let manager = app_handle.try_state::<Arc<BrainManager>>();
    let ready = manager.map(|m| m.is_ready()).unwrap_or(false);
    Ok(serde_json::json!({
        "status": if ready { "ready" } else { "starting" },
        "message": if ready { "AI engine ready" } else { "Starting AI engine…" }
    }))
}

/// Returns the base URL the brain HTTP API is actually bound to.
/// Equals http://127.0.0.1:8081 in the common case; a different port when
/// 8081 was occupied at startup and the brain fell back to a free port.
#[tauri::command]
pub fn get_brain_url(app_handle: AppHandle) -> String {
    brain_url_from_state(&app_handle)
}

/// Shared resolver used by all Tauri commands that call the brain's HTTP API.
/// Priority: KUBILITICS_AI_ADMIN_URL env (for tests/CI) → BrainManager state
/// (respects dynamic port fallback) → compile-time default.
pub fn brain_url_from_state(app_handle: &AppHandle) -> String {
    if let Ok(v) = std::env::var("KUBILITICS_AI_ADMIN_URL") {
        if !v.is_empty() {
            return v;
        }
    }
    match app_handle.try_state::<Arc<BrainManager>>() {
        Some(m) => m.url(),
        None => format!("http://127.0.0.1:{}", BRAIN_HTTP_PORT),
    }
}

/// restart_brain — kill + respawn kubilitics-ai-server so it re-reads
/// config.yaml + the keychain API key. Called from save_ai_config so
/// "Save & Test" actually tests against the new config.
#[tauri::command]
pub async fn restart_brain(app_handle: AppHandle) -> Result<(), String> {
    let manager = app_handle
        .try_state::<Arc<BrainManager>>()
        .ok_or_else(|| "brain manager not initialized".to_string())?;
    let m = (*manager).clone();
    m.restart().await.map_err(|e| format!("restart: {:#}", e))
}
