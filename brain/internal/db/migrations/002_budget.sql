-- 002_budget.sql
-- Budget tracking persistence for kubilitics-ai

CREATE TABLE IF NOT EXISTS budget_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    month TEXT NOT NULL, -- Format: YYYY-MM
    provider TEXT NOT NULL, -- openai, anthropic, ollama, custom
    model TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    request_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, month, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_budget_usage_user_month ON budget_usage(user_id, month);
CREATE INDEX IF NOT EXISTS idx_budget_usage_month ON budget_usage(month DESC);

CREATE TABLE IF NOT EXISTS budget_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    monthly_limit_usd REAL NOT NULL DEFAULT 100.0,
    per_investigation_limit_tokens INTEGER NOT NULL DEFAULT 1000000,
    warning_threshold REAL NOT NULL DEFAULT 0.8, -- 80%
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_limits_user ON budget_limits(user_id);

-- Insert default budget limits
INSERT OR IGNORE INTO budget_limits (user_id, monthly_limit_usd, per_investigation_limit_tokens, warning_threshold)
VALUES ('default', 100.0, 1000000, 0.8);

CREATE TABLE IF NOT EXISTS budget_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    month TEXT NOT NULL,
    alert_type TEXT NOT NULL, -- warning, limit_reached
    threshold REAL NOT NULL,
    current_usage REAL NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_budget_alerts_user_month ON budget_alerts(user_id, month DESC);
