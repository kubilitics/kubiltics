//! Encrypted local file storage for API keys and secrets.
//!
//! Replaces OS keychain (keyring crate) to avoid macOS Keychain ACL prompts.
//! macOS binds keychain item ACLs to the creating binary's identity — every
//! app update changes the binary hash, triggering "enter password to allow
//! access" on the FIRST read by the new version. For secrets the app reads
//! at startup (profile API keys for brain hot-wiring), this appears as an
//! unprompted password dialog moments after launch.
//!
//! Security model:
//!   - A 32-byte random key is generated on first use and written to
//!     ~/.config/kubilitics/.keyfile with mode 0600.
//!   - Secrets are stored encrypted in ~/.config/kubilitics/secrets.json
//!     using AES-256-GCM with a random nonce per entry.
//!   - Protection is filesystem-level: only the current user can read both
//!     files. Equivalent to a macOS keychain item with "allow all
//!     applications" access control.
//!
//! Trade-off: unlike a keychain item with per-app ACL, other processes
//! running as the same user CAN read the keyfile + encrypted store. This is
//! the same threat model as a macOS keychain item with unrestricted access,
//! which is what we effectively had after losing the per-app ACL on every
//! update anyway.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};

fn config_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or("no config dir")?;
    let dir = base.join("kubilitics");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    Ok(dir)
}

fn keyfile_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join(".keyfile"))
}

fn secrets_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("secrets.json"))
}

fn load_or_create_key() -> Result<[u8; 32], String> {
    let path = keyfile_path()?;
    if path.exists() {
        let bytes = fs::read(&path).map_err(|e| format!("read keyfile: {e}"))?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
        // Corrupt keyfile — regenerate. Any existing secrets become unreadable
        // (decryption will fail and return None), which is acceptable.
    }
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(&path, &key).map_err(|e| format!("write keyfile: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

#[derive(Serialize, Deserialize, Default)]
struct SecretsStore {
    // key = "service/account", value = base64(12-byte nonce || ciphertext)
    entries: HashMap<String, String>,
}

fn entry_key(service: &str, account: &str) -> String {
    format!("{service}/{account}")
}

fn read_store() -> Result<SecretsStore, String> {
    let path = secrets_path()?;
    if !path.exists() {
        return Ok(SecretsStore::default());
    }
    let s = fs::read_to_string(&path).map_err(|e| format!("read secrets: {e}"))?;
    serde_json::from_str(&s).map_err(|e| format!("parse secrets: {e}"))
}

fn write_store(store: &SecretsStore) -> Result<(), String> {
    let path = secrets_path()?;
    let s = serde_json::to_string(store).map_err(|e| format!("serialize secrets: {e}"))?;
    fs::write(&path, &s).map_err(|e| format!("write secrets: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn set_secret(service: &str, account: &str, secret: &str) -> Result<(), String> {
    let key_bytes = load_or_create_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, secret.as_bytes())
        .map_err(|e| format!("encrypt: {e}"))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    let encoded = STANDARD.encode(&combined);
    let mut store = read_store()?;
    store.entries.insert(entry_key(service, account), encoded);
    write_store(&store)
}

pub fn get_secret(service: &str, account: &str) -> Result<Option<String>, String> {
    let store = read_store()?;
    let encoded = match store.entries.get(&entry_key(service, account)) {
        Some(e) => e.clone(),
        None => return Ok(None),
    };
    let combined = STANDARD
        .decode(&encoded)
        .map_err(|e| format!("base64 decode: {e}"))?;
    if combined.len() < 12 {
        return Ok(None); // corrupt entry — treat as absent
    }
    let key_bytes = load_or_create_key()?;
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&combined[..12]);
    match cipher.decrypt(nonce, &combined[12..]) {
        Ok(plaintext) => String::from_utf8(plaintext)
            .map(Some)
            .map_err(|e| format!("utf8: {e}")),
        Err(_) => Ok(None), // wrong key or tampered — treat as absent
    }
}

pub fn delete_secret(service: &str, account: &str) -> Result<(), String> {
    let mut store = read_store()?;
    store.entries.remove(&entry_key(service, account));
    write_store(&store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use tempfile::TempDir;

    fn with_temp_config<F: FnOnce()>(f: F) {
        // Redirect config dir to a temp directory for isolation.
        // dirs::config_dir() reads $XDG_CONFIG_HOME on Linux and
        // $HOME/Library/Application Support on macOS. We override HOME
        // and XDG_CONFIG_HOME so config_dir() lands in the temp dir.
        let tmp = TempDir::new().unwrap();
        let original_home = env::var("HOME").ok();
        let original_xdg = env::var("XDG_CONFIG_HOME").ok();
        unsafe {
            env::set_var("HOME", tmp.path());
            // On macOS dirs::config_dir() uses $HOME/Library/Application Support.
            // On Linux it uses $XDG_CONFIG_HOME or $HOME/.config.
            env::set_var("XDG_CONFIG_HOME", tmp.path().join("config"));
        }
        f();
        unsafe {
            match original_home {
                Some(v) => env::set_var("HOME", v),
                None => env::remove_var("HOME"),
            }
            match original_xdg {
                Some(v) => env::set_var("XDG_CONFIG_HOME", v),
                None => env::remove_var("XDG_CONFIG_HOME"),
            }
        }
        drop(tmp);
    }

    #[test]
    #[serial_test::serial(secure_store_env)]
    fn round_trip() {
        with_temp_config(|| {
            set_secret("svc", "acc", "hello-world").unwrap();
            let got = get_secret("svc", "acc").unwrap();
            assert_eq!(got.as_deref(), Some("hello-world"));
        });
    }

    #[test]
    #[serial_test::serial(secure_store_env)]
    fn absent_returns_none() {
        with_temp_config(|| {
            let got = get_secret("svc", "missing").unwrap();
            assert!(got.is_none());
        });
    }

    #[test]
    #[serial_test::serial(secure_store_env)]
    fn overwrite_and_delete() {
        with_temp_config(|| {
            set_secret("svc", "acc", "first").unwrap();
            set_secret("svc", "acc", "second").unwrap();
            assert_eq!(get_secret("svc", "acc").unwrap().as_deref(), Some("second"));
            delete_secret("svc", "acc").unwrap();
            assert!(get_secret("svc", "acc").unwrap().is_none());
        });
    }

    #[test]
    #[serial_test::serial(secure_store_env)]
    fn multiple_namespaces_isolated() {
        with_temp_config(|| {
            set_secret("ns1", "key", "val1").unwrap();
            set_secret("ns2", "key", "val2").unwrap();
            assert_eq!(get_secret("ns1", "key").unwrap().as_deref(), Some("val1"));
            assert_eq!(get_secret("ns2", "key").unwrap().as_deref(), Some("val2"));
        });
    }
}
