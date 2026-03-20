-- SAML session tracking for SSO
-- Tracks SAML sessions for logout (SLO) support

CREATE TABLE IF NOT EXISTS saml_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    saml_session_index TEXT NOT NULL, -- SAML SessionIndex from assertion
    idp_entity_id TEXT NOT NULL, -- IdP entity ID
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL, -- Session expiry time
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_user_id ON saml_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_session_index ON saml_sessions(saml_session_index);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_expires_at ON saml_sessions(expires_at);
