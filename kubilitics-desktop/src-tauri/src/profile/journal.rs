//! Journal — the on-disk catalog of all Profile entries.
//!
//! Persisted as JSON at `<config_dir>/kubilitics/profiles.json`. Writes
//! are atomic (tempfile + rename) so a crash mid-write leaves the prior
//! file intact — no torn JSON.

use super::{Profile, ProfileError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const JOURNAL_FILENAME: &str = "profiles.json";
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Journal {
    pub schema_version: u32,
    pub active_profile_id: Option<Uuid>,
    pub profiles: Vec<Profile>,
}

impl Default for Journal {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            active_profile_id: None,
            profiles: Vec::new(),
        }
    }
}

impl Journal {
    pub fn empty() -> Self {
        Self::default()
    }

    /// Default journal location under the OS config dir.
    pub fn default_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
            .join("kubilitics")
            .join(JOURNAL_FILENAME)
    }

    /// Load from disk; returns an empty journal if the file doesn't exist.
    pub fn load(path: &Path) -> Result<Self, ProfileError> {
        match std::fs::read(path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::empty()),
            Err(e) => Err(e.into()),
        }
    }

    /// Atomic save: write to a sibling temp file, fsync, rename to target.
    /// Crash mid-write leaves the prior file intact.
    pub fn save_atomic(&self, path: &Path) -> Result<(), ProfileError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self)?;
        let tmp_path = path.with_extension(format!("json.tmp.{}", std::process::id()));
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp_path)?;
            f.write_all(&bytes)?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp_path, path)?;
        Ok(())
    }

    pub fn find(&self, id: Uuid) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    pub fn find_mut(&mut self, id: Uuid) -> Option<&mut Profile> {
        self.profiles.iter_mut().find(|p| p.id == id)
    }

    pub fn active(&self) -> Option<&Profile> {
        self.active_profile_id.and_then(|id| self.find(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::Profile;
    use tempfile::TempDir;

    fn fresh_profile() -> Profile {
        Profile::new("Test", "openai", "gpt-4o", "")
    }

    #[test]
    fn load_returns_empty_when_file_missing() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("profiles.json");
        let j = Journal::load(&path).unwrap();
        assert_eq!(j.schema_version, SCHEMA_VERSION);
        assert!(j.profiles.is_empty());
        assert!(j.active_profile_id.is_none());
    }

    #[test]
    fn round_trip_preserves_data() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("profiles.json");
        let mut j = Journal::empty();
        let p = fresh_profile();
        let pid = p.id;
        j.profiles.push(p);
        j.active_profile_id = Some(pid);

        j.save_atomic(&path).unwrap();
        let loaded = Journal::load(&path).unwrap();

        assert_eq!(loaded.profiles.len(), 1);
        assert_eq!(loaded.active_profile_id, Some(pid));
        assert_eq!(loaded.profiles[0].name, "Test");
    }

    #[test]
    fn save_atomic_creates_parent_dirs() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nested").join("dir").join("profiles.json");
        Journal::empty().save_atomic(&path).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn save_atomic_does_not_leave_temp_file_on_success() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("profiles.json");
        Journal::empty().save_atomic(&path).unwrap();
        let entries: Vec<_> = std::fs::read_dir(tmp.path()).unwrap().collect();
        assert_eq!(entries.len(), 1, "only profiles.json should remain");
    }

    #[test]
    fn find_returns_none_for_unknown_id() {
        let j = Journal::empty();
        assert!(j.find(Uuid::new_v4()).is_none());
    }

    #[test]
    fn active_returns_none_when_unset() {
        let mut j = Journal::empty();
        j.profiles.push(fresh_profile());
        assert!(j.active().is_none());
    }

    #[test]
    fn active_returns_profile_when_set() {
        let mut j = Journal::empty();
        let p = fresh_profile();
        let pid = p.id;
        j.profiles.push(p);
        j.active_profile_id = Some(pid);
        assert_eq!(j.active().unwrap().id, pid);
    }
}
