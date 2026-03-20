-- 001_investigations.sql
-- Investigation persistence for kubilitics-ai reasoning engine

CREATE TABLE IF NOT EXISTS investigations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    state TEXT NOT NULL,
    description TEXT NOT NULL,
    context TEXT,
    conclusion TEXT,
    confidence INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    concluded_at TIMESTAMP,
    metadata TEXT -- JSON-encoded metadata
);

CREATE INDEX IF NOT EXISTS idx_investigations_state ON investigations(state);
CREATE INDEX IF NOT EXISTS idx_investigations_created_at ON investigations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_type ON investigations(type);

CREATE TABLE IF NOT EXISTS investigation_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL,
    statement TEXT NOT NULL,
    evidence TEXT,
    confidence INTEGER DEFAULT 70,
    severity TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_findings_investigation_id ON investigation_findings(investigation_id);

CREATE TABLE IF NOT EXISTS investigation_tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args TEXT, -- JSON-encoded arguments
    result TEXT,
    turn_index INTEGER NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_investigation_id ON investigation_tool_calls(investigation_id);

CREATE TABLE IF NOT EXISTS investigation_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investigation_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    description TEXT NOT NULL,
    result TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_steps_investigation_id ON investigation_steps(investigation_id);
