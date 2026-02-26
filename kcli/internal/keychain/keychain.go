// Package keychain provides OS-level secret storage for kcli (P3-9).
// On macOS it uses the Keychain via security(1); on Linux it uses
// Secret Service via secret-tool(1). Other platforms report unavailable.
package keychain

// Service name used for all kcli entries.
const Service = "kcli"

// Set stores a secret in the system keychain. account is a unique label
// (e.g. "default.ai.api_key" for profile.default and key ai.api_key).
// If the keychain is unavailable, returns ErrUnavailable.
func Set(service, account, value string) error {
	return set(service, account, value)
}

// Get retrieves a secret from the system keychain. Returns empty string
// if the item is not found or keychain is unavailable.
func Get(service, account string) (string, error) {
	return get(service, account)
}

// Delete removes a secret from the system keychain. Idempotent.
func Delete(service, account string) error {
	return delete(service, account)
}

// Available reports whether the system keychain is usable (security on macOS,
// secret-tool on Linux).
func Available() bool {
	return available()
}
