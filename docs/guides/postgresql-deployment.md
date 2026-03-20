# PostgreSQL Deployment Guide

**Audience:** Platform operators, SREs, database administrators
**Applies to:** Kubilitics v0.1.1+
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Managed Service Options](#2-managed-service-options)
3. [AWS RDS Configuration](#3-aws-rds-configuration)
4. [Google Cloud SQL Configuration](#4-google-cloud-sql-configuration)
5. [Azure Database for PostgreSQL Configuration](#5-azure-database-for-postgresql-configuration)
6. [Connection Pooling](#6-connection-pooling)
7. [Migration from SQLite](#7-migration-from-sqlite)
8. [Performance Benchmarks](#8-performance-benchmarks)
9. [Monitoring and Alerting](#9-monitoring-and-alerting)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

Kubilitics uses SQLite by default for zero-dependency desktop deployments. For production environments requiring high availability, concurrent access, or multi-replica backend deployments, PostgreSQL 14+ is the recommended database engine.

The backend detects the database type from the `KUBILITICS_DATABASE_TYPE` environment variable and uses the appropriate driver. Schema migrations run automatically on startup.

### When to use PostgreSQL

| Scenario | SQLite | PostgreSQL |
|---|:---:|:---:|
| Single-user desktop | Yes | Overkill |
| Single-replica server | Yes | Optional |
| Multi-replica deployment (2+) | No | Required |
| High availability | No | Required |
| Concurrent users >10 | No | Required |
| Audit log retention >90 days | Possible | Recommended |

---

## 2. Managed Service Options

### Comparison Matrix

| Feature | AWS RDS | Cloud SQL | Azure DB |
|---|---|---|---|
| Min PostgreSQL version | 14.x | 14.x | 14.x |
| Auto-failover | Multi-AZ | Regional HA | Zone redundant |
| Connection pooling | RDS Proxy | Cloud SQL Proxy (AlloyDB has native) | Built-in PgBouncer |
| Backups | Automated snapshots | Automated backups | Automated backups |
| Encryption at rest | KMS | CMEK | Azure Key Vault |
| IAM auth | Yes (IAM DB auth) | Yes (IAM) | Yes (Entra ID) |
| Starting cost | db.t4g.micro ~$12/mo | db-f1-micro ~$7/mo | B1ms ~$13/mo |

### Recommended Instance Sizing

| User Count | vCPU | Memory | Storage | IOPS |
|---|---|---|---|---|
| 1-10 users | 2 | 4 GB | 20 GB SSD | 3000 |
| 10-50 users | 2 | 8 GB | 50 GB SSD | 3000 |
| 50-100 users | 4 | 16 GB | 100 GB SSD | 6000 |
| 100-500 users | 8 | 32 GB | 200 GB SSD | 12000 |

---

## 3. AWS RDS Configuration

### 3.1 Create the RDS Instance

```bash
aws rds create-db-instance \
  --db-instance-identifier kubilitics-prod \
  --db-instance-class db.t4g.medium \
  --engine postgres \
  --engine-version 17.2 \
  --master-username kubilitics_admin \
  --master-user-password "$DB_ADMIN_PASSWORD" \
  --allocated-storage 50 \
  --storage-type gp3 \
  --storage-encrypted \
  --vpc-security-group-ids sg-xxxxxxxx \
  --db-subnet-group-name kubilitics-db-subnet \
  --backup-retention-period 14 \
  --multi-az \
  --no-publicly-accessible \
  --tags Key=Project,Value=kubilitics Key=Environment,Value=production
```

### 3.2 Create the Application Database and User

```sql
-- Connect as the admin user
CREATE DATABASE kubilitics;
CREATE USER kubilitics_app WITH PASSWORD 'CHANGE_ME';
GRANT CONNECT ON DATABASE kubilitics TO kubilitics_app;

-- Connect to the kubilitics database
\c kubilitics

GRANT USAGE ON SCHEMA public TO kubilitics_app;
GRANT CREATE ON SCHEMA public TO kubilitics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kubilitics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kubilitics_app;
```

### 3.3 RDS Proxy for Connection Pooling

```bash
aws rds create-db-proxy \
  --db-proxy-name kubilitics-proxy \
  --engine-family POSTGRESQL \
  --auth '[{
    "AuthScheme": "SECRETS",
    "SecretArn": "arn:aws:secretsmanager:us-east-1:123456789:secret:kubilitics-db-creds",
    "IAMAuth": "DISABLED"
  }]' \
  --role-arn arn:aws:iam::123456789:role/kubilitics-rds-proxy-role \
  --vpc-subnet-ids subnet-xxx subnet-yyy \
  --vpc-security-group-ids sg-xxxxxxxx \
  --require-tls
```

### 3.4 Kubernetes Secret

```bash
kubectl create secret generic kubilitics-postgresql \
  -n kubilitics \
  --from-literal=postgresql-host="kubilitics-proxy.proxy-xxxxx.us-east-1.rds.amazonaws.com" \
  --from-literal=postgresql-port="5432" \
  --from-literal=postgresql-database="kubilitics" \
  --from-literal=postgresql-username="kubilitics_app" \
  --from-literal=postgres-password="$DB_APP_PASSWORD" \
  --from-literal=postgresql-ssl-mode="require"
```

### 3.5 Recommended RDS Parameter Group

```
shared_buffers = {DBInstanceClassMemory/4}
effective_cache_size = {DBInstanceClassMemory*3/4}
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 200
idle_in_transaction_session_timeout = 30000
statement_timeout = 60000
log_min_duration_statement = 1000
```

---

## 4. Google Cloud SQL Configuration

### 4.1 Create the Instance

```bash
gcloud sql instances create kubilitics-prod \
  --database-version=POSTGRES_17 \
  --cpu=2 \
  --memory=8GB \
  --storage-size=50GB \
  --storage-type=SSD \
  --availability-type=regional \
  --region=us-central1 \
  --network=projects/my-project/global/networks/kubilitics-vpc \
  --no-assign-ip \
  --enable-bin-log \
  --backup-start-time=03:00 \
  --retained-backups-count=14
```

### 4.2 Create the Database and User

```bash
gcloud sql databases create kubilitics --instance=kubilitics-prod
gcloud sql users create kubilitics_app \
  --instance=kubilitics-prod \
  --password="$DB_APP_PASSWORD"
```

### 4.3 Cloud SQL Auth Proxy (Sidecar)

Add the proxy as a sidecar container in your Kubilitics deployment:

```yaml
# values-cloudsql.yaml
database:
  type: "postgresql"
  postgresql:
    host: "127.0.0.1"  # Proxy runs as localhost sidecar
    port: 5432
    database: "kubilitics"
    username: "kubilitics_app"
    sslMode: "disable"  # Proxy handles TLS

extraContainers:
  - name: cloud-sql-proxy
    image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.14.3
    args:
      - "--structured-logs"
      - "--auto-iam-authn"
      - "my-project:us-central1:kubilitics-prod"
    securityContext:
      runAsNonRoot: true
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 256Mi
```

---

## 5. Azure Database for PostgreSQL Configuration

### 5.1 Create the Flexible Server

```bash
az postgres flexible-server create \
  --resource-group kubilitics-rg \
  --name kubilitics-prod \
  --version 17 \
  --sku-name Standard_B2ms \
  --storage-size 64 \
  --tier Burstable \
  --high-availability ZoneRedundant \
  --zone 1 \
  --standby-zone 2 \
  --vnet kubilitics-vnet \
  --subnet db-subnet \
  --admin-user kubilitics_admin \
  --admin-password "$DB_ADMIN_PASSWORD" \
  --backup-retention 14 \
  --tags Project=kubilitics Environment=production
```

### 5.2 Enable Built-in PgBouncer

Azure Database for PostgreSQL Flexible Server includes a built-in PgBouncer:

```bash
az postgres flexible-server parameter set \
  --resource-group kubilitics-rg \
  --server-name kubilitics-prod \
  --name pgbouncer.enabled \
  --value true

az postgres flexible-server parameter set \
  --resource-group kubilitics-rg \
  --server-name kubilitics-prod \
  --name pgbouncer.default_pool_size \
  --value 50

az postgres flexible-server parameter set \
  --resource-group kubilitics-rg \
  --server-name kubilitics-prod \
  --name pgbouncer.max_client_conn \
  --value 200
```

Connect through port 6432 (PgBouncer) instead of 5432.

---

## 6. Connection Pooling

### Why Connection Pooling Matters

Each Kubilitics backend replica opens multiple database connections for:
- HTTP request handlers (concurrent queries)
- WebSocket event processing
- Add-on lifecycle operations
- Audit log writes

Without pooling, N replicas x M connections per replica can exhaust PostgreSQL's `max_connections`.

### Option A: Application-Level Pooling (Built-in)

The Kubilitics backend uses Go's `database/sql` connection pool. Configure via environment variables:

```yaml
env:
  - name: KUBILITICS_DATABASE_TYPE
    value: "postgresql"
  - name: KUBILITICS_DB_MAX_OPEN_CONNS
    value: "25"         # Max open connections per replica
  - name: KUBILITICS_DB_MAX_IDLE_CONNS
    value: "10"         # Max idle connections
  - name: KUBILITICS_DB_CONN_MAX_LIFETIME
    value: "300"        # Seconds before a connection is recycled
  - name: KUBILITICS_DB_CONN_MAX_IDLE_TIME
    value: "60"         # Seconds before an idle connection is closed
```

### Option B: PgBouncer (Recommended for Multi-Replica)

Deploy PgBouncer as a Kubernetes Deployment between Kubilitics and PostgreSQL:

```yaml
# pgbouncer-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: pgbouncer-config
  namespace: kubilitics
data:
  pgbouncer.ini: |
    [databases]
    kubilitics = host=kubilitics-postgresql port=5432 dbname=kubilitics

    [pgbouncer]
    listen_addr = 0.0.0.0
    listen_port = 6432
    auth_type = md5
    auth_file = /etc/pgbouncer/userlist.txt
    pool_mode = transaction
    default_pool_size = 50
    max_client_conn = 400
    max_db_connections = 100
    server_idle_timeout = 600
    server_lifetime = 3600
    log_connections = 0
    log_disconnections = 0
    stats_period = 60
```

### Pool Sizing Guidelines

| Replicas | Pool Mode | `default_pool_size` | `max_db_connections` | PG `max_connections` |
|---|---|---|---|---|
| 1 | transaction | 20 | 25 | 50 |
| 2 | transaction | 30 | 50 | 100 |
| 4 | transaction | 40 | 80 | 150 |
| 8 | transaction | 50 | 100 | 200 |

---

## 7. Migration from SQLite

For step-by-step migration instructions, see the dedicated runbook:

**[Runbook: Migrate SQLite to PostgreSQL](../runbooks/migrate-sqlite-postgresql.md)**

The runbook covers:
- Pre-migration checklist and baseline recording
- Data export from SQLite (CSV and SQL dump)
- PostgreSQL provisioning (Bitnami subchart or external)
- Data import and sequence reset
- Verification and rollback procedures

### Key Migration Notes

1. **Schema compatibility** -- The backend auto-migrates schema on startup. SQLite and PostgreSQL share the same logical schema but differ in column types (e.g., `INTEGER PRIMARY KEY AUTOINCREMENT` vs `SERIAL`).
2. **Data types** -- Boolean columns stored as `0`/`1` in SQLite map to PostgreSQL `boolean` automatically via the import.
3. **Timestamps** -- Both use RFC 3339 / ISO 8601 strings. No conversion needed.
4. **Concurrent access** -- SQLite locks the entire database on write. After migration, you gain row-level locking and can safely run multiple replicas.

---

## 8. Performance Benchmarks

Benchmarks measured against Kubilitics v0.1.1 backend with representative workloads.

### Test Environment

- PostgreSQL 17.2, 4 vCPU / 16 GB RAM, gp3 SSD (3000 IOPS)
- Kubilitics backend: 2 replicas, 500m CPU / 512Mi memory each
- Test data: 20 clusters, 500 resources per cluster, 30 days of audit logs (~1.2M rows)

### Query Performance

| Operation | SQLite (single) | PostgreSQL (single) | PostgreSQL (2 replicas) |
|---|---|---|---|
| List clusters | 2 ms | 3 ms | 3 ms |
| Get cluster summary | 15 ms | 8 ms | 8 ms |
| Generate topology (50 nodes) | 45 ms | 30 ms | 30 ms |
| Generate topology (500 nodes) | 380 ms | 180 ms | 180 ms |
| Generate topology (5000 nodes) | 3.2 s | 1.1 s | 1.1 s |
| List audit logs (paginated, 50/page) | 12 ms | 4 ms | 4 ms |
| Search audit logs (full text) | 180 ms | 25 ms | 25 ms |
| Write audit event | 8 ms | 5 ms | 5 ms |
| Concurrent writes (50 goroutines) | 2.8 s total | 180 ms total | 180 ms total |

### Throughput

| Metric | SQLite | PostgreSQL |
|---|---|---|
| Max sustained writes/sec | ~120 (WAL mode) | ~2,500 |
| Max concurrent readers | Unlimited (read-only) | Limited by `max_connections` |
| Max concurrent writers | 1 (database-level lock) | Limited by `max_connections` |

### Recommendations

- **Topology generation** is CPU-bound, not I/O-bound. PostgreSQL's advantage comes from better query planning on joins and indexes.
- Enable `pg_stat_statements` to identify slow queries in production.
- Add a GIN index on audit logs `details` column if full-text search is used heavily:
  ```sql
  CREATE INDEX idx_audit_events_details_gin ON audit_events USING gin (to_tsvector('english', details));
  ```

---

## 9. Monitoring and Alerting

### Prometheus Metrics

The Kubilitics backend exposes database pool metrics at `/metrics`:

```
kubilitics_db_open_connections       # Current open connections
kubilitics_db_idle_connections       # Current idle connections
kubilitics_db_wait_count_total       # Total number of waits for a connection
kubilitics_db_wait_duration_seconds  # Total wait time for connections
```

### Recommended Alerts

```yaml
groups:
  - name: kubilitics-postgresql
    rules:
      - alert: KubiliticsDBConnectionPoolExhausted
        expr: kubilitics_db_open_connections / kubilitics_db_max_open_connections > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database connection pool >90% utilized"

      - alert: KubiliticsDBHighWaitTime
        expr: rate(kubilitics_db_wait_duration_seconds[5m]) > 0.1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Queries are waiting for database connections"

      - alert: KubiliticsDBReplicationLag
        expr: pg_replication_lag_seconds > 30
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL replication lag exceeds 30s"
```

---

## 10. Troubleshooting

### Connection refused

```
Error: dial tcp <host>:5432: connect: connection refused
```

- Verify the PostgreSQL instance is running and accessible from the cluster network.
- Check security groups / firewall rules allow traffic from Kubilitics pods.
- For Cloud SQL, ensure the Auth Proxy sidecar is running.

### Too many connections

```
Error: FATAL: too many connections for role "kubilitics_app"
```

- Deploy PgBouncer or increase `max_connections` on the PostgreSQL instance.
- Reduce `KUBILITICS_DB_MAX_OPEN_CONNS` per replica.
- Check for connection leaks: `SELECT count(*) FROM pg_stat_activity WHERE usename = 'kubilitics_app';`

### SSL certificate error

```
Error: x509: certificate signed by unknown authority
```

- Set `sslMode: "require"` (validates encryption but not CA) for managed services.
- For strict validation, set `sslMode: "verify-full"` and provide the CA certificate:
  ```
  KUBILITICS_DB_SSL_ROOT_CERT=/path/to/ca.pem
  ```

### Slow topology queries

- Check if the topology cache is enabled (`KUBILITICS_TOPOLOGY_CACHE_TTL_SEC` > 0).
- Run `EXPLAIN ANALYZE` on slow queries via `pg_stat_statements`.
- Ensure `work_mem` is sufficient (16 MB+ recommended for topology joins).
