# Kubilitics Deployment Guide

Step-by-step instructions for deploying Kubilitics v0.1.1 across all supported modes.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Desktop Mode (Local)](#desktop-mode-local)
4. [Development Mode](#development-mode)
5. [In-Cluster Mode (Helm)](#in-cluster-mode-helm)
6. [Docker Compose (Standalone)](#docker-compose-standalone)
7. [Configuration Reference](#configuration-reference)
8. [Verification Checklist](#verification-checklist)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Go | 1.25.0+ | Build backend and kcli |
| Node.js | 18+ | Build frontend |
| npm | 9+ | Frontend dependencies |
| kubectl | 1.28+ | Kubernetes CLI |
| Helm | 3.12+ | In-cluster deployment |
| Docker | 24+ | Container builds |
| Rust/Cargo | 1.75+ | Desktop app (Tauri) |

---

## Architecture Overview

```
                    +-------------------+
                    |  kubilitics-frontend  |
                    |  React + Vite SPA     |
                    |  Port: 5173 (dev)     |
                    +---------+---------+
                              |
                    +---------v---------+
                    |  kubilitics-backend   |
                    |  Go REST + WebSocket  |
                    |  Port: 819            |
                    |  SQLite database      |
                    +---------+---------+
                              |
              +---------------+---------------+
              |                               |
    +---------v---------+           +---------v---------+
    |  Kubernetes API    |           |  kubilitics-ai     |
    |  (your cluster)    |           |  AI backend         |
    |                    |           |  Port: 8081         |
    +--------------------+           +--------------------+
```

**Services:**

| Service | Port | Description |
|---------|------|-------------|
| kubilitics-backend | 819 | Core API, WebSocket streams, SQLite storage |
| kubilitics-ai | 8081 | AI analysis, cost estimation (optional) |
| kubilitics-frontend | 5173 | React SPA (dev server) |
| kcli | N/A | CLI binary, embedded in backend streams |

---

## Desktop Mode (Local)

The simplest way to run Kubilitics. The Tauri desktop app bundles all services as sidecars.

### Step 1: Build the kcli binary

```bash
cd kcli
go build -o bin/kcli ./cmd/kcli
```

### Step 2: Build the backend

```bash
cd kubilitics-backend
go build -o bin/kubilitics-backend ./cmd/server
```

### Step 3: Build the frontend

```bash
cd kubilitics-frontend
npm install
npm run build
```

### Step 4: Build the desktop app

```bash
cd kubilitics-desktop
npm install
npm run build
```

The built app is at `kubilitics-desktop/src-tauri/target/release/bundle/`.

### Step 5: Launch

Open `Kubilitics.app` (macOS) or run the binary directly. The app:
- Auto-detects `~/.kube/config`
- Starts backend sidecar on port 819
- Starts AI sidecar on port 8081
- Opens the frontend in a native window

---

## Development Mode

Run all services locally for development.

### Step 1: Start the backend

```bash
cd kubilitics-backend
go build -o bin/kubilitics-backend ./cmd/server
./bin/kubilitics-backend
```

Verify: `curl http://127.0.0.1:819/health`

Expected response:
```json
{"status": "healthy", "service": "kubilitics-backend", "port": 819}
```

### Step 2: Build kcli (required for shell/TUI features)

```bash
cd kcli
go build -o bin/kcli ./cmd/kcli
```

The backend auto-discovers kcli at `../kcli/bin/kcli` relative to its working directory.

### Step 3: Start the AI backend (optional)

```bash
cd kubilitics-ai
go run ./cmd/server
```

Verify: `curl http://127.0.0.1:8081/health`

### Step 4: Start the frontend dev server

```bash
cd kubilitics-frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### Step 5: Connect a cluster

1. Open the app at `http://localhost:5173`
2. Click **Launch Desktop** on the welcome screen
3. Click **Auto-Detect** or select a cluster from the list
4. Click the cluster's **Connect** button

### Step 6: Verify the shell

1. Click the **Shell** button in the header bar
2. The kcli Bubble Tea TUI should appear with your pods
3. Type `:ns` to see namespaces, select one, press Enter
4. Pods should reload for the selected namespace

---

## In-Cluster Mode (Helm)

Deploy Kubilitics inside a Kubernetes cluster for team-wide access.

### Step 1: Add the Helm chart

```bash
cd deploy/helm
```

### Step 2: Review and customize values

```bash
cp kubilitics/values.yaml my-values.yaml
```

Key values to configure:

```yaml
# my-values.yaml

replicaCount: 1

image:
  repository: ghcr.io/kubilitics/kubilitics-backend
  tag: "0.1.1"
  pullPolicy: IfNotPresent

# Service configuration
service:
  type: ClusterIP
  port: 819

# Ingress (optional - for external access)
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: kubilitics.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: kubilitics-tls
      hosts:
        - kubilitics.example.com

# Environment variables
env:
  KUBILITICS_LOG_LEVEL: info
  KUBILITICS_LOG_FORMAT: json
  KUBILITICS_ALLOWED_ORIGINS: "https://kubilitics.example.com"

# AI backend (optional)
ai:
  enabled: false
  image:
    repository: ghcr.io/kubilitics/kubilitics-ai
    tag: "0.1.1"

# PostgreSQL (optional - defaults to SQLite)
postgresql:
  enabled: false
```

### Step 3: Install

```bash
helm install kubilitics deploy/helm/kubilitics \
  -f my-values.yaml \
  --namespace kubilitics \
  --create-namespace
```

### Step 4: Verify

```bash
# Check pods are running
kubectl get pods -n kubilitics

# Check the service
kubectl get svc -n kubilitics

# Port-forward to test locally
kubectl port-forward -n kubilitics svc/kubilitics 819:819

# Health check
curl http://127.0.0.1:819/health
```

### Step 5: Access

If ingress is configured:
```
https://kubilitics.example.com
```

If using port-forward:
```
http://127.0.0.1:819
```

### Upgrade

```bash
helm upgrade kubilitics deploy/helm/kubilitics \
  -f my-values.yaml \
  --namespace kubilitics
```

### Uninstall

```bash
helm uninstall kubilitics --namespace kubilitics
```

---

## Docker Compose (Standalone)

For running outside Kubernetes with Docker.

### Step 1: Build images

```bash
# Backend
docker build -t kubilitics-backend:0.1.1 -f kubilitics-backend/Dockerfile .

# AI backend (optional)
docker build -t kubilitics-ai:0.1.1 -f kubilitics-ai/Dockerfile .

# Frontend
docker build -t kubilitics-frontend:0.1.1 -f kubilitics-frontend/Dockerfile .
```

### Step 2: Run

```bash
docker run -d \
  --name kubilitics-backend \
  -p 819:819 \
  -v $HOME/.kube/config:/root/.kube/config:ro \
  -e KUBILITICS_PORT=819 \
  -e KUBILITICS_LOG_LEVEL=info \
  kubilitics-backend:0.1.1
```

---

## Configuration Reference

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KUBILITICS_PORT` | `819` | HTTP server port |
| `KUBECONFIG` | `~/.kube/config` | Path to kubeconfig |
| `KUBILITICS_DATABASE_PATH` | `./kubilitics.db` | SQLite database path |
| `KUBILITICS_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `KUBILITICS_LOG_FORMAT` | `json` | Log format: json or text |
| `KUBILITICS_ALLOWED_ORIGINS` | `localhost:5173,localhost:819` | CORS allowed origins |
| `KUBILITICS_TLS_ENABLED` | `false` | Enable HTTPS |
| `KUBILITICS_TLS_CERT_PATH` | `""` | TLS certificate path |
| `KUBILITICS_TLS_KEY_PATH` | `""` | TLS private key path |
| `KCLI_BIN` | `""` | Path to kcli binary |
| `KUBILITICS_KCLI_ALLOW_SHELL_MODE` | `false` | Allow interactive shell mode |
| `KUBILITICS_KCLI_STREAM_MAX_CONNS` | `4` | Max concurrent kcli streams per cluster |
| `KUBILITICS_K8S_TIMEOUT_SEC` | `15` | Kubernetes API call timeout |

### AI Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KUBILITICS_HTTP_PORT` | `8081` | AI service HTTP port |
| `KUBILITICS_BACKEND_URL` | `http://localhost:819` | Backend URL for API calls |
| `AI_PROVIDER` | `""` | AI provider: openai, anthropic, ollama, custom |
| `AI_MODEL` | `""` | Model name (e.g., gpt-4, claude-sonnet-4-20250514) |
| `AI_API_KEY` | `""` | AI provider API key |

### Port Summary

| Service | Port | Protocol |
|---------|------|----------|
| Backend HTTP | 819 | HTTP/WS |
| Backend gRPC | 50051 | gRPC |
| AI Backend HTTP | 8081 | HTTP/WS |
| Frontend Dev | 5173 | HTTP |

---

## Verification Checklist

After deployment, verify each component:

### 1. Backend Health

```bash
curl -s http://HOST:819/health | jq .
# Expected: {"status": "healthy", ...}
```

### 2. Cluster Discovery

```bash
curl -s http://HOST:819/api/v1/clusters | jq '.[].name'
# Expected: list of cluster names from kubeconfig
```

### 3. Resource Access

```bash
# Replace CLUSTER_ID with actual ID from step 2
curl -s http://HOST:819/api/v1/clusters/CLUSTER_ID/resources/pods | jq '.items | length'
# Expected: number > 0
```

### 4. WebSocket Streams

Open the app in a browser, click **Shell** in the header. You should see:
- **CONNECTED** green badge
- **KCLI READY** green badge
- The Bubble Tea TUI with a pods list
- Keyboard shortcuts at the bottom

### 5. Namespace Switching

In the kcli TUI:
1. Type `:ns` and press Enter to see namespaces
2. Use `j`/`k` to navigate, press Enter on a namespace
3. Pods should reload for the selected namespace
4. Header should show the new namespace

### 6. AI Backend (if enabled)

```bash
curl -s http://HOST:8081/health | jq .
# Expected: {"status": "healthy"}
```

---

## Troubleshooting

### Backend won't start

```bash
# Check if port 819 is in use
lsof -ti :819

# Kill existing process
lsof -ti :819 | xargs kill -9

# Check logs
./bin/kubilitics-backend 2>&1 | head -50
```

### WebSocket connection fails

1. Check browser console for origin errors
2. Verify `KUBILITICS_ALLOWED_ORIGINS` includes your frontend URL
3. For development: origins should include `http://localhost:5173` and `http://127.0.0.1:5173`

### Shell panel shows "disconnected"

1. Verify backend is running: `curl http://127.0.0.1:819/health`
2. Verify kcli binary exists: `ls -la kcli/bin/kcli`
3. Check backend logs for kcli binary resolution errors
4. Set `KCLI_BIN` env var to the absolute path of the kcli binary

### Namespace switching doesn't work

1. Ensure you're using kcli v0.1.1 (rebuild: `cd kcli && go build -o bin/kcli ./cmd/kcli`)
2. Restart the backend after rebuilding kcli
3. Close and reopen the shell panel

### Helm deployment pods crashlooping

```bash
kubectl logs -n kubilitics deployment/kubilitics --tail=50
kubectl describe pod -n kubilitics -l app=kubilitics
```

Common causes:
- Missing kubeconfig / RBAC permissions
- Port conflicts
- Missing TLS certificates when TLS is enabled

### Database errors

```bash
# Reset database (warning: loses all data)
rm kubilitics.db kubilitics.db-shm kubilitics.db-wal
```

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.1.1 | 2026-03-02 | Production release: namespace switching, shell stability, UI hardening |

---

For additional documentation see:
- [Architecture](ARCHITECTURE.md)
- [Production Environment Variables](PRODUCTION_ENV_VARS.md)
- [Integration Ports](INTEGRATION_PORTS.md)
- [Release Standards](RELEASE-STANDARDS.md)
- [Troubleshooting kcli](TROUBLESHOOTING_KCLI.md)
