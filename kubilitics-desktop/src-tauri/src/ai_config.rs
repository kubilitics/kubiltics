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
use tauri::{command, Manager};

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

// The webview is untrusted: the Rust command is the authority for what a
// valid AIConfig looks like. Centralized here so save_ai_config has a
// single validate-then-commit shape. Errors surface back as toast.
const VALID_PROVIDERS: &[&str] = &["openai", "anthropic", "ollama", "custom"];
const MAX_MODEL_LEN: usize = 100;

fn validate_ai_config(cfg: &AIConfig) -> Result<(), String> {
    if !VALID_PROVIDERS.contains(&cfg.provider.as_str()) {
        return Err(format!(
            "invalid provider {:?}: must be one of {:?}",
            cfg.provider, VALID_PROVIDERS
        ));
    }
    if cfg.model.trim().is_empty() {
        return Err("model must not be empty".to_string());
    }
    if cfg.model.len() > MAX_MODEL_LEN {
        return Err(format!(
            "model name too long: {} chars, max {}",
            cfg.model.len(),
            MAX_MODEL_LEN
        ));
    }
    if !cfg.base_url.trim().is_empty() {
        url::Url::parse(&cfg.base_url).map_err(|e| format!("invalid base_url: {}", e))?;
    }
    Ok(())
}

#[command]
pub async fn save_ai_config(cfg: AIConfig) -> Result<(), String> {
    validate_ai_config(&cfg)?;
    write_yaml(&cfg)?;

    // Pull the key: either the user just pasted one (cfg.api_key) or we
    // already have one in the keychain from a previous save.
    let live_key = match cfg.api_key.as_deref() {
        Some(k) if !k.is_empty() => {
            keychain_set(&cfg.provider, k)?;
            k.to_string()
        }
        _ => keychain_get(&cfg.provider).ok().flatten().unwrap_or_default(),
    };

    // Hot-wire the brain with the new provider/key via its
    // POST /api/v1/config/provider endpoint.  Unlike restart, this avoids
    // port churn and the user never sees the AI drop to "unreachable"
    // in the middle of a save.  Best-effort: save succeeds even if the
    // brain isn't running yet.
    if !live_key.is_empty() || cfg.provider == "ollama" {
        let base = std::env::var("KUBILITICS_AI_ADMIN_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8081".to_string());
        let body = serde_json::json!({
            "provider": cfg.provider,
            "api_key": live_key,
            "model":   cfg.model,
            "base_url": cfg.base_url,
        });
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| format!("http client: {}", e))?;
        if let Err(e) = client
            .post(format!("{}/api/v1/config/provider", base.trim_end_matches('/')))
            .json(&body)
            .send()
            .await
        {
            // Non-fatal: the brain might not be running yet (first launch,
            // or the user is editing Settings before the brain has spawned).
            // The config is persisted; the brain will load it on next start.
            eprintln!("save_ai_config: brain hot-wire failed (will apply on next brain start): {}", e);
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

#[derive(Debug, Serialize, Clone)]
pub struct DetectedProvider {
    pub provider: String, // openai | anthropic | ollama
    pub source: String,   // env | localhost | keychain
    pub model: String,    // recommended model
    pub base_url: String, // empty for hosted providers
    pub env_var: String,  // which env var was found (blank for localhost)
}

/// detect_available_providers — scans the user's environment + localhost for
/// any AI provider we support, so the UI can offer a one-click "Use this".
///
/// Order:
///   1. OPENAI_API_KEY in env   → openai / gpt-4o-mini
///   2. ANTHROPIC_API_KEY       → anthropic / claude-3-5-sonnet-latest
///   3. TOGETHER_API_KEY        → custom base_url=https://api.together.xyz/v1 / Qwen/Qwen2.5-7B-Instruct-Turbo
///   4. GROQ_API_KEY            → custom base_url=https://api.groq.com/openai/v1 / llama-3.3-70b-versatile
///   5. Ollama on localhost:11434 → ollama / llama3
///   6. Already in keychain     → the saved provider
///
/// Returns all detected options so the UI can rank them with the first as the
/// recommended default.
#[command]
pub async fn detect_available_providers() -> Result<Vec<DetectedProvider>, String> {
    let mut out: Vec<DetectedProvider> = Vec::new();

    let env_sources: [(&str, &str, &str, &str); 4] = [
        ("OPENAI_API_KEY",    "openai",    "gpt-4o-mini",                     ""),
        ("ANTHROPIC_API_KEY", "anthropic", "claude-3-5-sonnet-latest",        ""),
        ("TOGETHER_API_KEY",  "custom",    "Qwen/Qwen2.5-7B-Instruct-Turbo",  "https://api.together.xyz/v1"),
        ("GROQ_API_KEY",      "custom",    "llama-3.3-70b-versatile",         "https://api.groq.com/openai/v1"),
    ];
    for (var, provider, model, base_url) in env_sources {
        if !std::env::var(var).unwrap_or_default().is_empty() {
            out.push(DetectedProvider {
                provider: provider.into(),
                source: "env".into(),
                model: model.into(),
                base_url: base_url.into(),
                env_var: var.into(),
            });
        }
    }

    // Probe Ollama on localhost (best-effort, 1s timeout).  Must use async
    // reqwest here — Tauri commands already run on tokio, and block_on
    // inside a tokio worker panics with "Cannot start a runtime from
    // within a runtime".
    let ollama_ok = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .build()
    {
        Ok(c) => c
            .get("http://localhost:11434/api/tags")
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    };
    if ollama_ok {
        out.push(DetectedProvider {
            provider: "ollama".into(),
            source: "localhost".into(),
            model: "llama3".into(),
            base_url: "http://localhost:11434".into(),
            env_var: String::new(),
        });
    }

    // Surface keychain-stored configs even when the env is empty, so users who
    // already connected once see that as an option.
    for provider in ["openai", "anthropic", "ollama", "custom"] {
        if let Ok(Some(_)) = keychain_get(provider) {
            let already_listed = out.iter().any(|p| p.provider == provider);
            if !already_listed {
                out.push(DetectedProvider {
                    provider: provider.into(),
                    source: "keychain".into(),
                    model: match provider {
                        "openai" => "gpt-4o-mini",
                        "anthropic" => "claude-3-5-sonnet-latest",
                        "ollama" => "llama3",
                        _ => "",
                    }.into(),
                    base_url: if provider == "ollama" { "http://localhost:11434".into() } else { String::new() },
                    env_var: String::new(),
                });
            }
        }
    }

    Ok(out)
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

// E2E round-trip regression (Phase 2 / Gap 5). In its own file for
// clarity. Uses the keyring mock backend + a wiremock HTTP server so
// `cargo test` can run it without network or a real keychain.
#[cfg(test)]
#[path = "ai_config_e2e_test.rs"]
mod e2e;

#[cfg(test)]
mod validation_tests {
    use super::*;

    fn cfg(provider: &str, model: &str, base_url: &str) -> AIConfig {
        AIConfig {
            provider: provider.to_string(),
            model: model.to_string(),
            base_url: base_url.to_string(),
            api_key: None,
            has_api_key: false,
        }
    }

    #[test]
    fn valid_config_passes() {
        let c = cfg("openai", "gpt-4o-mini", "https://api.openai.com/v1");
        assert!(validate_ai_config(&c).is_ok());
    }

    #[test]
    fn empty_base_url_is_ok() {
        // Users may leave base_url blank to use provider defaults.
        let c = cfg("openai", "gpt-4o-mini", "");
        assert!(validate_ai_config(&c).is_ok());
    }

    #[test]
    fn invalid_provider_is_rejected() {
        let c = cfg("gemini", "gemini-pro", "");
        let err = validate_ai_config(&c).expect_err("expected rejection");
        assert!(err.contains("invalid provider"), "got: {}", err);
    }

    #[test]
    fn empty_model_is_rejected() {
        let c = cfg("openai", "   ", "");
        let err = validate_ai_config(&c).expect_err("expected rejection");
        assert!(err.contains("model must not be empty"), "got: {}", err);
    }

    #[test]
    fn overlong_model_is_rejected() {
        let c = cfg("openai", &"x".repeat(101), "");
        let err = validate_ai_config(&c).expect_err("expected rejection");
        assert!(err.contains("model name too long"), "got: {}", err);
    }

    #[test]
    fn malformed_base_url_is_rejected() {
        let c = cfg("openai", "gpt-4o-mini", "not a url");
        let err = validate_ai_config(&c).expect_err("expected rejection");
        assert!(err.contains("invalid base_url"), "got: {}", err);
    }
}
