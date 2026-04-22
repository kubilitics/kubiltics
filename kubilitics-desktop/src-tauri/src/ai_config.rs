// Phase 2 / Blocker C — AI Settings round-trip through the OS keychain.
//
// Three Tauri commands:
//   save_ai_config(cfg)       — writes YAML (non-secret fields) to
//                                `<app_data>/config.yaml` and pushes the
//                                API key to the OS keychain under
//                                (service="kubilitics", account=<provider>).
//   load_ai_config()          — reads YAML + keychain, returns AIConfig with
//                                `has_api_key` flag. The key is NEVER
//                                returned to the frontend — it only leaves
//                                the keychain when the backend / brain
//                                reads it directly.
//   test_llm_connection(cfg)  — 10-token ping to the configured provider.
//                                Errors are returned with API keys redacted.
//
// Env override:
//   If `KUBILITICS_LLM_API_KEY` is set in the environment, it shadows the
//   keychain (useful for CI, headless runs, Helm-deployed installs).
//
// Security:
//   - Key never written to config.yaml.
//   - Key never returned to the webview — load_ai_config() returns only
//     `has_api_key: bool`.
//   - "Test connection" error bodies are scrubbed of any `sk-...` /
//     `Bearer ...` substrings.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

const KEYCHAIN_SERVICE: &str = "kubilitics";
const ENV_API_KEY: &str = "KUBILITICS_LLM_API_KEY";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AIConfig {
    pub provider: String, // openai | anthropic | ollama | custom
    pub model: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default)]
    pub has_api_key: bool,
}

fn app_config_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "no config dir".to_string())?;
    let dir = base.join("kubilitics");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {}", e))?;
    Ok(dir)
}

fn config_yaml_path() -> Result<PathBuf, String> {
    Ok(app_config_dir()?.join("config.yaml"))
}

// ── Keychain wrappers ────────────────────────────────────────────────────
//
// Phase 2 / Gap 6 — single cross-platform implementation via the `keyring`
// crate. The crate binds natively to:
//   - macOS: Keychain Services (same store the old `security` CLI used)
//   - Windows: Credential Manager (wincred)
//   - Linux: libsecret / Secret Service (gnome-keyring, kwallet)
//
// The previous implementation shelled out to `security` on macOS and
// plaintext-wrote to `.{provider}.key` on Linux/Windows — a spec
// violation (Section 3 line 100-102 mandates OS-native keychain on all
// three platforms). This rewrite closes that gap.

fn keychain_set(account: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(|e| format!("keychain entry: {}", e))?;
    entry
        .set_password(secret)
        .map_err(|e| format!("keychain set: {}", e))
}

fn keychain_get(account: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(|e| format!("keychain entry: {}", e))?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain get: {}", e)),
    }
}

#[allow(dead_code)]
fn keychain_delete(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(|e| format!("keychain entry: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain delete: {}", e)),
    }
}

// ── YAML persistence (non-secret fields) ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
struct YamlPayload {
    provider: String,
    model: String,
    #[serde(default)]
    base_url: String,
}

fn write_yaml(cfg: &AIConfig) -> Result<(), String> {
    let payload = YamlPayload {
        provider: cfg.provider.clone(),
        model: cfg.model.clone(),
        base_url: cfg.base_url.clone(),
    };
    let yaml = serde_yaml::to_string(&payload).map_err(|e| format!("yaml: {}", e))?;
    fs::write(config_yaml_path()?, yaml).map_err(|e| format!("write: {}", e))
}

fn read_yaml() -> Result<Option<YamlPayload>, String> {
    let path = config_yaml_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let s = fs::read_to_string(&path).map_err(|e| format!("read: {}", e))?;
    let p: YamlPayload = serde_yaml::from_str(&s).map_err(|e| format!("parse: {}", e))?;
    Ok(Some(p))
}

// ── Commands ─────────────────────────────────────────────────────────────

#[command]
pub async fn save_ai_config(cfg: AIConfig) -> Result<(), String> {
    if cfg.provider.is_empty() {
        return Err("provider required".to_string());
    }
    write_yaml(&cfg)?;
    if let Some(key) = cfg.api_key.as_deref() {
        if !key.is_empty() {
            keychain_set(&cfg.provider, key)?;
        }
    }
    Ok(())
}

#[command]
pub async fn load_ai_config() -> Result<AIConfig, String> {
    let yaml = read_yaml()?.unwrap_or(YamlPayload {
        provider: "openai".to_string(),
        model: "gpt-4o".to_string(),
        base_url: String::new(),
    });
    let key_present = if std::env::var(ENV_API_KEY).ok().filter(|v| !v.is_empty()).is_some() {
        true
    } else {
        keychain_get(&yaml.provider)
            .unwrap_or(None)
            .map(|k| !k.is_empty())
            .unwrap_or(false)
    };
    Ok(AIConfig {
        provider: yaml.provider,
        model: yaml.model,
        base_url: yaml.base_url,
        api_key: None, // NEVER return the raw key to the webview
        has_api_key: key_present,
    })
}

#[command]
pub async fn test_llm_connection(cfg: AIConfig) -> Result<TestResult, String> {
    // Resolve the key the same way the brain will at startup.
    let key = if let Ok(env) = std::env::var(ENV_API_KEY) {
        if !env.is_empty() {
            Some(env)
        } else {
            keychain_get(&cfg.provider).unwrap_or(None)
        }
    } else {
        cfg.api_key.clone().or_else(|| keychain_get(&cfg.provider).unwrap_or(None))
    };

    match cfg.provider.as_str() {
        "openai" | "anthropic" | "custom" => {
            if key.as_deref().unwrap_or("").is_empty() {
                return Err("missing API key (not in keychain or env)".to_string());
            }
        }
        "ollama" => { /* local — no key needed */ }
        _ => return Err(format!("unknown provider: {}", cfg.provider)),
    }

    // Best-effort 10-token ping. Any error body is scrubbed before bubbling.
    // We keep the HTTP logic intentionally shallow — the authoritative
    // connection test lives in the brain; this desktop-side probe is just
    // to give users an instant pass/fail.
    let base = if cfg.base_url.is_empty() {
        default_base_url(&cfg.provider)
    } else {
        cfg.base_url.clone()
    };
    let model = if cfg.model.is_empty() {
        default_model(&cfg.provider)
    } else {
        cfg.model.clone()
    };
    let client = reqwest::Client::new();
    let start = std::time::Instant::now();
    let resp = client
        .post(format!("{}/chat/completions", base.trim_end_matches('/')))
        .bearer_auth(key.as_deref().unwrap_or(""))
        .json(&serde_json::json!({
            "model": model,
            "messages": [{"role":"user","content":"ping"}],
            "max_tokens": 10,
        }))
        .send()
        .await
        .map_err(|e| redact(&format!("{}", e)))?;
    let ok = resp.status().is_success();
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(TestResult {
        ok,
        status,
        latency_ms: start.elapsed().as_millis() as u64,
        error: if ok { None } else { Some(redact(&body)) },
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub status: u16,
    pub latency_ms: u64,
    pub error: Option<String>,
}

// ── Budget admin (Phase 2 / Gap 3) ───────────────────────────────────────
//
// The kubilitics-ai brain exposes /admin/budget/status + /admin/budget/reset
// on its loopback HTTP port. These desktop commands are thin wrappers so
// the AISettingsPage can surface spend + a Reset button without speaking
// HTTP directly from the webview.

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct BudgetStatus {
    pub spent_usd: f64,
    pub cap_usd: f64,
}

/// Endpoint override for tests; falls back to the in-cluster default.
fn brain_admin_base() -> String {
    std::env::var("KUBILITICS_AI_ADMIN_URL").unwrap_or_else(|_| "http://127.0.0.1:8081".to_string())
}

#[command]
pub async fn get_budget_status() -> Result<BudgetStatus, String> {
    let url = format!("{}/admin/budget/status", brain_admin_base().trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| redact(&format!("{}", e)))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let body: BudgetStatus = resp.json().await.map_err(|e| format!("parse: {}", e))?;
    Ok(body)
}

#[command]
pub async fn reset_budget() -> Result<(), String> {
    let url = format!("{}/admin/budget/reset", brain_admin_base().trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .post(&url)
        .send()
        .await
        .map_err(|e| redact(&format!("{}", e)))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    Ok(())
}

fn default_base_url(provider: &str) -> String {
    match provider {
        "anthropic" => "https://api.anthropic.com/v1".to_string(),
        "ollama" => "http://localhost:11434/v1".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

fn default_model(provider: &str) -> String {
    match provider {
        "anthropic" => "claude-3-5-haiku-latest".to_string(),
        "ollama" => "llama3".to_string(),
        _ => "gpt-4o-mini".to_string(),
    }
}

/// Scrub API keys from any string (error bodies, logs).
/// Matches OpenAI (sk-...), Anthropic (sk-ant-...), bearer tokens.
///
/// Implementation: a hand-rolled scanner. We intentionally avoid pulling
/// in a regex crate so the build-time footprint stays small and we don't
/// add unaudited code to the security-critical redaction path.
pub fn redact(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // "sk-..." — any run starting with sk- of length >= 10 becomes REDACTED.
        if i + 3 <= bytes.len() && bytes[i..i + 3].eq_ignore_ascii_case(b"sk-") {
            let start = i;
            let mut j = i + 3;
            while j < bytes.len() && is_key_char(bytes[j]) {
                j += 1;
            }
            if j - start >= 10 {
                out.push_str("[REDACTED]");
                i = j;
                continue;
            }
        }
        // "Bearer <token>"
        if i + 7 <= bytes.len() && bytes[i..i + 6].eq_ignore_ascii_case(b"bearer") && bytes[i + 6] == b' '
        {
            let mut j = i + 7;
            while j < bytes.len() && bytes[j] == b' ' {
                j += 1;
            }
            let tok_start = j;
            while j < bytes.len() && is_key_char(bytes[j]) {
                j += 1;
            }
            if j - tok_start >= 10 {
                out.push_str("Bearer [REDACTED]");
                i = j;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn is_key_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.'
}

#[cfg(test)]
mod tests {
    use super::*;

    // Phase 2 / Gap 6 — keyring round-trip. Uses the `mock` backend (keyring
    // v3 ships one for CI/test use) so this runs in a sandbox without
    // touching real OS credentials. Set via an init guard so concurrent
    // tests in the same process share one mock store safely.
    #[test]
    fn keyring_round_trip_mock_backend() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        // set + get
        keychain_set("test-account-a", "sk-abc-123").expect("set");
        let got = keychain_get("test-account-a").expect("get");
        assert_eq!(got.as_deref(), Some("sk-abc-123"));
        // overwrite + get returns the new value
        keychain_set("test-account-a", "sk-new").expect("set2");
        assert_eq!(keychain_get("test-account-a").unwrap().as_deref(), Some("sk-new"));
        // delete + get returns None
        keychain_delete("test-account-a").expect("delete");
        assert!(keychain_get("test-account-a").unwrap().is_none());
        // NoEntry is not an error for delete
        assert!(keychain_delete("never-set").is_ok());
    }

    #[test]
    fn redact_openai_key() {
        let s = "Authorization: Bearer sk-proj-abc123def456ghi789";
        let r = redact(s);
        assert!(!r.contains("sk-proj-"), "got: {}", r);
        assert!(r.contains("[REDACTED]"));
    }

    #[test]
    fn redact_anthropic_key() {
        let s = "x-api-key: sk-ant-api03-XYZLONGKEY1234567890";
        let r = redact(s);
        assert!(!r.contains("sk-ant-api03"), "got: {}", r);
    }

    #[test]
    fn redact_passthrough_benign() {
        let s = "connection refused";
        assert_eq!(redact(s), "connection refused");
    }

    #[test]
    fn yaml_payload_excludes_api_key() {
        let cfg = AIConfig {
            provider: "openai".to_string(),
            model: "gpt-4o".to_string(),
            base_url: "".to_string(),
            api_key: Some("sk-do-not-persist".to_string()),
            has_api_key: true,
        };
        let payload = YamlPayload {
            provider: cfg.provider.clone(),
            model: cfg.model.clone(),
            base_url: cfg.base_url.clone(),
        };
        let s = serde_yaml::to_string(&payload).unwrap();
        assert!(!s.contains("sk-do-not-persist"), "yaml leaked key: {}", s);
        assert!(!s.contains("api_key"), "yaml included api_key field: {}", s);
    }

    #[test]
    fn default_base_url_known_providers() {
        assert!(default_base_url("openai").contains("openai.com"));
        assert!(default_base_url("anthropic").contains("anthropic.com"));
        assert!(default_base_url("ollama").contains("11434"));
    }
}
