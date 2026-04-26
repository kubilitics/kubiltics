//! Profile — UUID-keyed AI configuration unit.
//!
//! See docs/superpowers/specs/2026-04-26-ai-profile-architecture-design.md
//! for the full architecture. Summary: each Profile holds non-secret
//! config (provider, model, base_url) plus metadata (name, timestamps,
//! last validation result). Secrets live in the macOS Keychain keyed
//! by Profile UUID — never in the journal.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod journal;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Profile {
    pub id: Uuid,
    pub name: String,
    pub provider: String, // "openai" | "anthropic" | "ollama" | "custom"
    pub model: String,
    pub base_url: String,
    /// Cached at write time by probing the keychain. Not authoritative.
    pub has_key: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_validated_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

impl Profile {
    pub fn new(
        name: impl Into<String>,
        provider: impl Into<String>,
        model: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            provider: provider.into(),
            model: model.into(),
            base_url: base_url.into(),
            has_key: false,
            created_at: now,
            updated_at: now,
            last_validated_at: None,
            last_error: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProfileError {
    #[error("profile not found: {0}")]
    NotFound(Uuid),
    #[error("active profile cannot be deleted; switch first")]
    DeleteActive,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde_json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("keychain: {0}")]
    Keychain(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("brain hot-wire failed: {0}")]
    BrainHotwire(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_new_generates_unique_uuids() {
        let a = Profile::new("a", "openai", "gpt-4o", "");
        let b = Profile::new("b", "openai", "gpt-4o", "");
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn profile_new_seeds_timestamps() {
        let p = Profile::new("a", "openai", "gpt-4o", "");
        assert_eq!(p.created_at, p.updated_at);
        assert!(p.last_validated_at.is_none());
        assert!(p.last_error.is_none());
    }
}
