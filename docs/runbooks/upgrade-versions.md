# Runbook: Upgrade Between Versions

**Audience:** Platform operators, cluster administrators
**Last updated:** 2026-03-16
**Applies to:** Kubilitics v0.1.1+

---

## Table of Contents

1. [Overview](#1-overview)
2. [Pre-Upgrade Checklist](#2-pre-upgrade-checklist)
3. [Helm Upgrade Procedure](#3-helm-upgrade-procedure)
4. [Database Migration Verification](#4-database-migration-verification)
5. [Post-Upgrade Validation](#5-post-upgrade-validation)
6. [Rollback Procedure](#6-rollback-procedure)
7. [Version-Specific Notes](#7-version-specific-notes)

---

## 1. Overview

Kubilitics is deployed via Helm chart at `deploy/helm/kubilitics/`. Upgrades follow the standard Helm upgrade flow with additional checks for database migrations. The backend runs schema migrations automatically on startup, so no manual migration step is needed in most cases.

**Upgrade path:** Kubilitics supports sequential minor version upgrades (e.g., 0.1.x to 0.2.x). Skipping minor versions is not supported -- upgrade through each minor version in sequence.

**Downtime expectations:**
- **Patch upgrades** (0.1.0 to 0.1.1): Rolling update, zero downtime with `replicaCount >= 2`
- **Minor upgrades** (0.1.x to 0.2.x): Brief downtime during database migration (typically < 30 seconds)
- **Major upgrades** (0.x to 1.x): Planned maintenance window required

---

## 2. Pre-Upgrade Checklist

### 2.1 Read the release notes

```bash
# Check the CHANGELOG for breaking changes
curl -s https://raw.githubusercontent.com/kubilitics/kubiltics/main/CHANGELOG.md | head -100

# Or view the GitHub Release page
# https://github.com/kubilitics/kubiltics/releases
```

### 2.2 Verify current state

```bash
NAMESPACE="kubilitics"

# Current Helm release version
helm list -n "$NAMESPACE"

# Current running image
kubectl get deployment kubilitics -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Health check
curl -s https://kubilitics.example.com/health | jq .

# Check for any failed add-on installs that should be resolved first
TOKEN="<your-jwt-token>"
curl -s -H "Authorization: Bearer $TOKEN" \
  https://kubilitics.example.com/clusters | jq '.[].id' | while read -r cid; do
    curl -s -H "Authorization: Bearer $TOKEN" \
      "https://kubilitics.example.com/clusters/$(echo $cid | tr -d '"')/addons/installed" | \
      jq '.[] | select(.status == "failed" or .status == "installing")'
  done
```

### 2.3 Back up the database

**This is mandatory.** Follow [backup-restore.md](backup-restore.md).

```bash
# Quick SQLite backup
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NAMESPACE" "$POD" -c backend -- \
  sqlite3 /data/kubilitics.db "PRAGMA wal_checkpoint(TRUNCATE);"
kubectl exec -n "$NAMESPACE" "$POD" -c backend -- \
  sqlite3 /data/kubilitics.db ".backup '/tmp/pre-upgrade-backup.db'"
kubectl cp "$NAMESPACE/$POD:/tmp/pre-upgrade-backup.db" \
  "./kubilitics-pre-upgrade-$(date +%Y%m%d).db" -c backend
```

For PostgreSQL:

```bash
PGPASSWORD="$PG_PASS" pg_dump -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" \
  --format=custom --file="kubilitics-pre-upgrade-$(date +%Y%m%d).pgdump"
```

### 2.4 Verify backup integrity

```bash
sqlite3 "kubilitics-pre-upgrade-$(date +%Y%m%d).db" "PRAGMA integrity_check;"
# Must return "ok"
```

### 2.5 Check Helm chart compatibility

```bash
TARGET_VERSION="0.2.0"

# Compare values between versions
helm show values deploy/helm/kubilitics/ > new-defaults.yaml
diff <(helm get values kubilitics -n "$NAMESPACE" --all) new-defaults.yaml
```

### 2.6 Check cluster resources

```bash
# Ensure enough resources for rolling update (briefly runs 2x pods)
kubectl describe nodes | grep -A5 "Allocated resources"
```

---

## 3. Helm Upgrade Procedure

### 3.1 Update the chart

If using the chart from the repository:

```bash
# Pull the latest chart
helm repo update kubilitics
helm search repo kubilitics --versions
```

If using the chart from the git repository:

```bash
cd /path/to/kubilitics-os-emergent
git fetch origin
git checkout "v${TARGET_VERSION}"
```

### 3.2 Dry run

Always dry-run first to see what will change:

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n "$NAMESPACE" \
  -f values-production.yaml \
  --set image.tag="$TARGET_VERSION" \
  --dry-run --debug 2>&1 | head -200
```

Review the output for:
- New environment variables
- Changed resource limits
- New volumes or volume mounts
- CRD changes

### 3.3 Execute the upgrade

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n "$NAMESPACE" \
  -f values-production.yaml \
  --set image.tag="$TARGET_VERSION" \
  --timeout 10m \
  --wait \
  --atomic
```

The `--atomic` flag automatically rolls back if the upgrade fails.

### 3.4 Monitor the rollout

```bash
# Watch the rollout
kubectl rollout status deployment kubilitics -n "$NAMESPACE" --timeout=300s

# Watch pod transitions
kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -w
```

---

## 4. Database Migration Verification

The backend runs schema migrations automatically on startup. Check the logs to confirm:

```bash
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')

# Check for migration log entries
kubectl logs -n "$NAMESPACE" "$POD" -c backend | grep -i "migrat"
```

Expected output (example):

```
INFO  Running database migrations...
INFO  Migration 001_initial applied successfully
INFO  Migration 002_addon_audit applied successfully
INFO  Database migration complete (current version: 5)
```

If migrations fail, the pod will crash-loop. Check the logs:

```bash
kubectl logs -n "$NAMESPACE" "$POD" -c backend --previous | grep -i "error\|migrat\|fatal"
```

---

## 5. Post-Upgrade Validation

### 5.1 Health check

```bash
curl -s https://kubilitics.example.com/health | jq .
# Verify version matches TARGET_VERSION
```

### 5.2 API smoke tests

```bash
TOKEN="<your-jwt-token>"

# List clusters
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  https://kubilitics.example.com/clusters
# Expected: 200

# Check topology for a cluster
CLUSTER_ID="<your-cluster-id>"
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "https://kubilitics.example.com/clusters/$CLUSTER_ID/topology"
# Expected: 200

# Check add-on catalog
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "https://kubilitics.example.com/clusters/$CLUSTER_ID/addons/catalog"
# Expected: 200
```

### 5.3 WebSocket connectivity

Verify the WebSocket overview stream still works:

```bash
# Using wscat
wscat -c "wss://kubilitics.example.com/clusters/$CLUSTER_ID/overview/stream?token=$TOKEN" --no-check
# Should receive JSON messages with cluster overview data
```

### 5.4 Frontend verification

- [ ] Login page loads
- [ ] Dashboard renders cluster topology
- [ ] Add-on marketplace is accessible
- [ ] Real-time data updates via WebSocket

### 5.5 Confirm Helm release

```bash
helm list -n "$NAMESPACE"
# REVISION should be incremented
# STATUS should be "deployed"
# APP VERSION should match TARGET_VERSION

helm history kubilitics -n "$NAMESPACE" | tail -5
```

---

## 6. Rollback Procedure

### 6.1 Automatic rollback (if --atomic was used)

If you used `--atomic` in the upgrade command, Helm automatically rolls back on failure. Check the history:

```bash
helm history kubilitics -n "$NAMESPACE"
```

### 6.2 Manual Helm rollback

```bash
# List revisions
helm history kubilitics -n "$NAMESPACE"

# Rollback to the previous revision
PREVIOUS_REVISION=$(helm history kubilitics -n "$NAMESPACE" -o json | \
  jq '.[- 2].revision')
helm rollback kubilitics "$PREVIOUS_REVISION" -n "$NAMESPACE" --timeout 10m --wait

# Verify
kubectl rollout status deployment kubilitics -n "$NAMESPACE"
curl -s https://kubilitics.example.com/health | jq .
```

### 6.3 Database rollback

If the new version applied database migrations that are incompatible with the old version:

#### SQLite

```bash
# Scale down
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=0

# Restore pre-upgrade backup (see backup-restore.md Section 4)
# ... restore kubilitics-pre-upgrade-YYYYMMDD.db to /data/kubilitics.db ...

# Scale up with the old image
helm rollback kubilitics "$PREVIOUS_REVISION" -n "$NAMESPACE" --wait
```

#### PostgreSQL

```bash
# Scale down
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=0

# Restore from pre-upgrade pg_dump
PGPASSWORD="$PG_PASS" pg_restore \
  -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" \
  --clean --if-exists \
  "kubilitics-pre-upgrade-YYYYMMDD.pgdump"

# Rollback Helm release
helm rollback kubilitics "$PREVIOUS_REVISION" -n "$NAMESPACE" --wait
```

### 6.4 Verify rollback

```bash
# Health check
curl -s https://kubilitics.example.com/health | jq .

# Version should show old version
kubectl get deployment kubilitics -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# Full API smoke tests (Section 5.2)
```

---

## 7. Version-Specific Notes

### v0.1.0 to v0.1.1

- **No breaking changes.** Patch release with bug fixes and security dependency bumps.
- Helm values are fully backward compatible.
- No database migrations.
- Updated dependencies: containerd v1.7.29, helm.sh/helm/v3 v3.18.5.

### Future: v0.x to v1.0.0

- **Breaking changes expected.** Review the CHANGELOG carefully.
- API endpoints may change (v1 prefix).
- Database schema changes may not be backward compatible.
- Maintenance window required.
- Back up both database and Helm values before upgrading.

---

## Upgrade Checklist

- [ ] Read release notes and CHANGELOG
- [ ] Verify current deployment is healthy
- [ ] Back up database (SQLite or PostgreSQL)
- [ ] Verify backup integrity
- [ ] Resolve any failed add-on installs
- [ ] Dry-run Helm upgrade
- [ ] Execute Helm upgrade with `--atomic`
- [ ] Verify database migrations completed
- [ ] Health check passes
- [ ] API smoke tests pass
- [ ] WebSocket connectivity verified
- [ ] Frontend renders correctly
- [ ] Helm history shows successful deployment
- [ ] Retain pre-upgrade backup for at least 7 days
