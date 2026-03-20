-- Add key_prefix column for O(1) API key lookup (replaces O(n) full-table bcrypt scan).
-- key_prefix stores first 8 hex chars of SHA-256(plaintext_key) — deterministic, non-secret.
-- Existing keys will have empty prefix and fall back to full-table scan until regenerated.
ALTER TABLE api_keys ADD COLUMN key_prefix TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
