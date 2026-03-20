-- Security event detection and monitoring
-- Tracks brute force attempts, credential stuffing, account enumeration, and auto-locks accounts

CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL, -- brute_force, credential_stuffing, account_enumeration, suspicious_activity
    user_id TEXT,
    username TEXT,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    cluster_id TEXT,
    resource_type TEXT,
    resource_name TEXT,
    action TEXT,
    risk_score INTEGER NOT NULL DEFAULT 0, -- 0-100
    details TEXT, -- JSON details
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_risk_score ON security_events(risk_score);

-- IP-based rate limiting and tracking
CREATE TABLE IF NOT EXISTS ip_security_tracking (
    ip_address TEXT PRIMARY KEY,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    last_failed_login TIMESTAMP,
    account_enumeration_count INTEGER NOT NULL DEFAULT 0,
    last_enumeration_attempt TIMESTAMP,
    blocked_until TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ip_security_tracking_blocked ON ip_security_tracking(blocked_until);
