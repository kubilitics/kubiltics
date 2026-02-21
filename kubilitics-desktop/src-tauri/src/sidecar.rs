use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

use serde::{Deserialize, Serialize};

use crate::backend_ports::{BACKEND_PORT, AI_BACKEND_PORT};
const MAX_RESTART_ATTEMPTS: u32 = 3;
const AI_MAX_RESTART_ATTEMPTS: u32 = 2;
const HEALTH_CHECK_INTERVAL_SECS: u64 = 10;
const AI_HEALTH_CHECK_INTERVAL_SECS: u64 = 30;
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 5;
const AI_RESTART_DELAY_SECS: u64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISidecarStatus {
    pub available: bool,
    pub running: bool,
    pub port: u16,
}

pub struct BackendManager {
    app_handle: AppHandle,
    restart_count: Arc<Mutex<u32>>,
    is_running: Arc<Mutex<bool>>,
    /// True once the backend has emitted "ready" — lets get_backend_status answer immediately.
    is_ready: Arc<Mutex<bool>>,
    /// TASK-SIDECAR-001: Store process handle so we can kill on exit, not just send HTTP shutdown.
    backend_process: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
    ai_process: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
    ai_restart_count: Arc<Mutex<u32>>,
    ai_is_running: Arc<Mutex<bool>>,
    ai_available: Arc<Mutex<bool>>,
}

impl BackendManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            restart_count: Arc::new(Mutex::new(0)),
            is_running: Arc::new(Mutex::new(false)),
            is_ready: Arc::new(Mutex::new(false)),
            backend_process: Arc::new(Mutex::new(None)),
            ai_process: Arc::new(Mutex::new(None)),
            ai_restart_count: Arc::new(Mutex::new(0)),
            ai_is_running: Arc::new(Mutex::new(false)),
            ai_available: Arc::new(Mutex::new(false)),
        }
    }

    pub fn is_ready(&self) -> bool {
        *self.is_ready.lock().unwrap()
    }

    /// Start backend and health monitor. Takes Arc<Self> so the health monitor can restart
    /// the same instance (P1-2) instead of creating a new BackendManager.
    pub async fn start(self: Arc<Self>) -> Result<(), Box<dyn std::error::Error>> {
        // Emit startup event so the frontend can show a loading state.
        let _ = self.app_handle.emit("backend-status", serde_json::json!({
            "status": "starting",
            "message": "Starting backend engine…"
        }));

        // Check for port conflicts — if 819 already responds to /health, the backend
        // may already be running (e.g. user restarted the app quickly). Treat it as ready.
        // Delay so the JS event listener in BackendStartupOverlay has time to register
        // before we emit "ready" (the JS setup() runs after the first render tick).
        // Increased delay to 1500ms to ensure listener is registered even on slower systems.
        if self.is_port_in_use(BACKEND_PORT).await {
            println!("Port {} already in use — assuming backend is already running", BACKEND_PORT);
            *self.is_running.lock().unwrap() = true;
            sleep(Duration::from_millis(1500)).await;
            *self.is_ready.lock().unwrap() = true;
            let _ = self.app_handle.emit("backend-status", serde_json::json!({
                "status": "ready",
                "message": "Backend engine ready"
            }));
            let _ = self.app_handle.emit("backend-circuit-reset", ());
            Self::start_health_monitor(self.clone());
            self.start_ai_backend().await;
            return Ok(());
        }

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

        // Start AI backend if available (always non-blocking / best-effort)
        self.start_ai_backend().await;

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
            BACKEND_PORT
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
            .env("KUBILITICS_PORT", BACKEND_PORT.to_string())
            .env("KCLI_BIN", kcli_bin_path)
            // Allow tauri:// origin so fetch() calls from the WebView are not blocked by CORS
            .env("KUBILITICS_ALLOWED_ORIGINS", tauri_allowed_origins)
            // P0-J: Write SQLite DB to user-writable location (not read-only .app bundle)
            .env("KUBILITICS_DATABASE_PATH", db_file.to_string_lossy().as_ref());

        if !kubeconfig_path.is_empty() {
            cmd = cmd.env("KUBECONFIG", &kubeconfig_path);
        }

        let (_rx, child) = cmd.spawn()?;

        // TASK-SIDECAR-001: Store the process handle so stop() can kill it on force-quit.
        *self.backend_process.lock().unwrap() = Some(child);
        *self.is_running.lock().unwrap() = true;
        println!("Kubilitics backend started on http://localhost:{}", BACKEND_PORT);
        
        // Wait for backend to be ready
        self.wait_for_ready().await?;
        
        Ok(())
    }

    async fn wait_for_ready(&self) -> Result<(), Box<dyn std::error::Error>> {
        let url = format!("http://localhost:{}/health", BACKEND_PORT);

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

        Err("Backend failed to become ready within 60 seconds. Check that port 819 is not blocked by another application.".into())
    }

    /// P1-11: Only treat port as "in use by our backend" if the health response is from kubilitics-backend.
    /// Another HTTP server on 819 would otherwise be treated as ready and we'd skip spawning.
    async fn is_port_in_use(&self, port: u16) -> bool {
        let url = format!("http://localhost:{}/health", port);
        let Ok(response) = reqwest::get(&url).await else {
            return false;
        };
        if !response.status().is_success() {
            return false;
        }
        let Ok(body) = response.text().await else {
            return false;
        };
        let json: Option<serde_json::Value> = serde_json::from_str(&body).ok();
        let service = json
            .as_ref()
            .and_then(|j| j.get("service"))
            .and_then(|s| s.as_str());
        matches!(service, Some("kubilitics-backend"))
    }

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

                if !Self::check_health(BACKEND_PORT).await {
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

        // Stop AI backend first
        self.stop_ai_backend().await;

        // Try graceful HTTP shutdown; fall through to SIGKILL on failure or force-quit.
        let url = format!("http://localhost:{}/api/v1/shutdown", BACKEND_PORT);
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

    // AI Backend Management

    async fn start_ai_backend(self: &Arc<Self>) {
        // Check if AI binary exists
        if !self.check_ai_binary_exists().await {
            println!("AI backend binary not found, AI features will be unavailable");
            *self.ai_available.lock().unwrap() = false;
            return;
        }

        // Check if AI port is already occupied — could be an externally-started AI instance
        // (e.g. in dev mode from dev-desktop.sh, or a previous session).
        // If the port is in use AND responds to /health, adopt it instead of refusing to start.
        if self.is_port_in_use(AI_BACKEND_PORT).await {
            let health_url = format!("http://localhost:{}/health", AI_BACKEND_PORT);
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap_or_default();
            match client.get(&health_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    println!("AI port {} already in use — healthy AI instance adopted", AI_BACKEND_PORT);
                    *self.ai_available.lock().unwrap() = true;
                    *self.ai_is_running.lock().unwrap() = true;
                    // Start health monitor so we track the adopted process.
                    Self::start_ai_health_monitor(self.clone());
                    return;
                }
                _ => {
                    println!("AI backend port {} is in use by an unresponsive process — AI unavailable", AI_BACKEND_PORT);
                    *self.ai_available.lock().unwrap() = false;
                    return;
                }
            }
        }

        match self.start_ai_backend_process().await {
            Ok(_) => {
                *self.ai_available.lock().unwrap() = true;
                *self.ai_is_running.lock().unwrap() = true;
                // TASK-SIDECAR-003: Pass Arc<Self> so health monitor uses same instance.
                Self::start_ai_health_monitor(self.clone());
            }
            Err(e) => {
                eprintln!("Failed to start AI backend: {}", e);
                *self.ai_available.lock().unwrap() = false;
            }
        }
    }

    async fn check_ai_binary_exists(&self) -> bool {
        // TASK-AI-001: Verify the binary file actually exists on disk.
        // shell().sidecar() only checks tauri.conf.json; it does NOT verify the file is present.
        // Tauri v2 places binaries in the executable directory on macOS, not always in resource_dir.
        let dirs_to_check = vec![
            self.app_handle.path().resource_dir().ok(),
            std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())),
        ];

        let target = std::env::consts::ARCH;
        let os = std::env::consts::OS;
        let vendor = match os { "macos" | "ios" => "apple", "windows" => "pc", _ => "unknown" };
        let os_suffix = match os {
            "macos" => "darwin", "ios" => "ios", "linux" => "linux-gnu", "windows" => "windows-msvc", _ => os,
        };
        let base_name = format!("kubilitics-ai-{}-{}-{}", target, vendor, os_suffix);
        #[cfg(windows)]
        let expected_name = format!("{}.exe", base_name);
        #[cfg(not(windows))]
        let expected_name = base_name;

        for dir_opt in dirs_to_check {
            if let Some(dir) = dir_opt {
                let exact_path = dir.join(&expected_name);
                if exact_path.exists() {
                    return true;
                }
                // Fallback: any file starting with "kubilitics-ai"
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();
                        if name_str.starts_with("kubilitics-ai") {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    async fn start_ai_backend_process(&self) -> Result<(), Box<dyn std::error::Error>> {
        let app_data_dir = dirs::data_local_dir()
            .ok_or("Could not find data directory")?
            .join("kubilitics");
        
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;

        let ai_data_dir = app_data_dir.join("ai");
        std::fs::create_dir_all(&ai_data_dir)
            .map_err(|e| format!("Failed to create AI data directory: {}", e))?;

        let sidecar_command = self.app_handle.shell().sidecar("kubilitics-ai")?;

        // TASK-AI-002: Pass the same allowed-origins list so the AI server accepts tauri:// requests.
        let tauri_allowed_origins = format!(
            "tauri://localhost,tauri://,http://tauri.localhost,http://localhost:5173,http://localhost:{}",
            BACKEND_PORT
        );

        let (_rx, child) = sidecar_command
            .env("KUBILITICS_PORT", AI_BACKEND_PORT.to_string())
            .env("KUBILITICS_BACKEND_ADDRESS", "localhost:50051")
            .env("KUBILITICS_BACKEND_HTTP_BASE_URL", format!("http://localhost:{}", BACKEND_PORT))
            .env("KUBILITICS_MCP_ENABLED", "true")
            .env("KUBILITICS_SAFETY_ENABLED", "true")
            .env("KUBILITICS_ANALYTICS_ENABLED", "true")
            .env("KUBILITICS_DATABASE_PATH", ai_data_dir.join("kubilitics-ai.db").to_string_lossy().to_string())
            .env("KUBILITICS_DATABASE_SQLITE_PATH", ai_data_dir.join("kubilitics-ai.db").to_string_lossy().to_string())
            .env("KUBILITICS_DATABASE_TYPE", "sqlite")
            .env("KUBILITICS_ALLOWED_ORIGINS", tauri_allowed_origins)
            .spawn()?;

        *self.ai_process.lock().unwrap() = Some(child);
        println!("AI backend started on http://localhost:{}", AI_BACKEND_PORT);
        
        // Wait for AI backend to be ready
        self.wait_for_ai_ready().await?;
        
        Ok(())
    }

    async fn wait_for_ai_ready(&self) -> Result<(), Box<dyn std::error::Error>> {
        let url = format!("http://localhost:{}/health", AI_BACKEND_PORT);

        // Allow up to 30 seconds (60 attempts × 500ms) for the AI backend to start.
        for attempt in 1..=60 {
            if let Ok(response) = reqwest::get(&url).await {
                if response.status().is_success() {
                    println!("AI backend is ready after {} attempts", attempt);
                    return Ok(());
                }
            }
            sleep(Duration::from_millis(500)).await;
        }

        Err("AI backend failed to become ready within 30 seconds".into())
    }

    /// TASK-SIDECAR-003: Takes Arc<Self> so the restart uses the same manager instance
    /// (same ai_process handle, ai_restart_count, etc.) instead of a fresh BackendManager.
    fn start_ai_health_monitor(this: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(AI_HEALTH_CHECK_INTERVAL_SECS)).await;

                let running = *this.ai_is_running.lock().unwrap();
                if !running {
                    continue;
                }

                if !Self::check_health(AI_BACKEND_PORT).await {
                    println!("AI backend health check failed. Attempting restart...");

                    let count = {
                        let mut guard = this.ai_restart_count.lock().unwrap();
                        *guard += 1;
                        *guard
                    };

                    if count <= AI_MAX_RESTART_ATTEMPTS {
                        sleep(Duration::from_secs(AI_RESTART_DELAY_SECS)).await;
                        if let Err(e) = this.start_ai_backend_process().await {
                            eprintln!("Failed to restart AI backend: {}", e);
                        } else {
                            println!("AI backend restarted successfully (attempt {})", count);
                            *this.ai_is_running.lock().unwrap() = true;
                        }
                    } else {
                        eprintln!("Max AI restart attempts reached. AI backend will not restart.");
                        *this.ai_is_running.lock().unwrap() = false;
                        *this.ai_available.lock().unwrap() = false;
                    }
                }
            }
        });
    }

    #[allow(dead_code)]
    async fn stop_ai_backend(&self) {
        *self.ai_is_running.lock().unwrap() = false;
        
        // Kill the AI process if it exists
        if let Ok(mut process_guard) = self.ai_process.lock() {
            if let Some(child) = process_guard.take() {
                let _ = child.kill();
                println!("AI backend stopped");
            }
        }
        
        // Send graceful shutdown signal to AI backend
        let url = format!("http://localhost:{}/api/v1/shutdown", AI_BACKEND_PORT);
        let client = reqwest::Client::new();
        let _ = client.post(&url).send().await;
        
        sleep(Duration::from_secs(1)).await;
    }

    pub fn get_ai_status(&self) -> AISidecarStatus {
        let available = *self.ai_available.lock().unwrap();
        let running = *self.ai_is_running.lock().unwrap();
        
        AISidecarStatus {
            available,
            running: available && running,
            port: AI_BACKEND_PORT,
        }
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
        
        // Last resort: return "kcli" and let backend's resolveKCLIBinary handle PATH lookup
        // The backend will return a clear error if kcli is not found
        Ok("kcli".to_string())
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

#[tauri::command]
pub fn get_ai_status(app_handle: AppHandle) -> Result<AISidecarStatus, String> {
    let manager = app_handle.try_state::<Arc<BackendManager>>();
    if let Some(mgr) = manager {
        Ok(mgr.get_ai_status())
    } else {
        Ok(AISidecarStatus {
            available: false,
            running: false,
            port: AI_BACKEND_PORT,
        })
    }
}
