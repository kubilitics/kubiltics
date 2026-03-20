-- BE-AUTH-002: Password policy, rate limiting, account lockout, auth event logging.

-- Add failed login tracking to users table
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_failed_login TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_locked ON users(locked_until);

-- Auth events table for audit trail
CREATE TABLE IF NOT EXISTS auth_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failure', 'logout', 'password_change', 'account_locked', 'account_unlocked')),
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details TEXT, -- JSON for additional context (e.g. lockout reason)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_events_type ON auth_events(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_events_timestamp ON auth_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_ip ON auth_events(ip_address);
