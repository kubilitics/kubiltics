-- 052: Allow DELETE on addon_audit_events so cluster removal can cascade.
--
-- Context: 029 made addon_audit_events append-only — both UPDATE and DELETE
-- were blocked by triggers. That's correct for tamper-resistance on individual
-- rows, but when a cluster is removed from the app (kubeconfig edit / manual
-- unregister) SQLite cascades the DELETE and the trigger ABORTs the whole
-- transaction with "constraint failed: addon_audit_events is append-only".
--
-- Fix: keep the UPDATE guard (the real tamper-resistance) but drop the DELETE
-- guard. The FK ON DELETE CASCADE on clusters(id) then sweeps the rows as
-- intended. Audit history survives only while its cluster exists — which
-- matches user expectation when they remove a cluster.

DROP TRIGGER IF EXISTS trg_addon_audit_events_no_delete;
