-- Token revocation and blacklist for enterprise security
-- Allows revoking tokens before expiry (e.g., on password change, account lock, user deletion)

CREATE TABLE IF NOT EXISTS token_blacklist (
    id TEXT PRIMARY KEY,
    token_id TEXT NOT NULL, -- JWT ID (JTI) from claims
    user_id TEXT NOT NULL,
    revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL, -- Token expiry time
    reason TEXT, -- Reason for revocation: password_change, account_lock, user_deletion, manual_revoke, etc.
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_token_id ON token_blacklist(token_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_user_id ON token_blacklist(user_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires_at ON token_blacklist(expires_at);

-- Refresh token families for rotation and reuse detection
CREATE TABLE IF NOT EXISTS refresh_token_families (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL, -- Family identifier (same for all tokens in a family)
    user_id TEXT NOT NULL,
    token_id TEXT NOT NULL, -- Current active token ID
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP, -- Set when family is revoked
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_families_family_id ON refresh_token_families(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_user_id ON refresh_token_families(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_token_id ON refresh_token_families(token_id);
