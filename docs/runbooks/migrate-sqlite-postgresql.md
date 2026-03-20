# Runbook: Migrate SQLite to PostgreSQL

**Audience:** Platform operators, database administrators
**Last updated:** 2026-03-16
**Applies to:** Kubilitics v0.1.1+

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Pre-Migration Checklist](#3-pre-migration-checklist)
4. [Export Data from SQLite](#4-export-data-from-sqlite)
5. [Prepare PostgreSQL](#5-prepare-postgresql)
6. [Import Data to PostgreSQL](#6-import-data-to-postgresql)
7. [Update Kubilitics Configuration](#7-update-kubilitics-configuration)
8. [Verify Migration](#8-verify-migration)
9. [Rollback Procedure](#9-rollback-procedure)

---

## 1. Overview

Kubilitics defaults to SQLite for simplicity and zero-dependency deployment. For production environments requiring high availability, concurrent access, or multi-replica backend deployments, PostgreSQL is the recommended database.

The Helm chart supports PostgreSQL natively via a Bitnami subchart dependency (`postgresql 17.1.0`). The backend detects the database type from the `KUBILITICS_DATABASE_TYPE` environment variable and uses the appropriate driver.

**Migration scope:** This procedure migrates all Kubilitics data including:
- Cluster registrations
- Add-on install records and audit logs
- User accounts and sessions
- Configuration and settings

---

## 2. Prerequisites

| Requirement | Details |
|---|---|
| PostgreSQL instance | Version 14+ (Bitnami subchart provides 17.x) |
| `sqlite3` CLI | Available on the backup pod or locally |
| `psql` CLI | PostgreSQL client tools (`postgresql-client` package) |
| Backup of current SQLite database | See [backup-restore.md](backup-restore.md) |
| Maintenance window | ~15-30 min downtime depending on data volume |
| Helm 3.x | For chart upgrade |

---

## 3. Pre-Migration Checklist

- [ ] **Back up the SQLite database** -- Follow [backup-restore.md](backup-restore.md) Section 2
- [ ] **Record current state** -- Note cluster count, add-on count, user count for post-migration verification
- [ ] **Notify users** -- Schedule maintenance window; active WebSocket connections will drop
- [ ] **Test in staging first** -- Run this procedure in a non-production environment before production

### Record baseline counts

```bash
NAMESPACE="kubilitics"
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "$NAMESPACE" "$POD" -c backend -- \
  sqlite3 /data/kubilitics.db <<'SQL'
SELECT 'clusters' AS table_name, COUNT(*) AS row_count FROM clusters
UNION ALL
SELECT 'addon_installs', COUNT(*) FROM addon_installs
UNION ALL
SELECT 'audit_events', COUNT(*) FROM audit_events
UNION ALL
SELECT 'users', COUNT(*) FROM users;
SQL
```

Save this output for verification in Step 8.

---

## 4. Export Data from SQLite

### Step 1 -- Stop the backend to prevent writes

```bash
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=0
kubectl rollout status deployment kubilitics -n "$NAMESPACE"
```

### Step 2 -- Checkpoint and copy the database

```bash
# If the pod is already stopped, use a temporary pod
kubectl run sqlite-export --rm -it \
  --image=alpine/sqlite:latest \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "export",
        "image": "alpine/sqlite:latest",
        "command": ["sh"],
        "stdin": true,
        "tty": true,
        "volumeMounts": [{
          "name": "data",
          "mountPath": "/data"
        }]
      }],
      "volumes": [{
        "name": "data",
        "persistentVolumeClaim": {
          "claimName": "kubilitics-pvc"
        }
      }]
    }
  }' \
  -n "$NAMESPACE" -- sh
```

Inside the pod:

```sh
# Checkpoint WAL
sqlite3 /data/kubilitics.db "PRAGMA wal_checkpoint(TRUNCATE);"

# Export schema (for reference -- the backend auto-migrates on startup)
sqlite3 /data/kubilitics.db ".schema" > /tmp/schema.sql

# Export data as INSERT statements
sqlite3 /data/kubilitics.db ".mode insert" ".dump" > /tmp/full-dump.sql

# Export individual tables as CSV for safer import
for table in clusters addon_installs audit_events users sessions settings; do
  sqlite3 -header -csv /data/kubilitics.db "SELECT * FROM $table;" > "/tmp/${table}.csv"
done

ls -la /tmp/*.sql /tmp/*.csv
```

### Step 3 -- Copy exports out of the pod

From another terminal:

```bash
for file in schema.sql full-dump.sql clusters.csv addon_installs.csv audit_events.csv users.csv sessions.csv settings.csv; do
  kubectl cp "$NAMESPACE/sqlite-export:/tmp/$file" "./$file" 2>/dev/null || true
done
```

---

## 5. Prepare PostgreSQL

### Option A: Use the Bitnami subchart (recommended)

Enable PostgreSQL in your Helm values:

```yaml
# values-postgresql.yaml
database:
  type: "postgresql"
  postgresql:
    host: ""          # Auto-set from subchart
    port: 5432
    database: ""      # Auto-set from subchart
    username: ""      # Auto-set from subchart
    sslMode: "require"

# Enable the Bitnami PostgreSQL subchart
postgresql:
  enabled: true
  auth:
    username: "kubilitics"
    password: ""       # Will be auto-generated if empty
    database: "kubilitics"
  primary:
    persistence:
      enabled: true
      size: 10Gi
    resources:
      requests:
        cpu: 250m
        memory: 256Mi
      limits:
        cpu: 1000m
        memory: 1Gi
```

Install PostgreSQL first (without starting the backend):

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n "$NAMESPACE" \
  -f values-postgresql.yaml \
  --set replicaCount=0
```

Wait for PostgreSQL to be ready:

```bash
kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=postgresql
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=postgresql \
  -n "$NAMESPACE" --timeout=300s
```

### Option B: External PostgreSQL

If using an external PostgreSQL instance (RDS, Cloud SQL, etc.):

```bash
# Create the database
PGPASSWORD="$PG_ADMIN_PASS" psql -h "$PG_HOST" -U postgres -c \
  "CREATE DATABASE kubilitics;"
PGPASSWORD="$PG_ADMIN_PASS" psql -h "$PG_HOST" -U postgres -c \
  "CREATE USER kubilitics WITH PASSWORD '$PG_PASS';"
PGPASSWORD="$PG_ADMIN_PASS" psql -h "$PG_HOST" -U postgres -c \
  "GRANT ALL PRIVILEGES ON DATABASE kubilitics TO kubilitics;"
PGPASSWORD="$PG_ADMIN_PASS" psql -h "$PG_HOST" -U postgres -d kubilitics -c \
  "GRANT ALL ON SCHEMA public TO kubilitics;"
```

Create the Kubernetes Secret:

```bash
kubectl create secret generic kubilitics-postgresql -n "$NAMESPACE" \
  --from-literal=postgresql-host="$PG_HOST" \
  --from-literal=postgresql-port="5432" \
  --from-literal=postgresql-database="kubilitics" \
  --from-literal=postgresql-username="kubilitics" \
  --from-literal=postgres-password="$PG_PASS" \
  --from-literal=postgresql-ssl-mode="require"
```

---

## 6. Import Data to PostgreSQL

### Step 1 -- Let the backend create the schema

Start the backend briefly with PostgreSQL configured so it runs its auto-migration:

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n "$NAMESPACE" \
  -f values-postgresql.yaml \
  --set replicaCount=1

# Wait for the pod to be ready (schema migration runs on startup)
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=kubilitics \
  -n "$NAMESPACE" --timeout=120s

# Check logs for successful migration
kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -c backend | grep -i "migrat"
```

Scale down again for data import:

```bash
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=0
```

### Step 2 -- Get PostgreSQL connection details

```bash
PG_HOST=$(kubectl get secret kubilitics-postgresql -n "$NAMESPACE" -o jsonpath='{.data.postgresql-host}' | base64 -d)
PG_PORT=$(kubectl get secret kubilitics-postgresql -n "$NAMESPACE" -o jsonpath='{.data.postgresql-port}' | base64 -d)
PG_USER=$(kubectl get secret kubilitics-postgresql -n "$NAMESPACE" -o jsonpath='{.data.postgresql-username}' | base64 -d)
PG_PASS=$(kubectl get secret kubilitics-postgresql -n "$NAMESPACE" -o jsonpath='{.data.postgres-password}' | base64 -d)
PG_DB=$(kubectl get secret kubilitics-postgresql -n "$NAMESPACE" -o jsonpath='{.data.postgresql-database}' | base64 -d)

# For subchart PostgreSQL, use port-forward
kubectl port-forward svc/kubilitics-postgresql -n "$NAMESPACE" 5432:5432 &
PG_CONNECT_HOST="localhost"
```

### Step 3 -- Import data using CSV files

CSV import is the safest approach because it avoids SQL syntax differences between SQLite and PostgreSQL.

```bash
# Import each table
for table in clusters addon_installs audit_events users sessions settings; do
  if [ -f "${table}.csv" ] && [ -s "${table}.csv" ]; then
    echo "Importing $table..."

    # Get column names from CSV header
    COLUMNS=$(head -1 "${table}.csv")

    PGPASSWORD="$PG_PASS" psql \
      -h "$PG_CONNECT_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
      -c "\\COPY $table($COLUMNS) FROM '${table}.csv' WITH (FORMAT csv, HEADER true)"

    echo "$table imported."
  fi
done
```

### Step 4 -- Fix sequences

PostgreSQL sequences (auto-increment counters) need to be reset after a bulk import:

```bash
PGPASSWORD="$PG_PASS" psql \
  -h "$PG_CONNECT_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" <<'SQL'
-- Reset all sequences to max(id) + 1
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name, kcu.column_name, pg_get_serial_sequence(tc.table_name, kcu.column_name) AS seq
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND pg_get_serial_sequence(tc.table_name, kcu.column_name) IS NOT NULL
  LOOP
    EXECUTE format('SELECT setval(%L, COALESCE(MAX(%I), 0) + 1, false) FROM %I',
                   r.seq, r.column_name, r.table_name);
  END LOOP;
END $$;
SQL
```

Kill the port-forward:

```bash
kill %1 2>/dev/null
```

---

## 7. Update Kubilitics Configuration

### Deploy with PostgreSQL configuration

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n "$NAMESPACE" \
  -f values-postgresql.yaml \
  --set replicaCount=1
```

Or if using an external PostgreSQL with a connection string:

```yaml
database:
  type: "postgresql"
  postgresql:
    connectionString: "postgresql://kubilitics:password@pg-host:5432/kubilitics?sslmode=require"
```

### Wait for the backend to start

```bash
kubectl rollout status deployment kubilitics -n "$NAMESPACE" --timeout=120s
```

---

## 8. Verify Migration

### 8.1 Health check

```bash
curl -s https://kubilitics.example.com/health | jq .
# Should show {"status":"ok"} with database type "postgresql"
```

### 8.2 Row count comparison

```bash
kubectl port-forward svc/kubilitics-postgresql -n "$NAMESPACE" 5432:5432 &

PGPASSWORD="$PG_PASS" psql \
  -h localhost -p 5432 -U "$PG_USER" -d "$PG_DB" <<'SQL'
SELECT 'clusters' AS table_name, COUNT(*) AS row_count FROM clusters
UNION ALL
SELECT 'addon_installs', COUNT(*) FROM addon_installs
UNION ALL
SELECT 'audit_events', COUNT(*) FROM audit_events
UNION ALL
SELECT 'users', COUNT(*) FROM users
ORDER BY table_name;
SQL

kill %1
```

Compare these counts with the baseline recorded in Step 3.

### 8.3 API verification

```bash
TOKEN="<your-jwt-token>"

# List clusters
curl -s -H "Authorization: Bearer $TOKEN" \
  https://kubilitics.example.com/clusters | jq '. | length'

# Check add-on status for each cluster
curl -s -H "Authorization: Bearer $TOKEN" \
  https://kubilitics.example.com/clusters/<cluster-id>/addons/installed | jq '.[].status'
```

### 8.4 Functional tests

- [ ] Login with existing credentials works
- [ ] Cluster topology loads
- [ ] Add-on catalog is accessible
- [ ] WebSocket streams connect and show live data
- [ ] New add-on installation succeeds

---

## 9. Rollback Procedure

If the migration fails or data is corrupted, revert to SQLite.

### Step 1 -- Scale down

```bash
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=0
```

### Step 2 -- Revert Helm values to SQLite

```yaml
# values-rollback.yaml
database:
  type: "sqlite"
  sqlite:
    path: "/data/kubilitics.db"
```

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n "$NAMESPACE" \
  -f values-rollback.yaml \
  --set replicaCount=0
```

### Step 3 -- Restore the SQLite backup

Follow [backup-restore.md](backup-restore.md) Section 4 to restore from the pre-migration backup.

### Step 4 -- Start the backend

```bash
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=1
kubectl rollout status deployment kubilitics -n "$NAMESPACE"
```

### Step 5 -- Verify rollback

```bash
curl -s https://kubilitics.example.com/health | jq .
```

### Step 6 -- Clean up PostgreSQL (optional)

If you no longer need the PostgreSQL instance:

```bash
# Disable PostgreSQL subchart
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n "$NAMESPACE" \
  -f values-rollback.yaml \
  --set postgresql.enabled=false

# Delete the PostgreSQL PVC if no longer needed
kubectl delete pvc data-kubilitics-postgresql-0 -n "$NAMESPACE"
```

---

## Migration Checklist

- [ ] Pre-migration SQLite backup completed and verified
- [ ] Baseline row counts recorded
- [ ] Users notified of maintenance window
- [ ] PostgreSQL instance provisioned and accessible
- [ ] Backend scaled to 0
- [ ] Data exported from SQLite
- [ ] Schema auto-migrated by backend startup
- [ ] Data imported to PostgreSQL
- [ ] Sequences reset
- [ ] Backend restarted with PostgreSQL configuration
- [ ] Health check passes
- [ ] Row counts match baseline
- [ ] API endpoints return correct data
- [ ] Functional smoke tests pass
- [ ] SQLite backup retained for rollback (keep for at least 30 days)
