-- MFA TOTP secrets and backup codes
-- Supports Time-based One-Time Password (TOTP) authentication

CREATE TABLE IF NOT EXISTS mfa_totp_secrets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL, -- Encrypted TOTP secret
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP, -- When MFA was verified during setup
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mfa_totp_secrets_user_id ON mfa_totp_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_totp_secrets_enabled ON mfa_totp_secrets(enabled);

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL, -- Hashed backup code (bcrypt)
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user_id ON mfa_backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_used ON mfa_backup_codes(used);
