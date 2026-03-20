CREATE TABLE IF NOT EXISTS addon_audit_events (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    addon_install_id TEXT REFERENCES cluster_addon_installs(id) ON DELETE SET NULL,
    addon_id TEXT NOT NULL,
    release_name TEXT NOT NULL,
    actor TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('INSTALL','UPGRADE','ROLLBACK','UNINSTALL','POLICY_CHANGE','DRIFT_DETECTED','HEALTH_CHANGE')),
    old_version TEXT,
    new_version TEXT,
    values_hash TEXT,
    result TEXT NOT NULL CHECK (result IN ('SUCCESS','FAILURE','IN_PROGRESS')),
    error_message TEXT,
    duration_ms INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_cluster ON addon_audit_events(cluster_id);
CREATE INDEX IF NOT EXISTS idx_audit_install ON addon_audit_events(addon_install_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON addon_audit_events(created_at);

CREATE TRIGGER IF NOT EXISTS trg_addon_audit_events_guard_update
BEFORE UPDATE ON addon_audit_events
WHEN
    NEW.id IS NOT OLD.id OR
    NEW.cluster_id IS NOT OLD.cluster_id OR
    NOT (
        (NEW.addon_install_id IS OLD.addon_install_id) OR
        (OLD.addon_install_id IS NOT NULL AND NEW.addon_install_id IS NULL)
    ) OR
    NEW.addon_id IS NOT OLD.addon_id OR
    NEW.release_name IS NOT OLD.release_name OR
    NEW.actor IS NOT OLD.actor OR
    NEW.operation IS NOT OLD.operation OR
    NEW.old_version IS NOT OLD.old_version OR
    NEW.new_version IS NOT OLD.new_version OR
    NEW.values_hash IS NOT OLD.values_hash OR
    NEW.result IS NOT OLD.result OR
    NEW.error_message IS NOT OLD.error_message OR
    NEW.duration_ms IS NOT OLD.duration_ms OR
    NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'addon_audit_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_addon_audit_events_no_delete
BEFORE DELETE ON addon_audit_events
BEGIN
    SELECT RAISE(ABORT, 'addon_audit_events is append-only');
END;
