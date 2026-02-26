# Kubilitics Operations Runbook — Production Operations Guide

**Version:** 1.0.0
**Last Updated:** February 2026
**Audience:** DevOps, SREs, Operations Engineers
**Status:** Active

## Table of Contents

1. [Deployment Procedures](#1-deployment-procedures)
2. [Configuration Guide](#2-configuration-guide)
3. [Monitoring & Alerting](#3-monitoring--alerting)
4. [Troubleshooting Playbooks](#4-troubleshooting-playbooks)
5. [Backup & Recovery](#5-backup--recovery)
6. [Capacity Planning](#6-capacity-planning)
7. [Security Operations](#7-security-operations)

---

## 1. Deployment Procedures

Kubilitics supports multiple deployment models: desktop application, in-cluster Kubernetes deployment, and mobile applications. Each requires specific installation and configuration steps.

### Desktop Deployment

**Supported Operating Systems:**
- macOS 11.0+
- Windows 10/11 (64-bit)
- Ubuntu 20.04 LTS+, Debian 11+

**System Requirements:**
- Minimum 2 CPU cores
- Minimum 4GB RAM (8GB recommended for large clusters)
- 500MB disk space for application
- Network access to Kubernetes API server (port 6443 or custom)
- TLS 1.2+ support

**Installation Steps:**

1. **Download Application**
   - Visit https://releases.kubilitics.io
   - Download appropriate installer for your OS
   - Verify SHA256 checksum: `sha256sum kubilitics-desktop-1.0.0-macos.dmg`

2. **macOS Installation**
   ```
   - Mount DMG: open kubilitics-desktop-1.0.0-macos.dmg
   - Drag Kubilitics.app to Applications folder
   - Launch from Applications
   - Grant permissions: System Preferences > Security & Privacy > Allow Kubilitics
   - On first launch, app creates ~/.kubilitics/ config directory
   ```

3. **Windows Installation**
   ```
   - Run kubilitics-desktop-1.0.0-windows.msi
   - Follow installer wizard (accepts default C:\Program Files\Kubilitics)
   - Installer registers app in Start Menu and adds firewall rules
   - Launch from Start Menu: Kubilitics
   ```

4. **Linux Installation**
   ```
   # Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install ./kubilitics-desktop-1.0.0-linux-amd64.deb

   # Or extract tarball
   tar xzf kubilitics-desktop-1.0.0-linux-amd64.tar.gz
   sudo mv kubilitics /opt/
   /opt/kubilitics/bin/kubilitics
   ```

5. **First Launch Configuration**
   - Application auto-detects kubeconfig at ~/.kube/config
   - If not found, prompts user to create or import kubeconfig
   - Initializes SQLite database in ~/.kubilitics/data.db
   - Generates self-signed certificate for backend service
   - Backend service starts on 127.0.0.1:8080
   - Opens browser to localhost:3000 (React frontend)

6. **Firewall Configuration**
   - Desktop deployment communicates with:
     - Kubernetes API server (port 6443 or custom)
     - Kubilitics AI service (localhost:8081)
     - LLM provider (OpenAI, Claude, etc. - port 443)
   - No inbound firewall rules required (single-user)
   - Outbound: HTTPS to K8s API and LLM providers

**Verification Steps:**
```
1. Open browser to http://localhost:3000
2. Verify frontend loads without errors
3. Click "Health Check" in Settings > About
4. Confirm all services show "healthy"
5. Try listing resources: Cluster > Resources > Pods
6. Verify context switching works: Select different context from dropdown
```

**First-Time User Walkthrough:**
- Connection wizard guides user through kubeconfig context selection
- Import dialog allows pasting kubeconfig YAML or selecting file
- Safety settings wizard explains autonomy levels (review before apply, auto-apply safe operations, etc.)
- LLM configuration wizard (optional; uses free tier if not configured)
- Database selection (SQLite default for desktop; PostgreSQL enterprise option)

**Post-Installation Maintenance:**
- Check for updates: Settings > About > Check for Updates
- Application auto-updates on next restart (configurable)
- Manual rollback: keep previous version in Downloads folder
- Uninstall: macOS (drag from Applications to Trash), Windows (Control Panel > Add/Remove), Linux (apt remove kubilitics)

---

### In-Cluster Deployment via Helm

**Prerequisites:**
- Kubernetes cluster 1.24+ (tested on 1.24-1.28)
- Helm 3.10+
- kubectl configured with cluster-admin role
- Persistent storage: dynamic provisioning or pre-provisioned PVC
- Ingress controller (optional, for external access)
- Metrics server installed for pod/node metrics

**Add Helm Repository:**
```bash
helm repo add kubilitics https://charts.kubilitics.io
helm repo update
helm search repo kubilitics
```

**Basic Installation (Default Values):**
```bash
kubectl create namespace kubilitics
helm install kubilitics kubilitics/kubilitics \
  --namespace kubilitics \
  --set ingress.enabled=true \
  --set ingress.host=kubilitics.example.com
```

**Production Installation with Custom Configuration:**
```bash
# Create values file
cat > values-prod.yaml <<EOF
replicaCount: 3

backend:
  image:
    repository: kubilitics/backend
    tag: 1.0.0
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 2000m
      memory: 4Gi
  service:
    type: ClusterIP
    port: 8080

aiService:
  enabled: true
  replicas: 2
  resources:
    requests:
      cpu: 1000m
      memory: 2Gi
    limits:
      cpu: 4000m
      memory: 8Gi
  llm:
    provider: "openai"
    model: "gpt-4-turbo"
    apiKeyRef:
      name: llm-config
      key: api-key
  vectorStore:
    type: pinecone
    endpoint: "https://api.pinecone.io"
    indexName: "kubilitics-prod"

database:
  type: postgresql
  postgresql:
    host: postgres-service.database.svc
    port: 5432
    database: kubilitics
    credentials:
      secretRef:
        name: postgres-credentials
        userKey: username
        passwordKey: password

persistence:
  enabled: true
  storageClass: "ebs-gp3"
  size: 100Gi

ingress:
  enabled: true
  ingressClassName: nginx
  host: kubilitics.example.com
  tls:
    enabled: true
    issuer: letsencrypt-prod

serviceAccount:
  create: true
  name: kubilitics
  rbac:
    clusterAdmin: false
    rules:
      - apiGroups: [""]
        resources: ["pods", "pods/log", "pods/exec"]
        verbs: ["get", "list", "watch"]
      - apiGroups: ["apps"]
        resources: ["deployments", "statefulsets", "daemonsets"]
        verbs: ["get", "list", "watch", "patch", "update"]

monitoring:
  enabled: true
  prometheus:
    scrapeInterval: 30s
    port: 9090
  grafana:
    enabled: true
    datasource: prometheus

logging:
  enabled: true
  loglevel: info
  format: json
  elasticsearch:
    enabled: false

securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
  readOnlyRootFilesystem: true

networkPolicy:
  enabled: true
  policyTypes:
    - Ingress
    - Egress

certManager:
  enabled: true
  issuer: letsencrypt-prod
EOF

helm install kubilitics kubilitics/kubilitics \
  --namespace kubilitics \
  --values values-prod.yaml
```

**Pre-Installation: Create Required Secrets**
```bash
# Create LLM configuration secret
kubectl create secret generic llm-config \
  --from-literal=api-key=sk-xxxxxx \
  -n kubilitics

# Create PostgreSQL credentials (if using external database)
kubectl create secret generic postgres-credentials \
  --from-literal=username=kubilitics \
  --from-literal=password=secure-password \
  -n kubilitics

# Create Pinecone vector store credentials
kubectl create secret generic pinecone-config \
  --from-literal=api-key=pcx-xxxxx \
  -n kubilitics

# Create TLS certificate (if not using cert-manager)
kubectl create secret tls kubilitics-tls \
  --cert=/path/to/cert.pem \
  --key=/path/to/key.pem \
  -n kubilitics
```

**Verify Installation:**
```bash
# Check pod status
kubectl get pods -n kubilitics
kubectl describe pod -n kubilitics kubilitics-backend-0

# Check services
kubectl get svc -n kubilitics

# Verify backend is running
kubectl port-forward svc/kubilitics 8080:8080 -n kubilitics
curl http://localhost:8080/health

# Verify AI service
kubectl port-forward svc/kubilitics-ai 8081:8081 -n kubilitics
curl http://localhost:8081/api/v1/ai/status

# Check ingress
kubectl get ingress -n kubilitics
kubectl describe ingress kubilitics -n kubilitics

# Check persistent volumes
kubectl get pvc -n kubilitics
kubectl get pv
```

**Post-Installation Configuration:**
1. Access Kubilitics UI: https://kubilitics.example.com
2. Configure LLM provider settings via API or UI
3. Adjust safety policies for your environment
4. Import existing kubeconfig contexts
5. Set up monitoring and alerting rules
6. Configure backup schedule
7. Test health checks: System > Health Check

**Upgrading In-Cluster Deployment:**
```bash
# Check current version
helm list -n kubilitics

# Update repository
helm repo update

# Check available versions
helm search repo kubilitics --versions

# Perform upgrade (uses rolling deployment)
helm upgrade kubilitics kubilitics/kubilitics \
  --namespace kubilitics \
  --values values-prod.yaml

# Monitor rollout
kubectl rollout status deployment/kubilitics-backend -n kubilitics
kubectl rollout status deployment/kubilitics-ai -n kubilitics

# If issues occur, rollback
helm rollback kubilitics 1 -n kubilitics
```

**Multi-Zone Deployment:**
For high-availability across availability zones:
```bash
# Enable pod affinity in values-prod.yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
              - key: app
                operator: In
                values: ["kubilitics"]
          topologyKey: topology.kubernetes.io/zone

# Deploy across zones
kubectl label nodes node-zone-1 topology.kubernetes.io/zone=us-west-2a
kubectl label nodes node-zone-2 topology.kubernetes.io/zone=us-west-2b
kubectl label nodes node-zone-3 topology.kubernetes.io/zone=us-west-2c
```

---

### Mobile Deployment

**iOS Installation:**
1. Open App Store on iOS device
2. Search for "Kubilitics"
3. Tap "Get" then authenticate with Apple ID
4. App installs to home screen
5. On first launch, app requests permissions:
   - Camera (for QR code scanning of kubeconfig)
   - Network access (for API communication)
6. Configure backend URL (development: localhost:8080, production: https://kubilitics.example.com)
7. Import kubeconfig via QR code or paste method
8. Select default cluster context

**Android Installation:**
1. Open Google Play Store on Android device
2. Search for "Kubilitics"
3. Tap "Install"
4. Grant required permissions when prompted
5. Tap "Open" to launch after installation
6. Follow same configuration steps as iOS

**Mobile Network Requirements:**
- Network connectivity to backend service (mobile networks acceptable)
- TLS certificate validation (use trusted CA for production)
- Firewall rules allowing outbound HTTPS traffic

**Mobile Backend Connection Configuration:**
```
Development: http://192.168.1.100:8080 (local network)
Production: https://kubilitics.example.com (public URL)
VPN: https://vpn-endpoint.example.com (private network)
```

**Offline Support (Mobile):**
- Mobile app caches cluster state locally
- Real-time updates work only when connected
- Basic operations (read-only) available offline with cached data
- Write operations require active connection

**Mobile Security Considerations:**
- All credentials stored in device keychain (iOS) or Keystore (Android)
- Kubeconfig never synced to cloud
- Session tokens auto-refresh when near expiration
- App locks when backgrounded for >5 minutes (configurable)

---

## 2. Configuration Guide

### Environment Variables Reference

**Backend Service (port 8080)**

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `KUBILITICS_PORT` | int | No | 8080 | HTTP server port |
| `KUBILITICS_HOST` | string | No | 0.0.0.0 | Bind address |
| `KUBILITICS_LOG_LEVEL` | string | No | info | debug, info, warn, error |
| `KUBILITICS_LOG_FORMAT` | string | No | json | json or text |
| `KUBILITICS_DATABASE_TYPE` | string | No | sqlite | sqlite or postgresql |
| `KUBILITICS_DATABASE_PATH` | string | No | ~/.kubilitics/data.db | SQLite database path |
| `KUBILITICS_DATABASE_URL` | string | No | | PostgreSQL connection string |
| `KUBILITICS_DATABASE_POOL_SIZE` | int | No | 20 | Connection pool size |
| `KUBILITICS_KUBECONFIG_PATH` | string | No | ~/.kube/config | Path to kubeconfig file |
| `KUBILITICS_CACHE_TYPE` | string | No | memory | memory or redis |
| `KUBILITICS_CACHE_TTL` | int | No | 300 | Cache time-to-live (seconds) |
| `KUBILITICS_REDIS_URL` | string | No | redis://localhost:6379 | Redis connection URL |
| `KUBILITICS_REDIS_PASSWORD` | string | No | | Redis auth password |
| `KUBILITICS_CORS_ORIGINS` | string | No | http://localhost:3000 | Comma-separated CORS origins |
| `KUBILITICS_TLS_ENABLED` | bool | No | false | Enable TLS |
| `KUBILITICS_TLS_CERT_PATH` | string | No | | Path to TLS certificate |
| `KUBILITICS_TLS_KEY_PATH` | string | No | | Path to TLS private key |
| `KUBILITICS_AI_SERVICE_URL` | string | No | http://localhost:8081 | AI service endpoint |
| `KUBILITICS_AI_SERVICE_TIMEOUT` | int | No | 30 | AI service timeout (seconds) |
| `KUBILITICS_AI_SERVICE_RETRY_ATTEMPTS` | int | No | 3 | Retry attempts |
| `KUBILITICS_METRICS_ENABLED` | bool | No | true | Enable Prometheus metrics export |
| `KUBILITICS_METRICS_PORT` | int | No | 9090 | Metrics scrape port |
| `KUBILITICS_REQUEST_TIMEOUT` | int | No | 30 | Request timeout (seconds) |
| `KUBILITICS_MAX_CONCURRENT_INVESTIGATIONS` | int | No | 5 | Max parallel investigations |
| `KUBILITICS_INVESTIGATION_TIMEOUT` | int | No | 300 | Investigation timeout (seconds) |

**AI Service (port 8081)**

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `AI_SERVICE_PORT` | int | No | 8081 | HTTP server port |
| `AI_LOG_LEVEL` | string | No | info | Log verbosity |
| `AI_LLM_PROVIDER` | string | Yes | | openai, anthropic, azure |
| `AI_LLM_API_KEY` | string | Yes | | LLM provider API key |
| `AI_LLM_MODEL` | string | No | gpt-4-turbo | Model identifier |
| `AI_LLM_TEMPERATURE` | float | No | 0.3 | Sampling temperature (0.0-1.0) |
| `AI_LLM_MAX_TOKENS` | int | No | 2048 | Max response tokens |
| `AI_LLM_TIMEOUT` | int | No | 60 | API request timeout (seconds) |
| `AI_VECTOR_STORE_TYPE` | string | No | memory | memory, pinecone, weaviate |
| `AI_VECTOR_STORE_ENDPOINT` | string | No | | Vector store API endpoint |
| `AI_VECTOR_STORE_API_KEY` | string | No | | Vector store authentication |
| `AI_VECTOR_STORE_INDEX_NAME` | string | No | kubilitics | Index/namespace name |
| `AI_EMBEDDINGS_MODEL` | string | No | text-embedding-3-small | Embeddings model |
| `AI_SAFETY_AUTONOMY_LEVEL` | int | No | 1 | 1-3 (review, safe-auto, full-auto) |
| `AI_SAFETY_PROTECTED_NAMESPACES` | string | No | kube-system,kube-node-lease | Comma-separated |
| `AI_SAFETY_FORBIDDEN_OPERATIONS` | string | No | delete_pvc,delete_secret | Comma-separated |
| `AI_BACKEND_SERVICE_URL` | string | Yes | http://localhost:8080 | Backend API URL |
| `AI_BACKEND_SERVICE_TOKEN` | string | Yes | | Service account token |
| `AI_METRICS_PORT` | int | No | 9091 | Prometheus metrics port |
| `AI_INVESTIGATION_CONCURRENCY` | int | No | 5 | Parallel investigations |
| `AI_INVESTIGATION_TIMEOUT` | int | No | 300 | Investigation timeout (seconds) |
| `AI_BUDGET_MONTHLY_LIMIT` | float | No | 5000 | Monthly USD budget limit |
| `AI_BUDGET_TOKEN_LIMIT` | int | No | 50000000 | Monthly token limit |

**Frontend (React, port 3000)**

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `REACT_APP_API_URL` | string | No | http://localhost:8080 | Backend API URL |
| `REACT_APP_WS_URL` | string | No | ws://localhost:8080 | WebSocket URL |
| `REACT_APP_ENVIRONMENT` | string | No | development | development, staging, production |
| `REACT_APP_ANALYTICS_ENABLED` | bool | No | false | Enable analytics |
| `REACT_APP_SENTRY_DSN` | string | No | | Sentry error tracking |
| `REACT_APP_LOG_LEVEL` | string | No | warn | Browser console log level |

### Configuration Files

**Backend Configuration File** (~/.kubilitics/config.yaml)
```yaml
server:
  port: 8080
  host: "0.0.0.0"
  tls:
    enabled: false
    cert_path: /path/to/cert.pem
    key_path: /path/to/key.pem

database:
  type: "sqlite"
  sqlite:
    path: "~/.kubilitics/data.db"
  postgresql:
    host: "localhost"
    port: 5432
    database: "kubilitics"
    user: "kubilitics"
    password: "${DB_PASSWORD}"
    ssl_mode: "require"
    pool:
      size: 20
      timeout: 30

kubernetes:
  kubeconfig_path: "~/.kube/config"
  default_context: "prod-us-west-2"
  request_timeout: 30
  metrics_server_enabled: true

cache:
  type: "memory"  # or "redis"
  ttl: 300
  redis:
    url: "redis://localhost:6379"
    password: "${REDIS_PASSWORD}"

logging:
  level: "info"
  format: "json"
  output: "stdout"  # or file path
  max_file_size_mb: 100
  retention_days: 30

cors:
  enabled: true
  origins:
    - "http://localhost:3000"
    - "https://kubilitics.example.com"

ai_service:
  url: "http://localhost:8081"
  timeout_seconds: 30
  retry_attempts: 3

metrics:
  enabled: true
  port: 9090
  path: "/metrics"
```

**AI Service Configuration** (~/.kubilitics/ai-config.yaml)
```yaml
server:
  port: 8081
  log_level: "info"

llm:
  provider: "openai"
  api_key: "${AI_API_KEY}"
  model: "gpt-4-turbo"
  parameters:
    temperature: 0.3
    max_tokens: 2048
    top_p: 0.9
  timeout: 60
  retry_policy:
    attempts: 3
    backoff_factor: 2

vector_store:
  type: "memory"  # or "pinecone", "weaviate"
  pinecone:
    endpoint: "https://api.pinecone.io"
    api_key: "${PINECONE_API_KEY}"
    index_name: "kubilitics"
    namespace: "prod"
  embeddings:
    model: "text-embedding-3-small"
    provider: "openai"

safety_policy:
  autonomy_level: 2  # 1=review, 2=safe-auto, 3=full-auto
  protected_namespaces:
    - "kube-system"
    - "kube-node-lease"
    - "kube-public"
  forbidden_operations:
    - "delete_persistent_volume_claim"
    - "delete_secret"
    - "delete_persistent_volume"
  require_approval:
    delete_pod: true
    modify_rbac: true
    scale_to_zero: true
    modify_network_policy: true

investigations:
  max_concurrent: 5
  timeout_seconds: 300
  auto_remediation_enabled: false
  save_history: true

chat:
  context_window_messages: 20
  enable_code_execution: false
  enable_kubectl_commands: true

budget:
  monthly_limit_usd: 5000
  token_limit: 50000000
  warning_threshold_percent: 75
  hard_limit: true

metrics:
  enabled: true
  port: 9091
  collection_interval: 60

backend_service:
  url: "http://localhost:8080"
  token: "${BACKEND_SERVICE_TOKEN}"
  timeout: 30
```

### LLM Provider Configuration

**OpenAI Configuration**
```yaml
llm:
  provider: "openai"
  api_key: "${OPENAI_API_KEY}"
  model: "gpt-4-turbo"  # or "gpt-4", "gpt-3.5-turbo"
  organization: "org-xxxxxxxxxx"  # Optional
  parameters:
    temperature: 0.3
    max_tokens: 2048
    top_p: 0.9
    presence_penalty: 0
    frequency_penalty: 0
  timeout: 60
```

**Anthropic Claude Configuration**
```yaml
llm:
  provider: "anthropic"
  api_key: "${ANTHROPIC_API_KEY}"
  model: "claude-opus-4.6"  # or "claude-opus", "claude-sonnet"
  parameters:
    max_tokens: 2048
    temperature: 0.3
    top_p: 0.9
  timeout: 60
```

**Azure OpenAI Configuration**
```yaml
llm:
  provider: "azure"
  api_key: "${AZURE_OPENAI_API_KEY}"
  endpoint: "https://your-resource.openai.azure.com"
  deployment_id: "gpt-4-turbo"
  api_version: "2024-02-01"
  parameters:
    temperature: 0.3
    max_tokens: 2048
  timeout: 60
```

### Safety Policy Configuration

**Autonomy Levels Explained:**

**Level 1: Review Before Apply** (Most Restrictive)
- AI proposes actions but never executes
- All proposed changes require human review and approval
- Best for: Initial deployments, highly regulated environments
- Approval latency: ~5-10 minutes

**Level 2: Auto-Apply Safe Operations** (Balanced)
- Auto-executes low-risk operations (scaling, restarts)
- Requires approval for high-risk operations (deletion, RBAC changes)
- Best for: Production environments with experienced teams
- Approval latency: ~1-2 minutes for high-risk

**Level 3: Full Autonomy** (Least Restrictive)
- AI executes all approved actions without human intervention
- Best for: Non-critical environments, automated remediation
- Approval latency: Minimal

**Configuring Protected Namespaces**
```yaml
safety_policy:
  protected_namespaces:
    - "kube-system"        # Cluster infrastructure
    - "kube-node-lease"    # Node heartbeat
    - "kube-public"        # Public resources
    - "kube-apiserver"     # API server
    - "prod-pii"           # Production PII data
    - "payment-processing" # Payment systems
```

**Configuring Forbidden Operations**
```yaml
safety_policy:
  forbidden_operations:
    - "delete_persistent_volume_claim"  # Never auto-delete PVCs
    - "delete_secret"                   # Never auto-delete secrets
    - "delete_persistent_volume"        # Never delete PVs
    - "delete_stateful_set"             # Never delete stateful services
    - "modify_rbac_binding"             # Never modify RBAC
    - "disable_network_policy"          # Never disable network policies
```

### Database Configuration

**SQLite (Default for Desktop)**
```yaml
database:
  type: "sqlite"
  sqlite:
    path: "~/.kubilitics/data.db"
    journal_mode: "WAL"  # Write-Ahead Logging for better concurrency
    cache_size: 10000
    busy_timeout: 5000
    synchronous: "NORMAL"  # Balance between durability and speed
```

Benefits: Single-file, no separate server, sufficient for single-user/small deployments
Limitations: Limited concurrent write access, max ~10 concurrent connections

**PostgreSQL (Enterprise Deployment)**
```yaml
database:
  type: "postgresql"
  postgresql:
    host: "postgres.database.svc.cluster.local"
    port: 5432
    database: "kubilitics"
    user: "kubilitics"
    password: "${DB_PASSWORD}"
    ssl_mode: "require"
    pool:
      size: 20
      timeout: 30
      idle_timeout: 300
      max_lifetime: 1800
    performance:
      shared_buffers: "256MB"
      effective_cache_size: "1GB"
      maintenance_work_mem: "64MB"
      work_mem: "32MB"
      synchronous_commit: "local"
```

Benefits: Unlimited scalability, multi-node clustering, superior performance, ACID guarantees
Requirements: Separate PostgreSQL instance, backup/recovery procedures

**Database Schema Migrations**

Migrations run automatically on startup if database version doesn't match application version. Manual migration:
```bash
# List pending migrations
kubilitics-cli db migrate --status

# Apply specific migration version
kubilitics-cli db migrate --version 45

# Rollback last migration
kubilitics-cli db migrate --rollback

# Create backup before migration (critical for production)
pg_dump -U kubilitics kubilitics > kubilitics-backup-$(date +%Y%m%d).sql
```

---

## 3. Monitoring & Alerting

### Health Check Endpoints

**Backend Health Check**
```bash
curl -X GET http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-10T14:23:45Z",
  "dependencies": {
    "kubernetes_api": "healthy",
    "database": "healthy",
    "ai_service": "healthy",
    "redis_cache": "healthy"
  }
}
```

**AI Service Health Check**
```bash
curl -X GET http://localhost:8081/api/v1/ai/status
```

Expected response:
```json
{
  "status": "operational",
  "llm_provider": {
    "name": "OpenAI",
    "connectivity": "healthy"
  },
  "token_usage": {
    "daily_used": 45678,
    "daily_quota": 1000000
  }
}
```

**Monitoring Integration**

**Prometheus Configuration** (prometheus.yaml)
```yaml
global:
  scrape_interval: 30s
  evaluation_interval: 30s

scrape_configs:
  - job_name: "kubilitics-backend"
    static_configs:
      - targets: ["localhost:9090"]
    metrics_path: "/metrics"
    scrape_interval: 30s

  - job_name: "kubilitics-ai"
    static_configs:
      - targets: ["localhost:9091"]
    metrics_path: "/metrics"
    scrape_interval: 30s

  - job_name: "kubernetes-api-server"
    kubernetes_sd_configs:
      - role: endpoints
    relabel_configs:
      - source_labels: [__meta_kubernetes_namespace, __meta_kubernetes_name]
        action: keep
        regex: default;kubernetes
```

### Prometheus Metrics Reference

**Backend Metrics** (port 9090)

| Metric | Type | Description |
|--------|------|-------------|
| `kubilitics_requests_total` | Counter | Total HTTP requests by method, path, status |
| `kubilitics_request_duration_seconds` | Histogram | Request latency distribution |
| `kubilitics_database_query_duration_seconds` | Histogram | Database query latency |
| `kubilitics_kubernetes_api_calls_total` | Counter | Kubernetes API calls by resource type |
| `kubilitics_kubernetes_api_latency_seconds` | Histogram | K8s API latency distribution |
| `kubilitics_active_websockets` | Gauge | Current WebSocket connections |
| `kubilitics_cached_items_total` | Gauge | Total cached items |
| `kubilitics_cache_hit_ratio` | Gauge | Cache hit percentage |
| `kubilitics_investigation_duration_seconds` | Histogram | Investigation execution time |
| `kubilitics_investigation_success_total` | Counter | Successful investigations |
| `kubilitics_investigation_failure_total` | Counter | Failed investigations |
| `kubilitics_database_connections_active` | Gauge | Active database connections |
| `kubilitics_database_connections_idle` | Gauge | Idle database connections |

**AI Service Metrics** (port 9091)

| Metric | Type | Description |
|--------|------|-------------|
| `ai_llm_requests_total` | Counter | LLM API calls by model, operation |
| `ai_llm_latency_seconds` | Histogram | LLM response latency |
| `ai_tokens_used_total` | Counter | Total tokens consumed |
| `ai_token_budget_remaining` | Gauge | Remaining budget tokens |
| `ai_token_cost_usd` | Counter | Cumulative USD cost |
| `ai_vector_store_operations_total` | Counter | Vector store queries/updates |
| `ai_vector_store_latency_seconds` | Histogram | Vector store latency |
| `ai_investigation_queue_length` | Gauge | Pending investigations |
| `ai_investigation_duration_seconds` | Histogram | Investigation execution time |
| `ai_insight_generation_duration_seconds` | Histogram | Insight generation time |

**Example Prometheus Queries**

```promql
# Request rate (requests/second)
rate(kubilitics_requests_total[5m])

# 95th percentile latency (seconds)
histogram_quantile(0.95, kubilitics_request_duration_seconds_bucket)

# Cache hit ratio
kubilitics_cache_hit_ratio

# Kubernetes API latency
histogram_quantile(0.99, kubilitics_kubernetes_api_latency_seconds_bucket)

# Investigation success rate
rate(kubilitics_investigation_success_total[1h]) / (rate(kubilitics_investigation_success_total[1h]) + rate(kubilitics_investigation_failure_total[1h]))

# Daily token cost trending
increase(ai_token_cost_usd[1d])
```

### Grafana Dashboards

**Cluster Health Dashboard**
- Cluster node status (ready/not-ready)
- Pod distribution by namespace
- Resource utilization (CPU, memory, disk)
- Node pressure conditions (disk, memory, PID)

**API Performance Dashboard**
- Request rate by endpoint (5min average)
- Latency percentiles (p50, p95, p99)
- Error rate by status code
- WebSocket connection count

**AI Service Performance Dashboard**
- LLM API call rate and latency
- Token consumption rate
- Budget burn rate and projection
- Investigation queue and success rate
- Vector store operation latency

**Database Health Dashboard**
- Connection pool utilization
- Query latency distribution
- Transaction rate
- Cache hit ratio
- Replication lag (PostgreSQL)

### Alert Rules

**Critical Alerts** (Page on-call immediately)

```yaml
groups:
  - name: kubilitics_critical
    interval: 1m
    rules:
      - alert: KubiliticsBackendDown
        expr: up{job="kubilitics-backend"} == 0
        for: 2m
        annotations:
          summary: "Kubilitics backend service is down"
          description: "Backend at {{ $labels.instance }} is not responding to health checks"

      - alert: KubiliticsAIServiceDown
        expr: up{job="kubilitics-ai"} == 0
        for: 5m
        annotations:
          summary: "Kubilitics AI service is down"

      - alert: DatabaseConnectionPoolExhausted
        expr: kubilitics_database_connections_active / kubilitics_database_connections_max > 0.95
        for: 5m
        annotations:
          summary: "Database connection pool utilization above 95%"

      - alert: TokenBudgetExhausted
        expr: ai_token_budget_remaining == 0
        for: 1m
        annotations:
          summary: "AI service monthly token budget exhausted"

      - alert: KubernetesAPIUnreachable
        expr: rate(kubilitics_kubernetes_api_failures_total[5m]) > 0.5
        for: 2m
        annotations:
          summary: "Kubernetes API server unreachable; >50% requests failing"
```

**Warning Alerts** (Send email/Slack notifications)

```yaml
groups:
  - name: kubilitics_warning
    interval: 5m
    rules:
      - alert: HighAPILatency
        expr: histogram_quantile(0.95, kubilitics_request_duration_seconds_bucket) > 1.0
        for: 10m
        annotations:
          summary: "API latency p95 > 1 second"

      - alert: HighErrorRate
        expr: rate(kubilitics_requests_total{status=~"5.."}[5m]) / rate(kubilitics_requests_total[5m]) > 0.05
        for: 5m
        annotations:
          summary: "Error rate > 5%"

      - alert: InvestigationTimeout
        expr: rate(kubilitics_investigation_timeout_total[1h]) > 5
        for: 10m
        annotations:
          summary: "Investigations timing out; >5 in last hour"

      - alert: TokenBudgetWarning
        expr: ai_token_budget_remaining / ai_token_budget_limit < 0.25
        for: 1m
        annotations:
          summary: "AI token budget < 25% remaining"

      - alert: HighCacheMemoryUsage
        expr: go_memstats_heap_alloc_bytes > 3e9
        for: 10m
        annotations:
          summary: "Process memory usage > 3GB"
```

### Structured Logging

All Kubilitics services emit structured JSON logs with the following fields:

```json
{
  "timestamp": "2026-02-10T14:23:45.123Z",
  "level": "INFO",
  "logger": "kubilitics.backend",
  "message": "Pod scaled successfully",
  "trace_id": "trace-abc123",
  "span_id": "span-def456",
  "request_id": "req-20260210-xyz789",
  "user_id": "user@example.com",
  "action": "scale_deployment",
  "resource_kind": "Deployment",
  "namespace": "default",
  "resource_name": "nginx",
  "previous_replicas": 3,
  "new_replicas": 5,
  "duration_ms": 245,
  "status": "success"
}
```

**Log Levels:**
- DEBUG: Detailed diagnostic information
- INFO: Significant application events
- WARN: Potentially harmful situations
- ERROR: Error conditions
- CRITICAL: Critical failures requiring immediate attention

**Correlation IDs:**
All requests include `trace_id` for tracing across services:
```bash
curl -H "X-Request-ID: req-20260210-abc123" http://localhost:8080/api/v1/namespaces
# All logs from this request chain include this request_id
```

---

## 4. Troubleshooting Playbooks

### Backend Won't Start

**Symptom:** Backend service fails to start; `PORT 8080 already in use` error

**Diagnosis:**
```bash
# Check if port is in use
lsof -i :8080
netstat -tuln | grep 8080

# Check backend logs
tail -100f ~/.kubilitics/kubilitics.log

# Check for other Kubilitics processes
ps aux | grep kubilitics
```

**Solutions:**
```bash
# Option 1: Kill process using port 8080
kill -9 <PID>

# Option 2: Start backend on different port
KUBILITICS_PORT=8090 kubilitics-backend

# Option 3: Check for concurrent Kubilitics instances
# Ensure no other Kubilitics processes running
ps aux | grep -i kubilitics | grep -v grep
```

**Symptom:** Kubeconfig file not found; authentication fails

**Diagnosis:**
```bash
# Check kubeconfig path
echo $KUBECONFIG
ls -la ~/.kube/config

# Verify kubeconfig validity
kubectl config view
kubectl config get-contexts
```

**Solutions:**
```bash
# Option 1: Create default kubeconfig location
mkdir -p ~/.kube
cp /path/to/valid/kubeconfig ~/.kube/config
chmod 600 ~/.kube/config

# Option 2: Explicitly specify kubeconfig path
KUBILITICS_KUBECONFIG_PATH=/path/to/kubeconfig kubilitics-backend

# Option 3: Import kubeconfig via UI (desktop app)
# Settings > Kubernetes > Import Kubeconfig
```

**Symptom:** Database locked error; SQLite concurrency issues

**Diagnosis:**
```bash
# Check database file
ls -la ~/.kubilitics/data.db*

# Check for stale lock files
ls -la ~/.kubilitics/data.db-*

# Verify disk space
df -h ~/.kubilitics/
```

**Solutions:**
```bash
# Option 1: Remove stale lock files (only if no processes running)
ps aux | grep kubilitics | grep -v grep
# Verify no processes, then:
rm -f ~/.kubilitics/data.db-shm ~/.kubilitics/data.db-wal

# Option 2: Migrate to PostgreSQL
KUBILITICS_DATABASE_TYPE=postgresql kubilitics-backend

# Option 3: Reduce concurrent connections
KUBILITICS_DATABASE_POOL_SIZE=5 kubilitics-backend
```

---

### AI Service Unreachable

**Symptom:** Error: `AI service not responding on http://localhost:8081`

**Diagnosis:**
```bash
# Check if AI service is running
ps aux | grep kubilitics-ai | grep -v grep

# Test connectivity
curl -X GET http://localhost:8081/health

# Check logs
tail -100f ~/.kubilitics/ai-service.log

# Verify port availability
netstat -tuln | grep 8081
```

**Solutions:**
```bash
# Option 1: Start AI service
kubilitics-ai --config ~/.kubilitics/ai-config.yaml

# Option 2: Check backend → AI service connectivity
KUBILITICS_AI_SERVICE_URL=http://localhost:8081 kubilitics-backend

# Option 3: Increase timeout (AI service slow to start)
KUBILITICS_AI_SERVICE_TIMEOUT=60 kubilitics-backend

# Option 4: Run in different terminal
terminal1: kubilitics-backend
terminal2: kubilitics-ai
```

**Symptom:** LLM provider unreachable; OpenAI API errors

**Diagnosis:**
```bash
# Check API key configuration
grep api_key ~/.kubilitics/ai-config.yaml

# Test LLM connectivity directly
curl -X POST https://api.openai.com/v1/models \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" | jq .

# Check AI service logs for API errors
tail -100f ~/.kubilitics/ai-service.log | grep -i "openai\|api\|error"

# Verify network access
ping api.openai.com
curl -I https://api.openai.com
```

**Solutions:**
```bash
# Option 1: Verify API key
echo "API Key configured: ${AI_LLM_API_KEY:0:10}****"
# If empty, set it:
export AI_LLM_API_KEY="sk-xxxxxx"

# Option 2: Check API key validity
curl -X GET https://api.openai.com/v1/models \
  -H "Authorization: Bearer sk-xxxxxx" | jq .

# Option 3: Switch LLM provider if primary is down
AI_LLM_PROVIDER=anthropic AI_LLM_API_KEY=claude-key kubilitics-ai

# Option 4: Use cached responses while provider recovers
# AI service automatically falls back to cached embeddings
# Wait 5-10 minutes, then retry

# Option 5: Check token budget
curl -X GET http://localhost:8081/api/v1/ai/status | jq .token_usage
```

---

### WebSocket Disconnections

**Symptom:** Real-time updates stop; WebSocket connection drops

**Diagnosis:**
```bash
# Check browser console for errors
# DevTools > Console > Look for WebSocket errors

# Verify WebSocket endpoint is accessible
curl -I http://localhost:8080/api/v1/ws

# Check network conditions
# DevTools > Network > WS filter for WebSocket connections

# Verify backend is running
curl http://localhost:8080/health
```

**Solutions:**
```bash
# Option 1: Verify WebSocket URL in frontend config
# Check REACT_APP_WS_URL environment variable
echo $REACT_APP_WS_URL

# Option 2: Check firewall/proxy for WebSocket support
# Ensure proxy allows WebSocket upgrade headers
# Verify no intermediary stripping Connection headers

# Option 3: Increase WebSocket keep-alive interval
# Default: 30 seconds; increase if frequent disconnects
KUBILITICS_WS_PING_INTERVAL=15 kubilitics-backend

# Option 4: Check client-side timeouts
# Browser: DevTools > Settings > Network > Disable cache
# Close all tabs and reopen

# Option 5: Restart backend service
# Drops all connections; clients will reconnect
systemctl restart kubilitics-backend
```

---

### High Memory Usage

**Symptom:** Backend memory usage grows without bound; process consuming 4-8GB RAM

**Diagnosis:**
```bash
# Check process memory
ps aux | grep kubilitics-backend | grep -v grep
top -p <PID>

# Check memory by component
# Frontend: browser DevTools > Memory > Take heap snapshot
# Backend: check go memstats
curl http://localhost:9090/metrics | grep go_memstats

# Check for memory leaks in topology cache
curl http://localhost:9090/metrics | grep kubilitics_cached_items_total
```

**Solutions:**
```bash
# Option 1: Reduce topology cache size for large clusters
KUBILITICS_TOPOLOGY_CACHE_DEPTH=1 kubilitics-backend  # Don't recursively load all resources

# Option 2: Reduce cache TTL
KUBILITICS_CACHE_TTL=60 kubilitics-backend  # More frequent invalidation

# Option 3: Increase GC pressure
GODEBUG=gctrace=1 kubilitics-backend  # Verbose GC logging

# Option 4: Limit concurrent investigations (reduces goroutines)
KUBILITICS_MAX_CONCURRENT_INVESTIGATIONS=2 kubilitics-backend

# Option 5: Switch to external cache (Redis)
KUBILITICS_CACHE_TYPE=redis KUBILITICS_REDIS_URL=redis://localhost:6379 kubilitics-backend

# Option 6: Restart service periodically (last resort)
# Add cron job: 0 2 * * * systemctl restart kubilitics-backend
```

---

### Slow API Responses

**Symptom:** API requests take 5-30+ seconds to complete

**Diagnosis:**
```bash
# Measure request latency
time curl http://localhost:8080/api/v1/namespaces

# Check Kubernetes API latency
curl http://localhost:9090/metrics | grep kubilitics_kubernetes_api_latency

# Check database query latency
curl http://localhost:9090/metrics | grep kubilitics_database_query_duration

# Identify slow endpoints
curl http://localhost:9090/metrics | grep kubilitics_request_duration | sort -t= -k5 -rn | head -10

# Check Kubernetes API server health
kubectl get --raw /healthz
kubectl top nodes
kubectl top pods --all-namespaces
```

**Solutions:**
```bash
# Option 1: Check Kubernetes API server health
# May be overloaded or slow
kubectl get apiserver
kubectl logs -n kube-apiserver <apiserver-pod>

# Option 2: Enable response caching
KUBILITICS_CACHE_TYPE=redis KUBILITICS_CACHE_TTL=300 kubilitics-backend

# Option 3: Reduce topology query depth for large clusters
KUBILITICS_TOPOLOGY_CACHE_DEPTH=1 kubilitics-backend

# Option 4: Optimize database queries
# For PostgreSQL: enable slow query logging
KUBILITICS_DATABASE_POSTGRESQL_LOG_MIN_DURATION_MS=1000

# Option 5: Add read replicas for database-heavy queries
# Configure secondary PostgreSQL read replicas
KUBILITICS_DATABASE_READ_REPLICAS=replica1.example.com,replica2.example.com

# Option 6: Scale backend horizontally
# Add more backend instances, put behind load balancer
helm upgrade kubilitics kubilitics/kubilitics \
  --set replicaCount=5 \
  -n kubilitics
```

---

### Desktop App Crashes

**Symptom:** Desktop app crashes on startup or during operation

**Diagnosis:**
```bash
# Check system logs
# macOS: log stream --predicate 'eventMessage contains[c] "kubilitics"'
# Windows: Event Viewer > Windows Logs > Application
# Linux: journalctl -e | grep kubilitics

# Check app logs
cat ~/.kubilitics/kubilitics.log
cat ~/.kubilitics/ui.log

# Check sidecar process
ps aux | grep kubilitics

# Verify system dependencies
# Check Go runtime version
kubilitics --version
```

**Solutions:**
```bash
# Option 1: Clear app cache and database
rm -rf ~/.kubilitics/
# Reinstall will recreate with clean state

# Option 2: Update to latest version
# Visit https://releases.kubilitics.io
# Download latest stable release

# Option 3: Check for corrupted database
# Back up then delete: ~/.kubilitics/data.db*

# Option 4: macOS specific - reset Gatekeeper
xattr -d com.apple.quarantine /Applications/Kubilitics.app

# Option 5: Windows specific - run as Administrator
# Right-click Kubilitics.exe > Run as Administrator
```

---

## 5. Backup & Recovery

### Database Backup Procedures

**SQLite Backup (Desktop)**
```bash
# Simple file copy (when not in use)
cp ~/.kubilitics/data.db ~/backups/kubilitics-$(date +%Y%m%d-%H%M%S).db.bak

# Atomic backup using SQLite backup API
sqlite3 ~/.kubilitics/data.db ".backup ~/backups/kubilitics-atomic.db.bak"

# Automated daily backups
cat >> ~/.kubilitics/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="$HOME/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 "$HOME/.kubilitics/data.db" ".backup $BACKUP_DIR/kubilitics-$TIMESTAMP.db.bak"
# Keep last 30 days of backups
find "$BACKUP_DIR" -name "kubilitics-*.db.bak" -mtime +30 -delete
EOF

crontab -e
# Add: 0 2 * * * /home/user/.kubilitics/backup.sh
```

**PostgreSQL Backup (Enterprise)**
```bash
# Full database dump
pg_dump -U kubilitics -h localhost kubilitics > kubilitics-$(date +%Y%m%d).sql

# Compressed backup (recommended)
pg_dump -U kubilitics -h localhost -Fc kubilitics > kubilitics-$(date +%Y%m%d).dump

# Automated backups with retention
cat > /etc/cron.daily/kubilitics-backup << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/kubilitics"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
pg_dump -U kubilitics -Fc kubilitics > "$BACKUP_DIR/kubilitics-$TIMESTAMP.dump"
# Keep last 30 days
find "$BACKUP_DIR" -name "kubilitics-*.dump" -mtime +30 -delete
EOF

chmod +x /etc/cron.daily/kubilitics-backup
```

**Kubernetes Backup (In-Cluster)**
```bash
# Backup persistent volume
kubectl get pvc -n kubilitics
kubectl exec -n kubilitics kubilitics-backend-0 -- \
  pg_dump -U kubilitics kubilitics | gzip > kubilitics-backup-$(date +%Y%m%d).sql.gz

# Backup etcd (entire cluster state)
ETCDCTL_API=3 etcdctl snapshot save kubilitics-backup-$(date +%Y%m%d).db
```

### Configuration Backup

```bash
# Backup application configuration
tar czf kubilitics-config-$(date +%Y%m%d).tar.gz \
  ~/.kubilitics/*.yaml \
  ~/.kube/config

# Backup Helm chart values
helm get values kubilitics -n kubilitics > kubilitics-values-$(date +%Y%m%d).yaml

# Backup AI investigation history
kubectl exec -n kubilitics kubilitics-backend-0 -- \
  sqlite3 /data/kubilitics.db ".dump investigations" > investigations-export.sql
```

### AI Investigation Data Export

```bash
# Export all investigations as JSON
curl -X GET "http://localhost:8080/api/v1/ai/investigations?limit=1000" \
  -H "Authorization: Bearer $TOKEN" | jq . > investigations-backup.json

# Export insights
curl -X GET "http://localhost:8080/api/v1/ai/insights?limit=1000" \
  -H "Authorization: Bearer $TOKEN" | jq . > insights-backup.json

# Bulk export with filtering
for investigation in $(curl -s "http://localhost:8080/api/v1/ai/investigations?limit=1000" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.items[].investigation_id'); do
  curl -s "http://localhost:8080/api/v1/ai/investigations/$investigation" \
    -H "Authorization: Bearer $TOKEN" | jq . > "investigation-$investigation.json"
done
```

### Disaster Recovery Steps

**Scenario: Database Corruption**

1. Stop all services
   ```bash
   systemctl stop kubilitics-backend kubilitics-ai
   ```

2. Restore from latest clean backup
   ```bash
   # SQLite
   rm ~/.kubilitics/data.db
   cp ~/backups/kubilitics-latest.db.bak ~/.kubilitics/data.db

   # PostgreSQL
   psql -U postgres -c "DROP DATABASE kubilitics;"
   createdb -U postgres kubilitics
   pg_restore -U postgres -d kubilitics kubilitics-latest.dump
   ```

3. Verify restore
   ```bash
   sqlite3 ~/.kubilitics/data.db "SELECT COUNT(*) FROM investigations;"
   ```

4. Restart services
   ```bash
   systemctl start kubilitics-backend kubilitics-ai
   curl http://localhost:8080/health
   ```

**Scenario: Complete Cluster Loss (In-Cluster)**

1. Backup PersistentVolume data (if accessible)
   ```bash
   kubectl get pv
   kubectl describe pv kubilitics-data-pv
   # Contact cloud provider for EBS/GCP snapshot recovery
   ```

2. Recreate storage
   ```bash
   # Create new PersistentVolume with restored snapshot
   kubectl apply -f kubilitics-pv-restored.yaml
   ```

3. Restore from external backups
   ```bash
   # Create PostgreSQL temporary pod
   kubectl run temp-postgres --image=postgres:15 \
     -n kubilitics -- sleep 3600

   # Copy backup into pod
   kubectl cp kubilitics-backup.dump \
     kubilitics/temp-postgres:/tmp/

   # Restore database
   kubectl exec -n kubilitics temp-postgres -- \
     pg_restore -U postgres -d kubilitics /tmp/kubilitics-backup.dump
   ```

4. Restart deployment
   ```bash
   kubectl delete pod -n kubilitics kubilitics-backend-0 kubilitics-ai-0
   kubectl get pods -n kubilitics  # Wait for new pods
   ```

---

## 6. Capacity Planning

### Resource Requirements by Cluster Size

**Small Cluster** (< 50 nodes, < 500 pods)

CPU Requirements:
- Backend: 100m-250m
- AI Service: 250m-500m (if enabled)
- Total: 350m-750m

Memory Requirements:
- Backend: 256Mi-512Mi
- Database: 256Mi-512Mi (SQLite)
- AI Service: 512Mi-1Gi
- Total: 1Gi-2Gi

Storage Requirements:
- Database: 5-50GB
- Logs (30-day retention): 10-20GB
- Vector Store (embeddings): 1-5GB
- Total: 16-75GB

**Medium Cluster** (< 500 nodes, < 5,000 pods)

CPU Requirements:
- Backend: 500m-1000m (3 replicas @ 167m-333m each)
- AI Service: 1000m-2000m (2 replicas @ 500m-1000m each)
- Database: 500m-1000m
- Total: 2-4 cores

Memory Requirements:
- Backend: 1Gi-2Gi per replica (3Gi-6Gi total)
- Database: 2Gi-4Gi (PostgreSQL)
- AI Service: 2Gi-4Gi per replica (4Gi-8Gi total)
- Cache: 1Gi-2Gi
- Total: 10-20Gi

Storage Requirements:
- Database: 50-200GB
- Logs: 50-100GB
- Vector Store: 10-50GB
- Total: 110-350GB

**Large Cluster** (> 500 nodes, > 5,000 pods)

CPU Requirements:
- Backend: 2-4 cores (5+ replicas)
- AI Service: 4-8 cores (3-5 replicas)
- Database: 2-4 cores
- Total: 8-16+ cores

Memory Requirements:
- Backend: 20-40Gi
- Database: 8-16Gi
- AI Service: 12-24Gi
- Cache: 4-8Gi
- Total: 44-88Gi

Storage Requirements:
- Database: 500GB-2TB
- Logs: 200GB-500GB
- Vector Store: 100GB-500GB
- Total: 800GB-3TB

### Database Sizing Guide

**SQLite Sizing**
- Max database file: 1TB (practical limit)
- Max concurrent connections: ~10-20
- Throughput: ~1,000-5,000 queries/second
- Best for: Single-user, small deployments
- Backup: Simple file copy

**PostgreSQL Sizing**
- Storage multiplier: 2-3x raw data size (indexes, WAL)
- Connection pool: 20-50 connections typical
- Throughput: 50,000+ queries/second with proper tuning
- Replication: Use asynchronous replication for read scaling
- High-availability: Use multi-zone PostgreSQL with failover

**Backup Storage Sizing**
- Assume 20-30% of database size per daily backup
- Example: 100GB database → 20-30GB per backup
- Retention: 30 days typical = 600-900GB storage
- Budget: Multiply by 1.5 for compression overhead

### Scaling Recommendations

**Horizontal Scaling (Add Instances)**
- Backend: Stateless; add replicas via Helm or Kubernetes
- AI Service: Increases concurrent investigation capacity
- Load balancer: Distribute across replicas
- Database: Use read replicas for query scaling

**Vertical Scaling (Bigger Machines)**
- Backend: Benefits from more CPU (caching, processing)
- AI Service: Benefits from more memory (vector embeddings)
- Database: Vertical scaling recommended (network I/O improvements)

**Auto-Scaling Configuration**
```yaml
# Kubernetes HorizontalPodAutoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: kubilitics-backend-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: kubilitics-backend
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

---

## 7. Security Operations

### Certificate Rotation

**TLS Certificate Rotation (Desktop)**
```bash
# Generate new self-signed certificate (90-day validity)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 90 \
  -subj "/CN=localhost"

# Copy to Kubilitics config
cp cert.pem ~/.kubilitics/tls.cert
cp key.pem ~/.kubilitics/tls.key
chmod 600 ~/.kubilitics/tls.key

# Restart backend (certificate loaded on startup)
systemctl restart kubilitics-backend
```

**TLS Certificate Rotation (In-Cluster with cert-manager)**
```bash
# cert-manager automatically rotates certificates 30 days before expiration
kubectl get certificate -n kubilitics

# Manual rotation if needed
kubectl delete certificate kubilitics-tls -n kubilitics
kubectl apply -f kubilitics-certificate.yaml  # Redeploy
kubectl get certificate -n kubilitics -w  # Wait for Ready
```

### API Key Rotation

**LLM Provider API Key Rotation**
```bash
1. Generate new API key in LLM provider console (OpenAI, Anthropic, etc.)
2. Update configuration:
   - Desktop: Settings > LLM Configuration > API Key
   - In-cluster: kubectl edit secret llm-config -n kubilitics
   - Environment: export AI_LLM_API_KEY=new-key

3. Verify new key works:
   curl -X GET http://localhost:8081/api/v1/ai/status

4. Revoke old key in LLM provider console
```

**Service Account Token Rotation**
```bash
# Generate new service account token
kubectl create serviceaccount kubilitics-api -n kubilitics
kubectl create rolebinding kubilitics-api-role \
  --clusterrole=kubilitics-api-role \
  --serviceaccount=kubilitics-api

# Get new token
kubectl get secret $(kubectl get secret -n kubilitics -o jsonpath='{.items[0].metadata.name}' \
  -l serviceaccount=kubilitics-api) -o jsonpath='{.data.token}' | base64 -d

# Update in configuration:
# Environment: export KUBILITICS_API_TOKEN=new-token
# Or: kubectl patch secret api-token -n kubilitics \
#       -p '{"data":{"token":"new-token-base64"}}'

# Restart services
kubectl delete pod -n kubilitics -l app=kubilitics-backend
```

### RBAC Auditing

**Check RBAC Permissions**
```bash
# List all RBAC bindings
kubectl get rolebindings,clusterrolebindings -A

# Check specific user permissions
kubectl auth can-i list pods --as=user@example.com
kubectl auth can-i delete pods --as=user@example.com -n default

# Generate RBAC audit report
kubectl get clusterrolebindings -o json | jq -r '.items[] | select(.subjects[0].kind=="User") | "\(.metadata.name): \(.subjects[0].name)"'
```

**Restrict Kubilitics Service Account**
```yaml
# Create minimal RBAC role
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kubilitics-minimal
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["nodes", "events"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kubilitics-minimal-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kubilitics-minimal
subjects:
  - kind: ServiceAccount
    name: kubilitics
    namespace: kubilitics
```

### Security Patching Procedures

**Monitor for Security Updates**
```bash
# Check for available updates
helm repo update
helm search repo kubilitics --versions

# Subscribe to security mailing list
# Visit: https://kubilitics.io/security

# Monitor CVE databases
# https://nvd.nist.gov/
# https://security.snyk.io/
```

**Apply Security Patches**

1. **Non-Critical Patch** (e.g., bug fix)
   ```bash
   # Standard upgrade process
   helm upgrade kubilitics kubilitics/kubilitics --version 1.0.1 -n kubilitics
   kubectl rollout status deployment/kubilitics-backend -n kubilitics
   ```

2. **Security Patch** (e.g., vulnerability)
   ```bash
   # Urgent upgrade with immediate rollout
   helm upgrade kubilitics kubilitics/kubilitics --version 1.0.2 -n kubilitics

   # Monitor for issues with rolling pod restart
   kubectl get pods -n kubilitics -w

   # If issues occur, rollback immediately
   helm rollback kubilitics -n kubilitics
   ```

3. **Critical Security Patch** (e.g., remote code execution)
   ```bash
   # Maximum priority; upgrade immediately across all instances
   # 1. Notify users (incident alert)
   # 2. Upgrade production
   helm upgrade kubilitics kubilitics/kubilitics --version 1.0.3 -n kubilitics --force

   # 3. Verify no security issues
   kubectl get pods -n kubilitics
   curl https://kubilitics.example.com/health

   # 4. Update development/staging
   # 5. Notify completion to security team
   ```

**Dependency Vulnerability Scanning**
```bash
# Scan container images for vulnerabilities
trivy image kubilitics/backend:1.0.0
trivy image kubilitics/ai-service:1.0.0

# Scan Helm chart dependencies
helm template kubilitics kubilitics/kubilitics | trivy config -
```

---

## Incident Escalation & Support

**For Critical Production Issues:**
1. Page on-call engineer immediately
2. Escalate to engineering manager if not resolved in 15 minutes
3. Notify customers of status via status page
4. Provide hourly updates until resolution

**Support Channels:**
- Email: support@kubilitics.io
- Slack: #kubilitics-support (enterprise customers)
- Documentation: https://docs.kubilitics.io
- Community: https://community.kubilitics.io

**Emergency Contacts:**
- On-call: PagerDuty (kubilitics-prod)
- VP Engineering: (See internal directory)
- CEO: (See internal directory)

