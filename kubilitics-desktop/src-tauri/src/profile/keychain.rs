//! UUID-keyed secret storage for profile API keys.
//!
//! Delegates to `secure_store` (encrypted file storage) instead of the OS
//! keychain. The macOS keychain binds item ACLs to the creating binary's
//! identity — every app update changes the binary hash and triggers the
//! "enter login password to allow access" dialog on the first read.
//! Since we read profile keys at every startup (to hot-wire the brain),
//! users were seeing this dialog moments after launch. The encrypted file
//! store is protected by OS filesystem permissions (0600) and never prompts.

use super::ProfileError;
use uuid::Uuid;

const SERVICE: &str = "kubilitics-ai";

pub fn set_key(id: Uuid, secret: &str) -> Result<(), ProfileError> {
    crate::secure_store::set_secret(SERVICE, &id.to_string(), secret)
        .map_err(ProfileError::Keychain)
}

pub fn get_key(id: Uuid) -> Result<Option<String>, ProfileError> {
    crate::secure_store::get_secret(SERVICE, &id.to_string())
        .map_err(ProfileError::Keychain)
}

pub fn delete_key(id: Uuid) -> Result<(), ProfileError> {
    crate::secure_store::delete_secret(SERVICE, &id.to_string())
        .map_err(ProfileError::Keychain)
}

/// Probe presence without exposing the secret.
pub fn has_key(id: Uuid) -> bool {
    matches!(get_key(id), Ok(Some(_)))
}
