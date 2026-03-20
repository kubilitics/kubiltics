-- T8.11: Webhook Notification Channels.
-- Each row represents a configured endpoint (Slack or generic webhook)
-- that receives JSON events for selected addon lifecycle events.

CREATE TABLE IF NOT EXISTS notification_channels (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'webhook',  -- 'slack' | 'webhook'
    url        TEXT NOT NULL,
    -- JSON array of event names the channel subscribes to.
    -- Example: '["install","upgrade","uninstall","failed"]'
    events     TEXT NOT NULL DEFAULT '["install","upgrade","uninstall","failed"]',
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_type ON notification_channels(type);
