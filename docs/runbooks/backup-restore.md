# Runbook: Backup and Restore Database

**Audience:** Platform operators, SREs
**Last updated:** 2026-03-16
**Applies to:** Kubilitics v0.1.1+

---

## Table of Contents

1. [Overview](#1-overview)
2. [SQLite Backup (Default)](#2-sqlite-backup-default)
3. [Automated Backups with Kubernetes CronJob](#3-automated-backups-with-kubernetes-cronjob)
4. [Restore Procedure (SQLite)](#4-restore-procedure-sqlite)
5. [PostgreSQL Backup (Enterprise)](#5-postgresql-backup-enterprise)
6. [PostgreSQL Restore](#6-postgresql-restore)
7. [Verification](#7-verification)

---

## 1. Overview

Kubilitics stores cluster metadata, add-on install records, audit logs, and user sessions in its database. The default deployment uses **SQLite** (`/data/kubilitics.db` inside the backend pod). Enterprise deployments can use **PostgreSQL** (via the Bitnami subchart in `deploy/helm/kubilitics/`).

Both paths require regular backups. A corrupted or lost database means loss of all cluster registrations, add-on state, and audit history.

---

## 2. SQLite Backup (Default)

SQLite databases consist of the main `.db` file plus optional WAL (Write-Ahead Log) files. A safe backup requires checkpointing the WAL first.

### 2.1 Prerequisites

- `kubectl` access to the namespace where Kubilitics is deployed
- The backend pod name (find it with `kubectl get pods -l app.kubernetes.io/name=kubilitics`)

### 2.2 Manual Backup

#### Step 1 -- Checkpoint the WAL

Force all pending WAL transactions into the main database file:

```bash
NAMESPACE="kubilitics"
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "$NAMESPACE" "$POD" -c backend -- \
  sqlite3 /data/kubilitics.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

Expected output: `0|<pages>|<pages>` (three integers). The first integer `0` means success.

#### Step 2 -- Create the backup using `.backup`

The `.backup` command creates an atomic, consistent copy even while the server is running:

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

kubectl exec -n "$NAMESPACE" "$POD" -c backend -- \
  sqlite3 /data/kubilitics.db ".backup '/tmp/kubilitics-${TIMESTAMP}.db'"
```

#### Step 3 -- Copy the backup out of the pod

```bash
kubectl cp "$NAMESPACE/$POD:/tmp/kubilitics-${TIMESTAMP}.db" \
  "./kubilitics-${TIMESTAMP}.db" -c backend
```

#### Step 4 -- Compress and store

```bash
gzip "kubilitics-${TIMESTAMP}.db"
# Upload to your object store, NFS, or backup vault
aws s3 cp "kubilitics-${TIMESTAMP}.db.gz" \
  "s3://my-backups/kubilitics/kubilitics-${TIMESTAMP}.db.gz"
```

#### Step 5 -- Verify integrity of the backup

```bash
gunzip -k "kubilitics-${TIMESTAMP}.db.gz"
sqlite3 "kubilitics-${TIMESTAMP}.db" "PRAGMA integrity_check;"
# Expected: "ok"
sqlite3 "kubilitics-${TIMESTAMP}.db" "SELECT COUNT(*) FROM clusters;"
# Should return a non-zero count matching production
```

---

## 3. Automated Backups with Kubernetes CronJob

The Helm chart includes a built-in CronJob for automated SQLite backups. Enable it in your `values.yaml`:

```yaml
backup:
  enabled: true
  schedule: "0 2 * * *"          # Daily at 2 AM UTC
  retentionDays: 7               # Keep 7 days of local backups
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  image:
    repository: alpine/sqlite
    tag: "latest"
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 200m
      memory: 128Mi

  # Option A: Store backups on a PVC
  pvc:
    enabled: true
    name: "kubilitics-backups"   # Must be pre-created or use dynamic provisioning

  # Option B: Upload to S3
  s3:
    enabled: true
    bucket: "my-company-backups"
    prefix: "kubilitics"
    secretName: "kubilitics-backup-s3"  # Must contain access-key-id and secret-access-key keys
```

Apply with Helm:

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n kubilitics \
  -f values-production.yaml
```

### Verify the CronJob is scheduled

```bash
kubectl get cronjobs -n kubilitics
# NAME                    SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE
# kubilitics-backup       0 2 * * *     False     0        <time>
```

### Trigger a manual backup run

```bash
kubectl create job --from=cronjob/kubilitics-backup \
  kubilitics-backup-manual-$(date +%s) -n kubilitics
```

### Check backup job logs

```bash
kubectl logs -n kubilitics job/kubilitics-backup-manual-<id>
```

---

## 4. Restore Procedure (SQLite)

### 4.1 Prerequisites

- A valid backup file (`kubilitics-YYYYMMDD-HHMMSS.db` or `.db.gz`)
- Verified integrity (`PRAGMA integrity_check` returns `ok`)

### 4.2 Steps

#### Step 1 -- Scale down the backend

**The backend must be stopped before restoring.** SQLite does not support concurrent writers from different processes.

```bash
NAMESPACE="kubilitics"

kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=0
kubectl rollout status deployment kubilitics -n "$NAMESPACE"
# Wait until "0/0 replicas available"
```

#### Step 2 -- Copy the backup into the PVC

Start a temporary pod that mounts the data PVC:

```bash
kubectl run kubilitics-restore --rm -it \
  --image=alpine/sqlite:latest \
  --overrides='{
    "spec": {
      "containers": [{
        "name": "restore",
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

From another terminal, copy the backup into the restore pod:

```bash
# Decompress if needed
gunzip kubilitics-20260315-020000.db.gz

kubectl cp kubilitics-20260315-020000.db \
  "$NAMESPACE/kubilitics-restore:/data/kubilitics.db"
```

Inside the restore pod, verify:

```sh
sqlite3 /data/kubilitics.db "PRAGMA integrity_check;"
# ok
sqlite3 /data/kubilitics.db "SELECT COUNT(*) FROM clusters;"
exit
```

#### Step 3 -- Scale the backend back up

```bash
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=1
kubectl rollout status deployment kubilitics -n "$NAMESPACE"
```

#### Step 4 -- Validate the restore

```bash
# Health check
curl -s https://kubilitics.example.com/health | jq .

# Check cluster count matches expectations
curl -s -H "Authorization: Bearer $TOKEN" \
  https://kubilitics.example.com/clusters | jq '. | length'
```

---

## 5. PostgreSQL Backup (Enterprise)

When `database.type: postgresql` is configured, use PostgreSQL-native tools.

### 5.1 Prerequisites

- `pg_dump` available (install via `postgresql-client` package)
- Connection details from the Kubernetes Secret:

```bash
NAMESPACE="kubilitics"
SECRET_NAME="kubilitics-postgresql"

PG_HOST=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.postgresql-host}' | base64 -d)
PG_PORT=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.postgresql-port}' | base64 -d)
PG_USER=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.postgresql-username}' | base64 -d)
PG_PASS=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.postgres-password}' | base64 -d)
PG_DB=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.postgresql-database}' | base64 -d)
```

### 5.2 Logical backup with pg_dump

```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

PGPASSWORD="$PG_PASS" pg_dump \
  -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
  --format=custom \
  --file="kubilitics-${TIMESTAMP}.pgdump"
```

For large databases, use the directory format with parallel jobs:

```bash
PGPASSWORD="$PG_PASS" pg_dump \
  -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" \
  --format=directory \
  --jobs=4 \
  --file="kubilitics-${TIMESTAMP}-dir/"
```

### 5.3 From inside the cluster (port-forward)

If the PostgreSQL instance is not externally accessible:

```bash
kubectl port-forward svc/kubilitics-postgresql -n "$NAMESPACE" 5432:5432 &

PGPASSWORD="$PG_PASS" pg_dump \
  -h localhost -p 5432 -U "$PG_USER" -d "$PG_DB" \
  --format=custom \
  --file="kubilitics-${TIMESTAMP}.pgdump"

kill %1  # stop port-forward
```

### 5.4 Automated PostgreSQL backups

Use a CronJob with `pg_dump` or a dedicated PostgreSQL backup operator such as:

- **pgBackRest** -- continuous archiving with PITR
- **Barman** -- centralized backup management
- **Bitnami PostgreSQL chart** -- has built-in backup support when `backup.enabled: true`

---

## 6. PostgreSQL Restore

### 6.1 Restore from pg_dump

```bash
# Create a fresh database (if needed)
PGPASSWORD="$PG_PASS" createdb \
  -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
  kubilitics_restored

# Restore
PGPASSWORD="$PG_PASS" pg_restore \
  -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
  -d kubilitics_restored \
  --clean --if-exists \
  "kubilitics-20260315-020000.pgdump"
```

### 6.2 Switch the backend to the restored database

Update the connection string in your Helm values or Kubernetes Secret, then restart:

```bash
kubectl set env deployment/kubilitics -n "$NAMESPACE" \
  KUBILITICS_POSTGRESQL_DATABASE=kubilitics_restored

kubectl rollout restart deployment/kubilitics -n "$NAMESPACE"
kubectl rollout status deployment/kubilitics -n "$NAMESPACE"
```

---

## 7. Verification

After any backup or restore operation, run these checks:

| Check | Command | Expected |
|---|---|---|
| Health endpoint | `curl /health` | `{"status":"ok"}` |
| Cluster count | `GET /clusters` | Matches pre-backup count |
| Add-on installs | `GET /clusters/{id}/addons/installed` | All add-ons show correct status |
| Audit log | `GET /clusters/{id}/addons/installed/{id}/audit` | Recent events present |
| WebSocket stream | Connect to overview stream endpoint | Live data flowing |

---

## Quick Reference

```bash
# Manual SQLite backup (one-liner)
NAMESPACE=kubilitics POD=$(kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}') && \
kubectl exec -n $NAMESPACE $POD -c backend -- sqlite3 /data/kubilitics.db "PRAGMA wal_checkpoint(TRUNCATE);" && \
kubectl exec -n $NAMESPACE $POD -c backend -- sqlite3 /data/kubilitics.db ".backup '/tmp/backup.db'" && \
kubectl cp $NAMESPACE/$POD:/tmp/backup.db ./kubilitics-$(date +%Y%m%d).db -c backend
```
