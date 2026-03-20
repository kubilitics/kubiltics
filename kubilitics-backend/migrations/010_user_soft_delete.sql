-- BE-FUNC-004: Add soft delete support for users

ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);
