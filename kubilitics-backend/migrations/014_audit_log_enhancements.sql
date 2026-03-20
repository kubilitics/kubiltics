-- Enhanced audit logging fields (Phase 6: Audit & Compliance)
-- Adds session_id, device_info, geolocation, risk_score, correlation_id

ALTER TABLE audit_log ADD COLUMN session_id TEXT;
ALTER TABLE audit_log ADD COLUMN device_info TEXT;
ALTER TABLE audit_log ADD COLUMN geolocation TEXT; -- Country/City from IP (e.g., "US/New York")
ALTER TABLE audit_log ADD COLUMN risk_score INTEGER DEFAULT 0; -- 0-100, calculated security risk
ALTER TABLE audit_log ADD COLUMN correlation_id TEXT; -- Links related events

CREATE INDEX IF NOT EXISTS idx_audit_log_session_id ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation_id ON audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_risk_score ON audit_log(risk_score);
