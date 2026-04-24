-- 003_policies.sql
-- Custom safety policy persistence for kubilitics-ai

CREATE TABLE IF NOT EXISTS custom_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    condition TEXT NOT NULL, -- JSON-encoded condition (resource_type, namespace, operation, etc.)
    effect TEXT NOT NULL CHECK(effect IN ('ALLOW', 'DENY', 'REQUEST_APPROVAL')),
    reason TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 100, -- Higher priority = evaluated first
    created_by TEXT DEFAULT 'admin',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_policies_enabled ON custom_policies(enabled, priority DESC);
CREATE INDEX IF NOT EXISTS idx_policies_name ON custom_policies(name);

CREATE TABLE IF NOT EXISTS policy_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    policy_id INTEGER NOT NULL,
    investigation_id TEXT,
    action TEXT NOT NULL, -- JSON-encoded action
    result TEXT NOT NULL CHECK(result IN ('ALLOW', 'DENY', 'REQUEST_APPROVAL')),
    reason TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_id) REFERENCES custom_policies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_policy_evaluations_policy_id ON policy_evaluations(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_evaluations_investigation_id ON policy_evaluations(investigation_id);
CREATE INDEX IF NOT EXISTS idx_policy_evaluations_timestamp ON policy_evaluations(timestamp DESC);

-- Insert example custom policies
INSERT OR IGNORE INTO custom_policies (name, description, condition, effect, reason, priority)
VALUES 
    ('block-production-deletion', 
     'Prevent deletion of resources in production namespace',
     '{"namespace": "production", "operation": "delete"}',
     'DENY',
     'Production resources require manual approval for deletion',
     1000),
    
    ('require-approval-scaling',
     'Require approval for scaling deployments beyond 10 replicas',
     '{"resource_type": "deployment", "operation": "scale", "min_replicas": 10}',
     'REQUEST_APPROVAL',
     'Large-scale operations require human review',
     500);
