//! Tauri command surface for Profile management. Implements atomic save
//! (keychain → journal; cleanup on failure) and atomic delete (journal
//! → keychain; refuses if active).

use super::{
    journal::Journal,
    keychain,
    Profile, ProfileError,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

/// Held in Tauri's state. Locks all journal mutations.
pub struct ProfileStore {
    pub journal_path: PathBuf,
    pub journal: Mutex<Journal>,
}

impl ProfileStore {
    pub fn new(journal_path: PathBuf) -> Result<Self, ProfileError> {
        let journal = Journal::load(&journal_path)?;
        Ok(Self {
            journal_path,
            journal: Mutex::new(journal),
        })
    }

    fn write_locked(&self, journal: &Journal) -> Result<(), ProfileError> {
        journal.save_atomic(&self.journal_path)
    }
}

fn refresh_has_key(p: &mut Profile) {
    p.has_key = keychain::has_key(p.id);
}

#[tauri::command]
pub fn list_profiles(store: State<'_, ProfileStore>) -> Result<Vec<Profile>, String> {
    let mut journal = store.journal.lock().unwrap();
    for p in &mut journal.profiles {
        refresh_has_key(p);
    }
    Ok(journal.profiles.clone())
}

#[tauri::command]
pub fn get_active_profile(store: State<'_, ProfileStore>) -> Result<Option<Profile>, String> {
    let mut journal = store.journal.lock().unwrap();
    for p in &mut journal.profiles {
        refresh_has_key(p);
    }
    Ok(journal.active().cloned())
}

#[derive(Debug, Deserialize)]
pub struct SaveProfileArgs {
    pub name: String,
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: Option<String>,
}

#[tauri::command]
pub fn save_profile(
    args: SaveProfileArgs,
    store: State<'_, ProfileStore>,
) -> Result<Profile, String> {
    validate_input(&args.provider, &args.model, &args.base_url).map_err(|e| e.to_string())?;

    let mut p = Profile::new(args.name, args.provider, args.model, args.base_url);
    let key_written = if let Some(key) = args.api_key.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        keychain::set_key(p.id, key).map_err(|e| e.to_string())?;
        p.has_key = true;
        true
    } else {
        false
    };

    let mut journal = store.journal.lock().unwrap();
    journal.profiles.push(p.clone());

    if let Err(e) = store.write_locked(&journal) {
        // Roll back: drop from in-memory, delete keychain entry.
        journal.profiles.retain(|q| q.id != p.id);
        if key_written {
            let _ = keychain::delete_key(p.id);
        }
        return Err(e.to_string());
    }
    Ok(p)
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileArgs {
    pub id: Uuid,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[tauri::command]
pub fn update_profile(
    args: UpdateProfileArgs,
    store: State<'_, ProfileStore>,
) -> Result<Profile, String> {
    let mut journal = store.journal.lock().unwrap();
    let original = journal
        .find(args.id)
        .cloned()
        .ok_or_else(|| ProfileError::NotFound(args.id).to_string())?;

    let mut next = original.clone();
    if let Some(n) = args.name {
        next.name = n;
    }
    if let Some(p) = args.provider.clone() {
        next.provider = p;
    }
    if let Some(m) = args.model {
        next.model = m;
    }
    if let Some(u) = args.base_url {
        next.base_url = u;
    }
    next.updated_at = Utc::now();

    validate_input(&next.provider, &next.model, &next.base_url).map_err(|e| e.to_string())?;

    let key_was_written = if let Some(key) = args.api_key.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        keychain::set_key(next.id, key).map_err(|e| e.to_string())?;
        next.has_key = true;
        true
    } else {
        false
    };

    if let Some(target) = journal.find_mut(args.id) {
        *target = next.clone();
    }

    if let Err(e) = store.write_locked(&journal) {
        // Roll back in-memory mutation.
        if let Some(target) = journal.find_mut(args.id) {
            *target = original.clone();
        }
        if key_was_written {
            let _ = keychain::delete_key(next.id);
        }
        return Err(e.to_string());
    }
    Ok(next)
}

#[tauri::command]
pub fn delete_profile(id: Uuid, store: State<'_, ProfileStore>) -> Result<(), String> {
    let mut journal = store.journal.lock().unwrap();
    if journal.active_profile_id == Some(id) {
        return Err(ProfileError::DeleteActive.to_string());
    }
    // Snapshot the entry being removed so we can restore in-memory state
    // if the on-disk write fails. Without this, a disk-write failure
    // would leave the live process showing the profile as deleted while
    // the file still has it — drift on restart.
    let removed: Option<Profile> = journal
        .profiles
        .iter()
        .find(|p| p.id == id)
        .cloned();
    let Some(removed) = removed else {
        return Err(ProfileError::NotFound(id).to_string());
    };
    journal.profiles.retain(|p| p.id != id);
    if let Err(e) = store.write_locked(&journal) {
        // Restore in-memory state — we can't undo a disk failure but we
        // can keep RAM consistent with disk.
        journal.profiles.push(removed);
        return Err(e.to_string());
    }
    let _ = keychain::delete_key(id);
    Ok(())
}

fn validate_input(provider: &str, model: &str, base_url: &str) -> Result<(), ProfileError> {
    match provider {
        "openai" | "anthropic" => {
            if model.trim().is_empty() {
                return Err(ProfileError::Invalid(
                    "model required for hosted provider".into(),
                ));
            }
        }
        "ollama" | "custom" => {
            if base_url.trim().is_empty() {
                return Err(ProfileError::Invalid(
                    "base_url required for ollama / custom".into(),
                ));
            }
        }
        _ => {
            return Err(ProfileError::Invalid(format!(
                "unknown provider: {}",
                provider
            )))
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct ActivateResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

const BRAIN_HTTP_PORT: u16 = 8081;

fn brain_url() -> String {
    format!("http://127.0.0.1:{}", BRAIN_HTTP_PORT)
}

async fn brain_hotwire(profile: &Profile, key: &str, brain_url: &str) -> Result<u64, String> {
    let body = serde_json::json!({
        "provider": profile.provider,
        "model": profile.model,
        "base_url": profile.base_url,
        "api_key": key,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let started = std::time::Instant::now();
    let resp = client
        .post(format!("{}/api/v1/config/provider", brain_url.trim_end_matches('/')))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("brain unreachable: {}", e))?;
    let elapsed = started.elapsed().as_millis() as u64;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "brain rejected ({}): {}",
            status,
            text.lines().next().unwrap_or("")
        ));
    }
    Ok(elapsed)
}

#[tauri::command]
pub async fn activate_profile(
    id: Uuid,
    store: State<'_, ProfileStore>,
) -> Result<ActivateResult, String> {
    let profile = {
        let journal = store.journal.lock().unwrap();
        journal
            .find(id)
            .cloned()
            .ok_or_else(|| ProfileError::NotFound(id).to_string())?
    };

    let key = match keychain::get_key(id).map_err(|e| e.to_string())? {
        Some(k) => k,
        None => {
            return Ok(ActivateResult {
                ok: false,
                latency_ms: 0,
                error: Some("needs_key".into()),
            })
        }
    };

    let url = brain_url();
    match brain_hotwire(&profile, &key, &url).await {
        Ok(latency_ms) => {
            let mut journal = store.journal.lock().unwrap();
            journal.active_profile_id = Some(id);
            if let Some(p) = journal.find_mut(id) {
                p.last_validated_at = Some(Utc::now());
                p.last_error = None;
                p.updated_at = Utc::now();
            }
            store.write_locked(&journal).map_err(|e| e.to_string())?;
            Ok(ActivateResult {
                ok: true,
                latency_ms,
                error: None,
            })
        }
        Err(err) => {
            let mut journal = store.journal.lock().unwrap();
            if let Some(p) = journal.find_mut(id) {
                p.last_error = Some(err.clone());
                p.last_validated_at = Some(Utc::now());
                p.updated_at = Utc::now();
            }
            let _ = store.write_locked(&journal);
            Ok(ActivateResult {
                ok: false,
                latency_ms: 0,
                error: Some(err),
            })
        }
    }
}

/// Probe-only — does NOT change `active_profile_id`. The frontend's Test
/// Connection button calls this. Lookup order for the API key:
///   1. `api_key` argument (if provided non-empty) — the user typed it
///      into the form but hasn't clicked Save yet.
///   2. keychain entry under this profile's UUID — the previously-saved key.
///   3. provider-specific env var (OPENAI_API_KEY / TOGETHER_API_KEY / …)
///      via the same fallback `test_llm_connection` uses.
/// If none of the three yields a key, returns `{ok: false, error: "needs_key"}`.
#[tauri::command]
pub async fn test_profile(
    id: Uuid,
    api_key: Option<String>,
    store: State<'_, ProfileStore>,
) -> Result<TestResult, String> {
    let profile = {
        let journal = store.journal.lock().unwrap();
        journal
            .find(id)
            .cloned()
            .ok_or_else(|| ProfileError::NotFound(id).to_string())?
    };
    // Priority: typed key > keychain > provider-specific env var.
    let key = api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            keychain::get_key(id)
                .ok()
                .flatten()
                .filter(|s| !s.is_empty())
        })
        .or_else(|| {
            crate::ai_config::provider_env_key(&profile.provider, &profile.base_url)
        });

    let key = match key {
        Some(k) if !k.trim().is_empty() => k,
        _ => {
            return Ok(TestResult {
                ok: false,
                latency_ms: 0,
                error: Some("needs_key".into()),
            })
        }
    };
    match brain_hotwire(&profile, &key, &brain_url()).await {
        Ok(latency_ms) => Ok(TestResult {
            ok: true,
            latency_ms,
            error: None,
        }),
        Err(err) => Ok(TestResult {
            ok: false,
            latency_ms: 0,
            error: Some(err),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn validate_input_accepts_known_combos() {
        assert!(validate_input("openai", "gpt-4o", "").is_ok());
        assert!(validate_input("custom", "qwen", "https://api.example.com").is_ok());
    }

    #[test]
    fn validate_input_rejects_unknown_provider() {
        assert!(validate_input("foobar", "x", "").is_err());
    }

    #[test]
    fn validate_input_requires_base_url_for_custom() {
        assert!(validate_input("custom", "qwen", "").is_err());
    }

    #[test]
    fn store_round_trips_through_disk() {
        let tmp = TempDir::new().unwrap();
        let store = ProfileStore::new(tmp.path().join("profiles.json")).unwrap();
        assert_eq!(store.journal.lock().unwrap().profiles.len(), 0);
    }
}
