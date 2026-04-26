//! Migration — runs once at Tauri startup. Idempotent. Reads the legacy
//! desktop YAML (`config.yaml`), creates a single "Default" profile, marks
//! it active without a key reference (key must be re-entered through the
//! atomic save path — see Option B in the spec), and removes the ghost
//! YAML at `~/.kubilitics/ai-overrides.yaml`.

use super::{journal::Journal, Profile, ProfileError};
use std::path::{Path, PathBuf};

#[derive(Debug, Default, PartialEq)]
pub struct MigrationReport {
    pub already_migrated: bool,
    pub migrated_default: bool,
    pub removed_ghost: bool,
    pub renamed_legacy_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct LegacyYaml {
    pub provider: String,
    pub model: String,
    pub base_url: String,
}

fn parse_legacy_yaml(body: &str) -> LegacyYaml {
    let mut out = LegacyYaml::default();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((k, v)) = trimmed.split_once(':') else {
            continue;
        };
        let k = k.trim();
        let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
        match k {
            "provider" => out.provider = v,
            "model" => out.model = v,
            "base_url" => out.base_url = v,
            _ => {}
        }
    }
    out
}

/// Run migration once. Inputs are passed in for testability — `migrate_default_paths`
/// uses real OS paths.
pub fn migrate(
    journal_path: &Path,
    desktop_yaml_path: &Path,
    backend_overrides_path: &Path,
) -> Result<MigrationReport, ProfileError> {
    if journal_path.exists() {
        return Ok(MigrationReport {
            already_migrated: true,
            ..Default::default()
        });
    }

    let mut report = MigrationReport::default();
    let mut journal = Journal::empty();

    if let Ok(body) = std::fs::read_to_string(desktop_yaml_path) {
        let legacy = parse_legacy_yaml(&body);
        if !legacy.provider.is_empty() {
            let mut p = Profile::new(
                "Default",
                &legacy.provider,
                &legacy.model,
                &legacy.base_url,
            );
            p.last_error = Some("Re-enter API key after migration".into());
            let pid = p.id;
            journal.profiles.push(p);
            journal.active_profile_id = Some(pid);
            report.migrated_default = true;
        }
        // Rename the legacy file out of the way so brain code stops
        // accidentally reading it. Keep for forensics.
        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
        let renamed = desktop_yaml_path.with_extension(format!("yaml.legacy.{}", stamp));
        std::fs::rename(desktop_yaml_path, &renamed)?;
        report.renamed_legacy_path = Some(renamed);
    }

    // Always remove the ghost. Backend code that reads it gets deleted in
    // Phase 4, but we nuke the file regardless so old binaries can't lie.
    if backend_overrides_path.exists() {
        std::fs::remove_file(backend_overrides_path)?;
        report.removed_ghost = true;
    }

    journal.save_atomic(journal_path)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn fresh_machine_no_legacy_anywhere() {
        let tmp = TempDir::new().unwrap();
        let journal = tmp.path().join("profiles.json");
        let yaml = tmp.path().join("config.yaml");
        let ghost = tmp.path().join("ai-overrides.yaml");
        let report = migrate(&journal, &yaml, &ghost).unwrap();
        assert_eq!(report.migrated_default, false);
        assert_eq!(report.removed_ghost, false);
        assert!(journal.exists());
        let j = Journal::load(&journal).unwrap();
        assert!(j.profiles.is_empty());
    }

    #[test]
    fn migrates_desktop_yaml_to_default_profile_no_key() {
        let tmp = TempDir::new().unwrap();
        let journal = tmp.path().join("profiles.json");
        let yaml = tmp.path().join("config.yaml");
        let ghost = tmp.path().join("ai-overrides.yaml");
        write(&yaml, "provider: openai\nmodel: gpt-4o-mini\nbase_url: \nhas_api_key: true\n");
        let report = migrate(&journal, &yaml, &ghost).unwrap();
        assert!(report.migrated_default);
        assert!(report.renamed_legacy_path.is_some());
        assert!(!yaml.exists(), "original config.yaml should be renamed");
        let j = Journal::load(&journal).unwrap();
        assert_eq!(j.profiles.len(), 1);
        assert_eq!(j.profiles[0].provider, "openai");
        assert_eq!(j.profiles[0].model, "gpt-4o-mini");
        assert!(!j.profiles[0].has_key, "key not migrated — Option B");
        assert_eq!(j.active_profile_id, Some(j.profiles[0].id));
        assert_eq!(j.profiles[0].last_error.as_deref(), Some("Re-enter API key after migration"));
    }

    #[test]
    fn removes_ghost_yaml_when_present() {
        let tmp = TempDir::new().unwrap();
        let journal = tmp.path().join("profiles.json");
        let yaml = tmp.path().join("config.yaml");
        let ghost = tmp.path().join("ai-overrides.yaml");
        write(&ghost, "provider: ollama\nbase_url: http://stale.local\n");
        let report = migrate(&journal, &yaml, &ghost).unwrap();
        assert!(report.removed_ghost);
        assert!(!ghost.exists());
    }

    #[test]
    fn idempotent_when_journal_already_exists() {
        let tmp = TempDir::new().unwrap();
        let journal = tmp.path().join("profiles.json");
        let yaml = tmp.path().join("config.yaml");
        let ghost = tmp.path().join("ai-overrides.yaml");
        Journal::empty().save_atomic(&journal).unwrap();
        write(&yaml, "provider: should-not-be-read\n");
        write(&ghost, "should-not-be-removed");
        let report = migrate(&journal, &yaml, &ghost).unwrap();
        assert!(report.already_migrated);
        assert!(!report.migrated_default);
        assert!(!report.removed_ghost);
        assert!(yaml.exists(), "yaml untouched on re-run");
        assert!(ghost.exists(), "ghost untouched on re-run");
    }

    #[test]
    fn parse_legacy_handles_quoted_values() {
        let yaml = "provider: \"openai\"\nmodel: 'gpt-4o'\nbase_url:\n";
        let parsed = parse_legacy_yaml(yaml);
        assert_eq!(parsed.provider, "openai");
        assert_eq!(parsed.model, "gpt-4o");
        assert_eq!(parsed.base_url, "");
    }
}
