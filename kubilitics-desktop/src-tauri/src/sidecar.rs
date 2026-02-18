use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::sleep;

use serde::{Deserialize, Serialize};

const BACKEND_PORT: u16 = 819;
const AI_BACKEND_PORT: u16 = 8081;
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
            ai_process: Arc::new(Mutex::new(None)),
            ai_restart_count: Arc::new(Mutex::new(0)),
            ai_is_running: Arc::new(Mutex::new(false)),
            ai_available: Arc::new(Mutex::new(false)),
        }
    }

    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Check for port conflicts
        if self.is_port_in_use(BACKEND_PORT).await {
            return Err(format!("Port {} is already in use", BACKEND_PORT).into());
        }

        self.start_backend_process().await?;
        self.start_health_monitor();
        
        // Start AI backend if available
        self.start_ai_backend().await;
        
        Ok(())
    }

    async fn start_backend_process(&self) -> Result<(), Box<dyn std::error::Error>> {
        let sidecar_command = self.app_handle.shell().sidecar("kubilitics-backend")?;
        
        // Resolve kcli binary path for bundled binary
        let kcli_bin_path = self.resolve_kcli_binary_path().await?;
        
        let (_rx, _child) = sidecar_command
            .env("KUBILITICS_PORT", BACKEND_PORT.to_string())
            .env("KCLI_BIN", kcli_bin_path)
            .spawn()?;

        *self.is_running.lock().unwrap() = true;
        println!("Kubilitics backend started on http://localhost:{}", BACKEND_PORT);
        
        // Wait for backend to be ready
        self.wait_for_ready().await?;
        
        Ok(())
    }

    async fn wait_for_ready(&self) -> Result<(), Box<dyn std::error::Error>> {
        let url = format!("http://localhost:{}/health", BACKEND_PORT);

        // Allow up to 30 seconds (60 attempts × 500ms) for the backend to start.
        // Go binary cold-start on first launch can take several seconds.
        for attempt in 1..=60 {
            if let Ok(response) = reqwest::get(&url).await {
                if response.status().is_success() {
                    println!("Backend is ready after {} attempts", attempt);
                    return Ok(());
                }
            }
            sleep(Duration::from_millis(500)).await;
        }

        Err("Backend failed to become ready within 30 seconds".into())
    }

    async fn is_port_in_use(&self, port: u16) -> bool {
        let url = format!("http://localhost:{}/health", port);
        reqwest::get(&url).await.is_ok()
    }

    fn start_health_monitor(&self) {
        let app_handle = self.app_handle.clone();
        let restart_count = self.restart_count.clone();
        let is_running = self.is_running.clone();
        
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS)).await;
                
                let running = {
                    let is_running_guard = is_running.lock().unwrap();
                    *is_running_guard
                };
                
                if !running {
                    continue;
                }
                
                if !Self::check_health(BACKEND_PORT).await {
                    println!("Backend health check failed. Attempting restart...");
                    
                    let count = {
                        let mut count_guard = restart_count.lock().unwrap();
                        *count_guard += 1;
                        *count_guard
                    };
                    
                    if count <= MAX_RESTART_ATTEMPTS {
                        let manager = BackendManager::new(app_handle.clone());
                        if let Err(e) = manager.start_backend_process().await {
                            eprintln!("Failed to restart backend: {}", e);
                        } else {
                            println!("Backend restarted successfully (attempt {})", count);
                        }
                    } else {
                        eprintln!("Max restart attempts reached. Backend will not restart.");
                        let mut running_guard = is_running.lock().unwrap();
                        *running_guard = false;
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

    pub async fn stop(&self) -> Result<(), Box<dyn std::error::Error>> {
        *self.is_running.lock().unwrap() = false;
        
        // Stop AI backend first
        self.stop_ai_backend().await;
        
        // Send graceful shutdown signal to backend
        let url = format!("http://localhost:{}/api/v1/shutdown", BACKEND_PORT);
        let client = reqwest::Client::new();
        let _ = client.post(&url).send().await;
        
        // Wait for graceful shutdown
        sleep(Duration::from_secs(2)).await;
        
        println!("Backend stopped gracefully");
        Ok(())
    }

    // AI Backend Management

    async fn start_ai_backend(&self) {
        // Check if AI binary exists
        if !self.check_ai_binary_exists().await {
            println!("AI backend binary not found, AI features will be unavailable");
            *self.ai_available.lock().unwrap() = false;
            return;
        }

        // Check for port conflicts
        if self.is_port_in_use(AI_BACKEND_PORT).await {
            println!("AI backend port {} is already in use", AI_BACKEND_PORT);
            *self.ai_available.lock().unwrap() = false;
            return;
        }

        match self.start_ai_backend_process().await {
            Ok(_) => {
                *self.ai_available.lock().unwrap() = true;
                *self.ai_is_running.lock().unwrap() = true;
                self.start_ai_health_monitor();
            }
            Err(e) => {
                eprintln!("Failed to start AI backend: {}", e);
                *self.ai_available.lock().unwrap() = false;
            }
        }
    }

    async fn check_ai_binary_exists(&self) -> bool {
        // Check if kubilitics-ai binary exists in the sidecar binaries directory
        // Tauri bundles external binaries, so we check via sidecar command
        let _sidecar_command = match self.app_handle.shell().sidecar("kubilitics-ai") {
            Ok(cmd) => cmd,
            Err(_) => return false,
        };
        
        // If we can create the command, the binary exists
        true
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
        
        let (_rx, child) = sidecar_command
            .env("KUBILITICS_PORT", AI_BACKEND_PORT.to_string())
            .env("KUBILITICS_BACKEND_ADDRESS", "localhost:50051")
            .env("KUBILITICS_DATABASE_PATH", ai_data_dir.join("kubilitics-ai.db").to_string_lossy().to_string())
            .env("KUBILITICS_DATABASE_TYPE", "sqlite")
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

    fn start_ai_health_monitor(&self) {
        let app_handle = self.app_handle.clone();
        let ai_restart_count = self.ai_restart_count.clone();
        let ai_is_running = self.ai_is_running.clone();
        let ai_available = self.ai_available.clone();
        let _ai_process = self.ai_process.clone();
        
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(AI_HEALTH_CHECK_INTERVAL_SECS)).await;
                
                let running = {
                    let is_running_guard = ai_is_running.lock().unwrap();
                    *is_running_guard
                };
                
                if !running {
                    continue;
                }
                
                if !Self::check_health(AI_BACKEND_PORT).await {
                    println!("AI backend health check failed. Attempting restart...");
                    
                    let count = {
                        let mut count_guard = ai_restart_count.lock().unwrap();
                        *count_guard += 1;
                        *count_guard
                    };
                    
                    if count <= AI_MAX_RESTART_ATTEMPTS {
                        // Wait before restart
                        sleep(Duration::from_secs(AI_RESTART_DELAY_SECS)).await;
                        
                        let manager = BackendManager::new(app_handle.clone());
                        if let Err(e) = manager.start_ai_backend_process().await {
                            eprintln!("Failed to restart AI backend: {}", e);
                        } else {
                            println!("AI backend restarted successfully (attempt {})", count);
                            *ai_is_running.lock().unwrap() = true;
                        }
                    } else {
                        eprintln!("Max AI restart attempts reached. AI backend will not restart.");
                        let mut running_guard = ai_is_running.lock().unwrap();
                        *running_guard = false;
                        let mut available_guard = ai_available.lock().unwrap();
                        *available_guard = false;
                    }
                }
            }
        });
    }

    async fn stop_ai_backend(&self) {
        *self.ai_is_running.lock().unwrap() = false;
        
        // Kill the AI process if it exists
        if let Ok(mut process_guard) = self.ai_process.lock() {
            if let Some(mut child) = process_guard.take() {
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

    async fn resolve_kcli_binary_path(&self) -> Result<String, Box<dyn std::error::Error>> {
        // Check if kcli sidecar binary exists by trying to create the command
        let kcli_sidecar_exists = self.app_handle.shell().sidecar("kcli").is_ok();
        
        if kcli_sidecar_exists {
            // Tauri bundles external binaries with target triple suffix (e.g., kcli-x86_64-apple-darwin)
            // The sidecar() method resolves this automatically, but for KCLI_BIN we need the actual path.
            // We'll use a workaround: execute the sidecar with --version to get its path via which/where
            
            // Try to get the path by executing the sidecar and checking what gets executed
            // Actually, simpler: use Tauri's resource directory and look for the binary
            if let Ok(resource_dir) = self.app_handle.path().resource_dir() {
                // Tauri places sidecar binaries in the resource directory
                // They have target triple suffixes, so we need to find the right one
                if let Ok(entries) = std::fs::read_dir(&resource_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let file_name = path.file_name().and_then(|n| n.to_str());
                        
                        // Look for kcli binary (with or without target triple suffix)
                        if let Some(name) = file_name {
                            if name == "kcli" || name.starts_with("kcli-") {
                                // Check if it's executable
                                if let Ok(metadata) = std::fs::metadata(&path) {
                                    #[cfg(unix)]
                                    {
                                        use std::os::unix::fs::PermissionsExt;
                                        if metadata.permissions().mode() & 0o111 != 0 {
                                            return Ok(path.to_string_lossy().to_string());
                                        }
                                    }
                                    #[cfg(windows)]
                                    {
                                        // On Windows, .exe files are executable
                                        if name.ends_with(".exe") || name == "kcli" {
                                            return Ok(path.to_string_lossy().to_string());
                                        }
                                    }
                                    #[cfg(not(any(unix, windows)))]
                                    {
                                        // Fallback: assume it's executable if it matches
                                        if name == "kcli" || name.starts_with("kcli-") {
                                            return Ok(path.to_string_lossy().to_string());
                                        }
                                    }
                                }
                            }
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
