//! UUID-keyed Keychain helpers. Each Profile's API key is stored under
//! a single keychain entry whose account name is the Profile UUID — no
//! provider-name collisions, no silent overwrites between profiles.
//!
//! Service name is fixed: "kubilitics-ai".

use super::ProfileError;
use uuid::Uuid;

const SERVICE: &str = "kubilitics-ai";

fn entry(id: Uuid) -> Result<keyring::Entry, ProfileError> {
    keyring::Entry::new(SERVICE, &id.to_string())
        .map_err(|e| ProfileError::Keychain(e.to_string()))
}

pub fn set_key(id: Uuid, secret: &str) -> Result<(), ProfileError> {
    entry(id)?
        .set_password(secret)
        .map_err(|e| ProfileError::Keychain(e.to_string()))
}

pub fn get_key(id: Uuid) -> Result<Option<String>, ProfileError> {
    match entry(id)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(ProfileError::Keychain(e.to_string())),
    }
}

pub fn delete_key(id: Uuid) -> Result<(), ProfileError> {
    match entry(id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(ProfileError::Keychain(e.to_string())),
    }
}

/// Probe presence without exposing the secret. Used to populate
/// Profile.has_key at journal-read time.
pub fn has_key(id: Uuid) -> bool {
    matches!(get_key(id), Ok(Some(_)))
}
