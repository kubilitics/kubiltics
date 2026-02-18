use std::path::PathBuf;
use tauri::command;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Command;
use std::fs;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use sha2::{Sha256, Digest};

#[derive(Debug, Serialize, Deserialize)]
pub struct KubeconfigContext {
    pub name: String,
    pub cluster: String,
    pub user: String,
    pub namespace: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KubeconfigInfo {
    pub path: String,
    pub current_context: Option<String>,
    pub contexts: Vec<KubeconfigContext>,
}

// C4.1: Never include path or content in error messages (no secrets in logs).
fn kubeconfig_read_error() -> String {
    "Failed to read kubeconfig at configured path".to_string()
}
fn kubeconfig_parse_error() -> String {
    "Failed to parse kubeconfig".to_string()
}
fn kubeconfig_write_error() -> String {
    "Failed to write kubeconfig".to_string()
}

#[command]
pub async fn read_kubeconfig(path: Option<String>) -> Result<String, String> {
    let kubeconfig_path = get_kubeconfig_path(path).await?;

    std::fs::read_to_string(kubeconfig_path).map_err(|_| kubeconfig_read_error())
}

#[command]
pub async fn get_kubeconfig_info(path: Option<String>) -> Result<KubeconfigInfo, String> {
    let kubeconfig_path = get_kubeconfig_path(path.clone()).await?;
    let content = std::fs::read_to_string(&kubeconfig_path).map_err(|_| kubeconfig_read_error())?;
    
    let config: Value = serde_yaml::from_str(&content).map_err(|_| kubeconfig_parse_error())?;
    
    let current_context = config.get("current-context")
        .and_then(|v| v.as_str())
        .map(String::from);
    
    let contexts = parse_contexts(&config)?;
    
    Ok(KubeconfigInfo {
        path: kubeconfig_path.to_string_lossy().to_string(),
        current_context,
        contexts,
    })
}

#[command]
pub async fn switch_context(context_name: String) -> Result<(), String> {
    let kubeconfig_path = get_kubeconfig_path(None).await?;
    let content = std::fs::read_to_string(&kubeconfig_path).map_err(|_| kubeconfig_read_error())?;
    
    let mut config: Value = serde_yaml::from_str(&content).map_err(|_| kubeconfig_parse_error())?;
    
    // Validate context exists
    let contexts = parse_contexts(&config)?;
    if !contexts.iter().any(|c| c.name == context_name) {
        return Err(format!("Context '{}' not found", context_name));
    }
    
    // Update current-context
    if let Some(obj) = config.as_object_mut() {
        obj.insert("current-context".to_string(), Value::String(context_name));
    }
    
    // Write back
    let yaml = serde_yaml::to_string(&config).map_err(|_| kubeconfig_parse_error())?;
    
    std::fs::write(&kubeconfig_path, yaml).map_err(|_| kubeconfig_write_error())?;
    
    Ok(())
}

#[command]
pub async fn validate_kubeconfig(path: Option<String>) -> Result<bool, String> {
    let kubeconfig_path = get_kubeconfig_path(path).await?;
    
    if !kubeconfig_path.exists() {
        return Ok(false);
    }
    
    let content = match std::fs::read_to_string(&kubeconfig_path) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };
    
    match serde_yaml::from_str::<Value>(&content) {
        Ok(config) => {
            // Check required fields
            let has_clusters = config.get("clusters").is_some();
            let has_contexts = config.get("contexts").is_some();
            let has_users = config.get("users").is_some();
            
            Ok(has_clusters && has_contexts && has_users)
        }
        Err(_) => Ok(false),
    }
}

#[command]
pub async fn auto_detect_kubeconfig() -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    
    // Check default location
    if let Some(home) = dirs::home_dir() {
        let default_path = home.join(".kube").join("config");
        if default_path.exists() {
            paths.push(default_path.to_string_lossy().to_string());
        }
    }
    
    // Check KUBECONFIG env var
    if let Ok(kubeconfig_env) = std::env::var("KUBECONFIG") {
        for path in kubeconfig_env.split(':') {
            let p = PathBuf::from(path);
            if p.exists() && !paths.contains(&p.to_string_lossy().to_string()) {
                paths.push(p.to_string_lossy().to_string());
            }
        }
    }
    
    Ok(paths)
}

#[command]
pub async fn browse_for_kubeconfig() -> Result<Option<String>, String> {
    // Will be handled by frontend dialog plugin
    // This is a placeholder for backend validation
    Ok(None)
}

#[command]
pub async fn save_topology_export(
    data: Vec<u8>,
    filename: String,
    _format: String,
) -> Result<String, String> {
    let app_data_dir = get_app_data_dir().await?;
    let exports_dir = PathBuf::from(app_data_dir).join("exports");
    
    if !exports_dir.exists() {
        std::fs::create_dir_all(&exports_dir)
            .map_err(|e| format!("Failed to create exports directory: {}", e))?;
    }
    
    let file_path = exports_dir.join(filename);
    std::fs::write(&file_path, data)
        .map_err(|e| format!("Failed to write export file: {}", e))?;
    
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub async fn open_in_system_editor(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    Ok(())
}

#[command]
pub async fn reveal_in_file_manager(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(&["/select,", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(&["-R", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to reveal file: {}", e))?;
        }
    }
    
    Ok(())
}

#[command]
pub async fn get_app_data_dir() -> Result<String, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or("Could not find data directory")?;
    
    let kubilitics_dir = data_dir.join("kubilitics");
    
    if !kubilitics_dir.exists() {
        std::fs::create_dir_all(&kubilitics_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }
    
    Ok(kubilitics_dir.to_string_lossy().to_string())
}

#[command]
pub async fn get_recent_exports() -> Result<Vec<String>, String> {
    let app_data_dir = get_app_data_dir().await?;
    let exports_dir = PathBuf::from(app_data_dir).join("exports");
    
    if !exports_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut exports = Vec::new();
    
    for entry in std::fs::read_dir(exports_dir)
        .map_err(|e| format!("Failed to read exports directory: {}", e))? {
        if let Ok(entry) = entry {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    exports.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }
    
    // Sort by modification time (most recent first)
    exports.sort_by(|a, b| {
        let a_time = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let b_time = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });
    
    Ok(exports.into_iter().take(10).collect())
}

#[command]
pub async fn select_kubeconfig_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use std::sync::mpsc;
    
    let (tx, rx) = mpsc::channel();
    
    app_handle.dialog()
        .file()
        .set_title("Select Kubeconfig File")
        .add_filter("Kubeconfig", &["yaml", "yml"])
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path| {
            let path_str = file_path.and_then(|p| {
                match p {
                    tauri_plugin_dialog::FilePath::Path(path) => Some(path.to_string_lossy().to_string()),
                    tauri_plugin_dialog::FilePath::Url(url) => Some(url.to_string()),
                }
            });
            let _ = tx.send(path_str);
        });
    
    // Wait for the dialog result
    match rx.recv() {
        Ok(path) => Ok(path),
        Err(_) => Err("Dialog was cancelled".to_string()),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KubeconfigSecuritySettings {
    pub selected_contexts: Vec<String>,
    pub kubeconfig_path: Option<String>,
    pub encrypted_kubeconfig: Option<String>, // Base64 encoded encrypted kubeconfig
    pub first_launch_completed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalyticsSettings {
    pub consent_given: bool,
    pub consent_timestamp: Option<u64>,
    pub opt_out: bool,
}

async fn get_security_settings_path() -> Result<PathBuf, String> {
    let app_data_dir_str = get_app_data_dir().await?;
    let app_data_dir = PathBuf::from(app_data_dir_str);
    Ok(app_data_dir.join("kubeconfig_security.json"))
}

async fn load_security_settings() -> Result<KubeconfigSecuritySettings, String> {
    let settings_path = get_security_settings_path().await?;
    
    if !settings_path.exists() {
        return Ok(KubeconfigSecuritySettings {
            selected_contexts: Vec::new(),
            kubeconfig_path: None,
            encrypted_kubeconfig: None,
            first_launch_completed: false,
        });
    }
    
    let content = fs::read_to_string(&settings_path)
        .map_err(|_| "Failed to read security settings".to_string())?;
    
    serde_json::from_str(&content)
        .map_err(|_| "Failed to parse security settings".to_string())
}

#[command]
pub async fn get_selected_contexts() -> Result<Vec<String>, String> {
    let settings = load_security_settings().await?;
    Ok(settings.selected_contexts)
}

async fn save_security_settings(settings: &KubeconfigSecuritySettings) -> Result<(), String> {
    let settings_path = get_security_settings_path().await?;
    
    // Ensure parent directory exists
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "Failed to create settings directory".to_string())?;
    }
    
    let content = serde_json::to_string_pretty(settings)
        .map_err(|_| "Failed to serialize settings".to_string())?;
    
    fs::write(&settings_path, content)
        .map_err(|_| "Failed to write security settings".to_string())?;
    
    Ok(())
}

#[command]
pub async fn save_selected_contexts(contexts: Vec<String>) -> Result<(), String> {
    let mut settings = load_security_settings().await?;
    settings.selected_contexts = contexts;
    save_security_settings(&settings).await
}

#[command]
pub async fn is_first_launch() -> Result<bool, String> {
    let settings = load_security_settings().await?;
    Ok(!settings.first_launch_completed)
}

#[command]
pub async fn mark_first_launch_complete() -> Result<(), String> {
    let mut settings = load_security_settings().await?;
    settings.first_launch_completed = true;
    save_security_settings(&settings).await
}

#[command]
pub async fn save_custom_kubeconfig_path(path: String) -> Result<(), String> {
    let mut settings = load_security_settings().await?;
    settings.kubeconfig_path = Some(path);
    save_security_settings(&settings).await
}

#[command]
pub async fn get_custom_kubeconfig_path() -> Result<Option<String>, String> {
    let settings = load_security_settings().await?;
    Ok(settings.kubeconfig_path)
}

// Kubeconfig Encryption Functions

fn get_encryption_key() -> Result<Vec<u8>, String> {
    // Derive key from app data directory path (device-specific)
    // In production, consider using OS keychain or secure storage
    let app_data_dir = dirs::data_local_dir()
        .ok_or("Could not find data directory")?
        .join("kubilitics");
    
    let key_material = format!("{}{}", app_data_dir.to_string_lossy(), "kubilitics-kubeconfig-key");
    
    // Use SHA-256 to derive a 32-byte key
    let mut hasher = Sha256::new();
    hasher.update(key_material.as_bytes());
    Ok(hasher.finalize().to_vec())
}

#[command]
pub async fn encrypt_kubeconfig(kubeconfig_content: String) -> Result<String, String> {
    let key_bytes = get_encryption_key()?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    
    let ciphertext = cipher
        .encrypt(&nonce, kubeconfig_content.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;
    
    // Combine nonce and ciphertext, then base64 encode
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    
    Ok(general_purpose::STANDARD.encode(&combined))
}

#[command]
pub async fn decrypt_kubeconfig(encrypted_content: String) -> Result<String, String> {
    let key_bytes = get_encryption_key()?;
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    
    // Decode base64
    let combined = general_purpose::STANDARD
        .decode(encrypted_content)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    
    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }
    
    // Extract nonce (first 12 bytes) and ciphertext (rest)
    let nonce = Nonce::from_slice(&combined[..12]);
    let ciphertext = &combined[12..];
    
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;
    
    String::from_utf8(plaintext)
        .map_err(|e| format!("UTF-8 decode failed: {}", e))
}

#[command]
pub async fn save_encrypted_kubeconfig(kubeconfig_content: String) -> Result<(), String> {
    let encrypted = encrypt_kubeconfig(kubeconfig_content).await?;
    
    let mut settings = load_security_settings().await?;
    settings.encrypted_kubeconfig = Some(encrypted);
    save_security_settings(&settings).await
}

#[command]
pub async fn load_encrypted_kubeconfig() -> Result<Option<String>, String> {
    let settings = load_security_settings().await?;
    
    if let Some(encrypted) = settings.encrypted_kubeconfig {
        let decrypted = decrypt_kubeconfig(encrypted).await?;
        Ok(Some(decrypted))
    } else {
        Ok(None)
    }
}

#[command]
pub async fn check_for_updates(_app_handle: tauri::AppHandle) -> Result<bool, String> {
    // Tauri v2 updater plugin uses the app handle directly
    // For now, return false (no update) - updater functionality can be implemented later
    // The updater plugin handles updates automatically via the config
    Ok(false)
}

#[command]
pub async fn install_update(_app_handle: tauri::AppHandle) -> Result<(), String> {
    // Tauri v2 updater plugin handles updates automatically via the config
    // Manual install is not needed - the plugin handles it
    Err("Updates are handled automatically by the updater plugin".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DesktopInfo {
    pub app_version: String,
    pub backend_port: u16,
    pub backend_version: Option<String>,
    pub backend_uptime_seconds: Option<u64>,
    pub kubeconfig_path: String,
    pub app_data_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectivityStatus {
    pub is_online: bool,
    pub backend_reachable: bool,
    pub ai_backend_reachable: bool,
    pub last_check: u64, // Unix timestamp
}

#[command]
pub async fn check_connectivity() -> Result<ConnectivityStatus, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    // Check basic internet connectivity
    let is_online = check_internet_connectivity().await;
    
    // Check backend connectivity
    let backend_reachable = check_backend_connectivity().await;
    
    // Check AI backend connectivity
    let ai_backend_reachable = check_ai_backend_connectivity().await;
    
    Ok(ConnectivityStatus {
        is_online,
        backend_reachable,
        ai_backend_reachable,
        last_check: now,
    })
}

async fn check_internet_connectivity() -> bool {
    // Try to connect to a reliable external service
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    
    // Try multiple endpoints for reliability
    let endpoints = vec![
        "https://www.google.com",
        "https://1.1.1.1", // Cloudflare DNS
        "https://8.8.8.8", // Google DNS
    ];
    
    for endpoint in endpoints {
        if client.get(endpoint).send().await.is_ok() {
            return true;
        }
    }
    
    false
}

async fn check_backend_connectivity() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    
    client.get("http://localhost:819/health")
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn check_ai_backend_connectivity() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    
    client.get("http://localhost:8081/health")
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn get_analytics_settings_path() -> Result<PathBuf, String> {
    let app_data_dir_str = get_app_data_dir().await?;
    let app_data_dir = PathBuf::from(app_data_dir_str);
    Ok(app_data_dir.join("analytics_settings.json"))
}

async fn load_analytics_settings() -> Result<AnalyticsSettings, String> {
    let settings_path = get_analytics_settings_path().await?;
    
    if !settings_path.exists() {
        return Ok(AnalyticsSettings {
            consent_given: false,
            consent_timestamp: None,
            opt_out: false,
        });
    }
    
    let content = fs::read_to_string(&settings_path)
        .map_err(|_| "Failed to read analytics settings".to_string())?;
    
    serde_json::from_str(&content)
        .map_err(|_| "Failed to parse analytics settings".to_string())
}

async fn save_analytics_settings(settings: &AnalyticsSettings) -> Result<(), String> {
    let settings_path = get_analytics_settings_path().await?;
    
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "Failed to create settings directory".to_string())?;
    }
    
    let content = serde_json::to_string_pretty(settings)
        .map_err(|_| "Failed to serialize analytics settings".to_string())?;
    
    fs::write(&settings_path, content)
        .map_err(|_| "Failed to write analytics settings".to_string())?;
    
    Ok(())
}

#[command]
pub async fn get_analytics_consent() -> Result<bool, String> {
    let settings = load_analytics_settings().await?;
    Ok(settings.consent_given && !settings.opt_out)
}

#[command]
pub async fn set_analytics_consent(consent: bool) -> Result<(), String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    
    let mut settings = load_analytics_settings().await?;
    settings.consent_given = consent;
    settings.opt_out = !consent;
    
    if consent {
        settings.consent_timestamp = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
        );
    }
    
    save_analytics_settings(&settings).await
}

#[command]
pub async fn has_analytics_consent_been_asked() -> Result<bool, String> {
    let settings = load_analytics_settings().await?;
    Ok(settings.consent_timestamp.is_some())
}

#[command]
pub async fn get_desktop_info() -> Result<DesktopInfo, String> {
    // use std::time::{SystemTime, UNIX_EPOCH};
    
    let app_data_dir = get_app_data_dir().await?;
    let kubeconfig_path = get_kubeconfig_path(None).await?.to_string_lossy().to_string();
    
    // Get app version from package info (would need to pass AppHandle)
    // For now, use a placeholder - this should be passed from main.rs
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    
    // Try to get backend health info
    let backend_port = 819u16;
    let backend_version = None; // Would need to call /api/v1/version endpoint
    let backend_uptime_seconds = None; // Would need to call /api/v1/health and parse uptime
    
    Ok(DesktopInfo {
        app_version,
        backend_port,
        backend_version,
        backend_uptime_seconds,
        kubeconfig_path,
        app_data_dir,
    })
}

#[command]
pub async fn restart_sidecar(_app_handle: tauri::AppHandle) -> Result<(), String> {
    // TODO: Implement restart logic
    // This requires access to BackendManager which is stored in app state
    // For now, return success - actual implementation needs to be done in sidecar module
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KubectlStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[command]
pub async fn check_kubectl_installed() -> Result<KubectlStatus, String> {
    // Check if kubectl is in PATH
    let which_output = if cfg!(target_os = "windows") {
        // On Windows, use "where.exe" or "where" command
        std::process::Command::new("where.exe")
            .arg("kubectl")
            .output()
            .or_else(|_| {
                // Fallback to "where" if where.exe not found
                std::process::Command::new("where")
                    .arg("kubectl")
                    .output()
            })
    } else {
        std::process::Command::new("which")
            .arg("kubectl")
            .output()
    };

    match which_output {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8(output.stdout)
                .ok()
                .map(|s| s.trim().to_string());
            
            // Try to get version
            let version_output = std::process::Command::new("kubectl")
                .args(&["version", "--client", "--short"])
                .output();
            
            let version = version_output
                .ok()
                .and_then(|v| String::from_utf8(v.stdout).ok())
                .map(|s| s.trim().to_string());

            Ok(KubectlStatus {
                installed: true,
                version,
                path,
            })
        }
        _ => {
            Ok(KubectlStatus {
                installed: false,
                version: None,
                path: None,
            })
        }
    }
}

// Helper functions

async fn get_kubeconfig_path(path: Option<String>) -> Result<PathBuf, String> {
    // First check if custom path is set
    if path.is_none() {
        if let Ok(settings) = load_security_settings().await {
            if let Some(custom_path) = settings.kubeconfig_path {
                return Ok(PathBuf::from(custom_path));
            }
        }
    }
    
    match path {
        Some(p) => Ok(PathBuf::from(p)),
        None => {
            let home = dirs::home_dir()
                .ok_or("Could not find home directory")?;
            Ok(home.join(".kube").join("config"))
        }
    }
}

fn parse_contexts(config: &Value) -> Result<Vec<KubeconfigContext>, String> {
    let contexts = config.get("contexts")
        .and_then(|v| v.as_array())
        .ok_or("No contexts found in kubeconfig")?;
    
    let mut result = Vec::new();
    
    for ctx in contexts {
        let name = ctx.get("name")
            .and_then(|v: &Value| v.as_str())
            .ok_or("Context missing name")?
            .to_string();
        
        let context = ctx.get("context")
            .ok_or("Context missing context field")?;
        
        let cluster = context.get("cluster")
            .and_then(|v: &Value| v.as_str())
            .ok_or("Context missing cluster")?
            .to_string();
        
        let user = context.get("user")
            .and_then(|v: &Value| v.as_str())
            .ok_or("Context missing user")?
            .to_string();
        
        let namespace = context.get("namespace")
            .and_then(|v: &Value| v.as_str())
            .map(String::from);
        
        result.push(KubeconfigContext {
            name,
            cluster,
            user,
            namespace,
        });
    }
    
    Ok(result)
}
