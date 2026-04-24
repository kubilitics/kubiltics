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
    /// Cached "we saved a key previously" flag. DELIBERATELY not the
    /// ground truth — ground truth is whether the keychain Entry returns
    /// a value when the brain actually tries to use it. We avoid probing
    /// the keychain on every page load because macOS binds keychain ACLs
    /// to a binary signature hash: every `cargo tauri dev` rebuild
    /// changes the hash, the ACL no longer matches, and the OS pops the
    /// "enter login password" dialog on every hydrate(). That dialog is
    /// what users see as "dangerously annoying UX". Instead, we flip
    /// this flag to true on save_ai_config() (we just wrote a key) and
    /// to false when the user explicitly clears. The UI uses this to
    /// render "configured" vs "needs API key". Staleness is bounded:
    /// test_llm_connection() and real brain calls always hit the
    /// keychain and surface authoritative errors.
    #[serde(default)]
    has_api_key: bool,
    /// One-shot migration flag: set to true the first time we've
    /// authoritatively probed the keychain to populate `has_api_key`.
    /// Before this, `has_api_key` might be a false-negative for users
    /// upgrading from a pre-cached-flag build (they saved a key, the
    /// old code probed on every load, the new code reads the yaml —
    /// and the yaml defaulted to `false` because the field didn't
    /// exist yet). The UI calls `migrate_has_api_key` on first mount
    /// when this is false; that command probes the keychain once
    /// (one expected password prompt, with a clear preface toast),
    /// writes the correct flag, and sets this to true. No further
    /// keychain access on page load thereafter.
    #[serde(default)]
    migrated_keychain_probe: bool,
}

fn write_yaml(cfg: &AIConfig, has_api_key: bool, migrated_keychain_probe: bool) -> Result<(), String> {
    let payload = YamlPayload {
        provider: cfg.provider.clone(),
        model: cfg.model.clone(),
        base_url: cfg.base_url.clone(),
        has_api_key,
        migrated_keychain_probe,
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

    // Pull the key: either the user just pasted one (cfg.api_key) or we
    // already have one in the keychain from a previous save. Track
    // whether a key ended up present so we can persist the cached flag
    // alongside the non-secret fields.
    let (live_key, has_api_key) = match cfg.api_key.as_deref() {
        Some(k) if !k.is_empty() => {
            keychain_set(&cfg.provider, k)?;
            (k.to_string(), true)
        }
        _ => {
            // No new key pasted. Check whether one already exists in the
            // keychain for this provider (reuse prior save). If the read
            // fails (e.g. dev-rebuild ACL mismatch), keep whatever the
            // yaml flag said before — reading the yaml is cheap and doesn't
            // prompt. Net effect: "key is still there, we just can't read
            // it right now" is preserved, so the UI doesn't flip to
            // needs-API-key after every rebuild.
            let existing = keychain_get(&cfg.provider).ok().flatten().unwrap_or_default();
            let flag = if !existing.is_empty() {
                true
            } else {
                read_yaml().ok().flatten().map(|y| y.has_api_key).unwrap_or(false)
            };
            (existing, flag)
        }
    };

    // Saving is itself an authoritative keychain touch — mark migration
    // complete so the UI doesn't re-probe on next launch.
    write_yaml(&cfg, has_api_key, true)?;

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
    // Read non-secret fields + cached has_api_key flag from YAML.
    // IMPORTANT: DO NOT probe the keychain here. Reading the keychain
    // triggers the macOS "enter login password to allow access" dialog
    // every time the binary signature hash doesn't match the stored ACL
    // — which is every `cargo tauri dev` rebuild. Previously load_ai_config
    // was called on every AI Settings page mount, so opening the page
    // after any dev rebuild produced a password prompt. Authoritative
    // keychain access happens only on explicit user actions:
    //   save_ai_config         (writing a new key)
    //   test_llm_connection   (testing the current key)
    //   brain spawn via POST /api/v1/config/provider in save_ai_config
    // All three are user-initiated, so the dialog they might trigger is
    // expected and consented to.
    let yaml = read_yaml()?.unwrap_or(YamlPayload {
        provider: "openai".to_string(),
        model: "gpt-4o".to_string(),
        base_url: String::new(),
        has_api_key: false,
        migrated_keychain_probe: false,
    });
    // Env-var override: when an API key is injected via env (CI, headless
    // Helm installs, bench configs) report present regardless of the yaml
    // cache. Env-var access does not touch the keychain.
    let env_key_present = std::env::var(ENV_API_KEY)
        .ok()
        .filter(|v| !v.is_empty())
        .is_some();
    let key_present = env_key_present || yaml.has_api_key;
    Ok(AIConfig {
        provider: yaml.provider,
        model: yaml.model,
        base_url: yaml.base_url,
        api_key: None, // NEVER return the raw key to the webview
        has_api_key: key_present,
    })
}

// REMOVED: migrate_has_api_key
//
// This command used to do a one-shot authoritative keychain probe to
// reconcile the cached `has_api_key` yaml flag with the real keychain
// state (useful for users upgrading from pre-cache-flag builds). Even
// one prompt on page open was deemed unacceptable UX — removed on user
// request. The yaml cache is now the ONLY source for has_api_key on the
// UI path. Users who had a key on a pre-cache build will see "needs
// API key" until they next click Save; that single Save is the only
// user-initiated keychain touch and the prompt there is expected.
//
// If the migration need resurfaces in a future release, reintroduce
// behind a user-triggered "Verify keychain" button — never automatic
// on mount.

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

    // Best-effort liveness ping. Any error body is scrubbed before
    // bubbling. We keep the HTTP logic intentionally shallow — the
    // authoritative connection test lives in the brain; this desktop-side
    // probe is just to give users an instant pass/fail.
    //
    // Per-provider endpoints:
    //   openai/anthropic/custom  → POST /chat/completions (OpenAI-compat)
    //   ollama                   → GET /api/tags (Ollama-native)
    //
    // Ollama is a DIFFERENT API surface from OpenAI — it does not speak
    // /chat/completions at the root of the URL the user types in. (It
    // *can* speak OpenAI-compat at /v1/chat/completions, but we'd then
    // have to guess whether to append /v1 or not based on what the user
    // pasted. Fragile.) Instead we hit /api/tags: Ollama's list-models
    // endpoint — fast, returns 200 + JSON on a live server, no tokens
    // billed, no model needs to be loaded. This exactly matches the
    // brain's own Ollama adapter (brain/internal/llm/provider/ollama
    // also uses /api/tags for liveness), so if the test passes the real
    // path will too. If the user configured a model that isn't pulled
    // on the remote server, we additionally flag that as a warning so
    // Test doesn't lie with a green tick when the actual chat will 404.
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

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let start = std::time::Instant::now();

    if cfg.provider == "ollama" {
        // Strip a trailing /v1 if the user copy-pasted an OpenAI-compat
        // URL — Ollama native lives at the root, and /v1/api/tags does
        // not exist. Also normalize trailing slash.
        let base_normalized = base
            .trim_end_matches('/')
            .trim_end_matches("/v1")
            .to_string();
        let url = format!("{}/api/tags", base_normalized);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| redact(&format!("{}", e)))?;
        let status = resp.status().as_u16();
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Ok(TestResult {
                ok: false,
                status,
                latency_ms: start.elapsed().as_millis() as u64,
                error: Some(format!(
                    "Ollama /api/tags returned HTTP {}. Is {} actually an Ollama server? {}",
                    status,
                    base_normalized,
                    redact(&body).chars().take(200).collect::<String>()
                )),
            });
        }
        // Parse tags response and check the configured model exists. If
        // not, return ok=false with a friendly error — passing the
        // liveness test while the model is absent would make Save &
        // Test lie; the brain's first real chat would then 404.
        let body = resp.text().await.unwrap_or_default();
        let latency_ms = start.elapsed().as_millis() as u64;
        #[derive(Deserialize)]
        struct TagsResp {
            models: Vec<TagModel>,
        }
        #[derive(Deserialize)]
        struct TagModel {
            name: String,
        }
        let available: Vec<String> = serde_json::from_str::<TagsResp>(&body)
            .map(|t| t.models.into_iter().map(|m| m.name).collect())
            .unwrap_or_default();
        let model_present = model.is_empty() || available.iter().any(|m| m == &model);
        if !model_present {
            let sample: Vec<String> = available.iter().take(5).cloned().collect();
            return Ok(TestResult {
                ok: false,
                status,
                latency_ms,
                error: Some(format!(
                    "Ollama server is reachable ({}ms) but model \"{}\" is not pulled there. Available models: {}{}",
                    latency_ms,
                    model,
                    if sample.is_empty() { "(none)".to_string() } else { sample.join(", ") },
                    if available.len() > sample.len() { format!(" (+{} more)", available.len() - sample.len()) } else { String::new() },
                )),
            });
        }
        return Ok(TestResult {
            ok: true,
            status,
            latency_ms,
            error: None,
        });
    }

    // OpenAI-compat path (openai, anthropic, custom).
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

    // Surface the keychain-stored config even when the env is empty, so
    // users who already connected once see that as an option.
    //
    // IMPORTANT: DO NOT probe the keychain here. A raw keychain_get()
    // triggers the macOS "enter login password" dialog every time the
    // binary signature hash doesn't match the stored ACL — which is
    // every `cargo tauri dev` rebuild. Previously this function iterated
    // over all four providers and fired up to four keychain reads on
    // every AI Settings page mount, producing the password prompt users
    // reported as "dangerously annoying UX".
    //
    // Instead, consult the cached `has_api_key` flag in config.yaml
    // (written by save_ai_config) and surface only the currently-saved
    // provider. That's the one the user actually saved; we don't need
    // to fish for old entries across all providers.
    let saved = read_yaml().ok().flatten();
    if let Some(y) = saved {
        if y.has_api_key && !y.provider.is_empty() {
            let already_listed = out.iter().any(|p| p.provider == y.provider);
            if !already_listed {
                // Prefer the user's saved model/base_url over a default so
                // the "keychain" quick-connect reproduces the exact last
                // working config. Falls back to provider defaults if the
                // yaml somehow doesn't carry them.
                let default_model = match y.provider.as_str() {
                    "openai" => "gpt-4o-mini",
                    "anthropic" => "claude-3-5-sonnet-latest",
                    "ollama" => "llama3",
                    _ => "",
                };
                let default_base = if y.provider == "ollama" {
                    "http://localhost:11434".to_string()
                } else {
                    String::new()
                };
                out.push(DetectedProvider {
                    provider: y.provider.clone(),
                    source: "keychain".into(),
                    model: if y.model.is_empty() { default_model.to_string() } else { y.model.clone() },
                    base_url: if y.base_url.is_empty() { default_base } else { y.base_url.clone() },
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
        // Ollama uses its NATIVE API surface at the root (/api/tags,
        // /api/chat, /api/generate). No /v1 suffix — that's Ollama's
        // OpenAI-compat mode and it lives at a different path. The brain's
        // Ollama adapter assumes root + /api/*, so matching that here
        // means test_llm_connection tests the exact URL the brain will
        // actually hit.
        "ollama" => "http://localhost:11434".to_string(),
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
    #[serial_test::serial(ai_config_global_state)]
    fn keyring_round_trip_mock_backend() {
        // Uses the cross-Entry-persisting in-memory credential builder
        // defined in ai_config_e2e_test::inmem_keyring. keyring v3's
        // bundled mock has EntryOnly persistence, which makes save+load
        // tests impossible because each Entry::new creates a fresh mock.
        super::e2e::use_mock_keyring();
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
            has_api_key: true,
            migrated_keychain_probe: true,
        };
        let s = serde_yaml::to_string(&payload).unwrap();
        assert!(!s.contains("sk-do-not-persist"), "yaml leaked key: {}", s);
        // YAML IS allowed to contain the substring "api_key" now — we
        // serialize the cached has_api_key boolean flag. The assertion
        // must still reject an actual secret. Check for raw-key-looking
        // patterns instead of any substring match.
        assert!(!s.contains("api_key: \"sk-"), "yaml looks like it leaked a raw key: {}", s);
        assert!(!s.contains("api_key: sk-"), "yaml looks like it leaked a raw key: {}", s);
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
