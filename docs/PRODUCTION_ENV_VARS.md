# Production Environment Variables Reference

This document provides a comprehensive reference for all environment variables used by Kubilitics services in production deployments.

## Overview

Kubilitics consists of three main services:
- **Backend** (`kubilitics-backend`) - Core Kubernetes API proxy and data layer
- **Frontend** (`kubilitics-frontend`) - Web UI (React/Vite)

Each service has its own set of environment variables for configuration.

---

## Backend (kubilitics-backend)

### Required Environment Variables

| Variable | Default | Description | Required |
|----------|---------|-------------|----------|
| `KUBILITICS_PORT` | `819` | HTTP server port | No (uses default) |
| `KUBECONFIG` | `~/.kube/config` | Path to kubeconfig file | No (uses in-cluster config if available) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KUBILITICS_DATABASE_PATH` | `./kubilitics.db` | SQLite database file path |
| `KUBILITICS_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `KUBILITICS_LOG_FORMAT` | `json` | Log format: `json` or `text` |
| `KUBILITICS_ALLOWED_ORIGINS` | `localhost:5173,localhost:819` | Comma-separated CORS origins |
| `KUBILITICS_REQUEST_TIMEOUT_SEC` | `30` | HTTP request timeout in seconds |
| `KUBILITICS_TOPOLOGY_TIMEOUT_SEC` | `30` | Topology generation timeout |
| `KUBILITICS_MAX_CLUSTERS` | `100` | Maximum number of clusters |
| `KUBILITICS_K8S_TIMEOUT_SEC` | `15` | Kubernetes API call timeout |
| `KUBILITICS_TLS_ENABLED` | `false` | Enable TLS/HTTPS |
| `KUBILITICS_TLS_CERT_PATH` | `""` | Path to TLS certificate (required if TLS enabled) |
| `KUBILITICS_TLS_KEY_PATH` | `""` | Path to TLS private key (required if TLS enabled) |
| `KCLI_BIN` | `""` | Path to kcli binary (if not in PATH) |
| `KUBILITICS_KCLI_RATE_LIMIT_PER_SEC` | `12.0` | kcli API rate limit (requests/second) |
| `KUBILITICS_KCLI_RATE_LIMIT_BURST` | `24` | kcli API burst limit |
| `KUBILITICS_KCLI_STREAM_MAX_CONNS` | `4` | Max concurrent kcli stream connections per cluster |
| `KUBILITICS_KCLI_ALLOW_SHELL_MODE` | `false` | Allow interactive shell mode |

### Production Example

```bash
export KUBILITICS_PORT=819
export KUBILITICS_DATABASE_PATH=/data/kubilitics.db
export KUBILITICS_LOG_LEVEL=info
export KUBILITICS_LOG_FORMAT=json
export KUBILITICS_ALLOWED_ORIGINS="https://kubilitics.example.com"
export KUBILITICS_TLS_ENABLED=true
export KUBILITICS_TLS_CERT_PATH=/etc/tls/tls.crt
export KUBILITICS_TLS_KEY_PATH=/etc/tls/tls.key
```

---

## AI Backend (kubilitics-ai)

### Required Environment Variables

| Variable | Default | Description | Required |
|----------|---------|-------------|----------|
| `KUBILITICS_HTTP_PORT` | `8081` | HTTP server port | No (uses default) |
| `KUBILITICS_BACKEND_URL` | `http://localhost:819` | Backend HTTP URL for MCP server calls | No (uses default) |
| `KUBILITICS_BACKEND_ADDRESS` | `localhost:50051` | Backend gRPC address | No (uses default) |
| `KUBILITICS_LLM_PROVIDER` | `openai` | LLM provider: `openai`, `anthropic`, `ollama`, `custom` | Yes (if using LLM features) |
| `OPENAI_API_KEY` | `""` | OpenAI API key | Yes (if provider is `openai`) |
| `ANTHROPIC_API_KEY` | `""` | Anthropic API key | Yes (if provider is `anthropic`) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KUBILITICS_GRPC_PORT` | `9090` | gRPC server port (if used) |
| `KUBILITICS_HOST` | `0.0.0.0` | Server bind address |
| `KUBILITICS_BACKEND_TIMEOUT` | `30` | Backend connection timeout (seconds) |
| `KUBILITICS_BACKEND_TLS_ENABLED` | `false` | Use TLS for backend connection |
| `KUBILITICS_LLM_MODEL` | `""` | LLM model name (provider-specific) |
| `KUBILITICS_LLM_BASE_URL` | `""` | Custom LLM API base URL |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama instance URL |
| `KUBILITICS_AUTONOMY_LEVEL` | `3` | Default autonomy level (1-5) |
| `KUBILITICS_ENABLE_SAFETY` | `true` | Enable safety engine |
| `KUBILITICS_ENABLE_MCP` | `true` | Enable MCP server |
| `KUBILITICS_ENABLE_ANALYTICS` | `true` | Enable analytics engine |
| `KUBILITICS_DATABASE_PATH` | `/var/lib/kubilitics/kubilitics-ai.db` | SQLite database path |
| `KUBILITICS_DATABASE_TYPE` | `sqlite` | Database type: `sqlite` or `postgres` |
| `KUBILITICS_WS_ALLOWED_ORIGINS` | `localhost:3000,localhost:5173` | Comma-separated WebSocket allowed origins |

### Production Example

```bash
export KUBILITICS_HTTP_PORT=8081
export KUBILITICS_BACKEND_URL=http://kubilitics-backend:819
export KUBILITICS_BACKEND_ADDRESS=kubilitics-backend:50051
export KUBILITICS_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-api03-...
export KUBILITICS_DATABASE_PATH=/var/lib/kubilitics/kubilitics-ai.db
export KUBILITICS_AUTONOMY_LEVEL=2
export KUBILITICS_WS_ALLOWED_ORIGINS="https://kubilitics.example.com"
```

---

## Frontend (kubilitics-frontend)

### Required Environment Variables

| Variable | Default | Description | Required |
|----------|---------|-------------|----------|
| `VITE_BACKEND_URL` | `http://localhost:819` | Backend API base URL | Yes (production) |
| `VITE_AI_BACKEND_URL` | `http://localhost:8081` | AI backend API base URL | No (if AI features disabled) |
| `VITE_AI_WS_URL` | `ws://localhost:8081` | AI backend WebSocket URL | No (if AI features disabled) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_BACKEND_PORT` | `819` | Backend port (for Vite proxy in dev) |
| `VITE_API_BASE` | `""` | Alternative backend URL (overrides VITE_BACKEND_URL) |
| `VITE_PORT` | `5173` | Vite dev server port |

### Production Example

```bash
# Build-time variables (must be set during `npm run build`)
export VITE_BACKEND_URL=https://api.kubilitics.example.com
export VITE_AI_BACKEND_URL=https://ai.kubilitics.example.com
export VITE_AI_WS_URL=wss://ai.kubilitics.example.com
```

**Note:** Vite environment variables must be prefixed with `VITE_` and are embedded at build time. They cannot be changed at runtime.

---

## Helm Chart Deployment

When deploying via Helm chart, environment variables are set through `values.yaml`:

### Backend Environment Variables (Helm)

| Helm Value | Environment Variable | Default |
|------------|---------------------|---------|
| `config.port` | `KUBILITICS_PORT` | `819` |
| `config.databasePath` | `KUBILITICS_DATABASE_PATH` | `/data/kubilitics.db` |
| `config.logLevel` | `KUBILITICS_LOG_LEVEL` | `info` |
| `config.allowedOrigins` | `KUBILITICS_ALLOWED_ORIGINS` | `https://your-domain.com` |
| `config.tlsEnabled` | `KUBILITICS_TLS_ENABLED` | `false` |

### AI Backend Environment Variables (Helm)

| Helm Value | Environment Variable | Default |
|------------|---------------------|---------|
| `ai.config.serverPort` | `KUBILITICS_HTTP_PORT` | `8081` |
| `ai.config.backendHttpUrl` | `KUBILITICS_BACKEND_URL` | `http://kubilitics:819` |
| `ai.config.backendAddress` | `KUBILITICS_BACKEND_ADDRESS` | `kubilitics:50051` |
| `ai.config.llmProvider` | `KUBILITICS_LLM_PROVIDER` | `anthropic` |
| `ai.secret.anthropicApiKey` | `ANTHROPIC_API_KEY` | (from Secret) |
| `ai.secret.openaiApiKey` | `OPENAI_API_KEY` | (from Secret) |

### Frontend Environment Variables (Helm)

Frontend environment variables are set via ConfigMap and injected as build-time variables:

| Helm Value | Environment Variable | Default |
|------------|---------------------|---------|
| `frontend.config.backendService` | `BACKEND_SERVICE` | `kubilitics` |
| `frontend.config.backendPort` | `BACKEND_PORT` | `819` |
| `frontend.config.aiBackendService` | `AI_BACKEND_SERVICE` | `kubilitics-ai` |
| `frontend.config.aiBackendPort` | `AI_BACKEND_PORT` | `8081` |

**Note:** Frontend uses nginx to proxy requests, so these are nginx configuration variables, not Vite env vars.

---

## Kubernetes Deployment Examples

### Backend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubilitics-backend
spec:
  template:
    spec:
      containers:
      - name: backend
        image: ghcr.io/kubilitics/kubilitics-backend:1.0.0
        env:
        - name: KUBILITICS_PORT
          value: "819"
        - name: KUBILITICS_DATABASE_PATH
          value: "/data/kubilitics.db"
        - name: KUBILITICS_LOG_LEVEL
          value: "info"
        - name: KUBILITICS_ALLOWED_ORIGINS
          value: "https://kubilitics.example.com"
```

### AI Backend Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubilitics-ai
spec:
  template:
    spec:
      containers:
      - name: ai-backend
        image: ghcr.io/kubilitics/kubilitics-ai:1.0.0
        env:
        - name: KUBILITICS_HTTP_PORT
          value: "8081"
        - name: KUBILITICS_BACKEND_URL
          value: "http://kubilitics-backend:819"
        - name: KUBILITICS_BACKEND_ADDRESS
          value: "kubilitics-backend:50051"
        - name: KUBILITICS_LLM_PROVIDER
          value: "anthropic"
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: kubilitics-ai-secret
              key: anthropic-api-key
```

---

## Docker Compose Example

```yaml
version: '3.8'
services:
  backend:
    image: ghcr.io/kubilitics/kubilitics-backend:1.0.0
    environment:
      KUBILITICS_PORT: 819
      KUBILITICS_DATABASE_PATH: /data/kubilitics.db
      KUBILITICS_LOG_LEVEL: info
    ports:
      - "819:819"
  
  ai-backend:
    image: ghcr.io/kubilitics/kubilitics-ai:1.0.0
    environment:
      KUBILITICS_HTTP_PORT: 8081
      KUBILITICS_BACKEND_URL: http://backend:819
      KUBILITICS_BACKEND_ADDRESS: backend:50051
      KUBILITICS_LLM_PROVIDER: anthropic
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    ports:
      - "8081:8081"
    depends_on:
      - backend
  
  frontend:
    build:
      context: ./kubilitics-frontend
      args:
        VITE_BACKEND_URL: http://localhost:819
        VITE_AI_BACKEND_URL: http://localhost:8081
    ports:
      - "5173:80"
```

---

## Environment Variable Priority

Environment variables override configuration file values in the following order (highest to lowest priority):

1. **Environment variables** (highest priority)
2. **Configuration file** (`/etc/kubilitics/config.yaml` or `--config` flag)
3. **Built-in defaults** (lowest priority)

---

## Security Best Practices

### Secrets Management

**Never commit API keys or secrets to version control.**

1. **Kubernetes Secrets:**
   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: kubilitics-ai-secret
   type: Opaque
   stringData:
     anthropic-api-key: sk-ant-api03-...
   ```

2. **Environment Variables (Local Development):**
   ```bash
   # Use .env file (gitignored)
   echo "ANTHROPIC_API_KEY=sk-ant-api03-..." >> .env
   ```

3. **CI/CD Secrets:**
   - Store secrets in GitHub Secrets, GitLab CI/CD variables, or similar
   - Never echo secrets in logs
   - Use secret management tools (HashiCorp Vault, AWS Secrets Manager, etc.)

### Production Checklist

- [ ] All API keys stored in Kubernetes Secrets or secret management system
- [ ] TLS enabled for all services (`KUBILITICS_TLS_ENABLED=true`)
- [ ] TLS certificates mounted from Secrets
- [ ] CORS origins restricted to production domain (`KUBILITICS_ALLOWED_ORIGINS`)
- [ ] Database path uses persistent volume (`/data/kubilitics.db`)
- [ ] Log level set to `info` or `warn` (not `debug`)
- [ ] Log format set to `json` for log aggregation
- [ ] Backend URL uses service name in Kubernetes (`http://kubilitics-backend:819`)
- [ ] AI backend URL uses service name (`http://kubilitics-ai:8081`)

---

## Troubleshooting

### Backend Not Starting

```bash
# Check if port is already in use
lsof -i :819

# Check environment variables
env | grep KUBILITICS

# Check logs
kubectl logs -l app.kubernetes.io/component=backend
```

### AI Backend Cannot Connect to Backend

```bash
# Verify backend URL is correct
echo $KUBILITICS_BACKEND_URL  # Should be http://kubilitics-backend:819 in K8s

# Test connectivity from AI pod
kubectl exec -it <ai-pod> -- curl http://kubilitics-backend:819/health

# Check DNS resolution
kubectl exec -it <ai-pod> -- nslookup kubilitics-backend
```

### Frontend Cannot Connect to Backend

```bash
# Verify build-time variables
cat kubilitics-frontend/.env.production

# Check browser console for CORS errors
# Verify KUBILITICS_ALLOWED_ORIGINS includes frontend domain

# Test backend health
curl https://api.kubilitics.example.com/health
```

---

## Quick Reference

### Development (Local)

```bash
# Backend
export KUBILITICS_PORT=819
cd kubilitics-backend && go run ./cmd/server

# AI Backend
export KUBILITICS_HTTP_PORT=8081
export KUBILITICS_BACKEND_URL=http://localhost:819
export ANTHROPIC_API_KEY=sk-ant-api03-...
cd kubilitics-ai && go run ./cmd/server

# Frontend
export VITE_BACKEND_URL=http://localhost:819
export VITE_AI_BACKEND_URL=http://localhost:8081
cd kubilitics-frontend && npm run dev
```

### Production (Kubernetes)

```bash
# Install via Helm
helm install kubilitics ./deploy/helm/kubilitics \
  --set config.port=819 \
  --set config.allowedOrigins="https://kubilitics.example.com" \
  --set ai.enabled=true \
  --set ai.config.backendHttpUrl=http://kubilitics:819 \
  --set ai.secret.enabled=true \
  --set ai.secret.anthropicApiKey=<your-key>
```

---

## Related Documentation

- [Integration Ports Reference](INTEGRATION_PORTS.md) - Port configuration details
- [Helm Chart README](../deploy/helm/kubilitics/README.md) - Helm deployment guide
- [Backend Configuration](../kubilitics-backend/CONFIGURATION.md) - Backend configuration reference
- [AI Backend README](../kubilitics-ai/README.md) - AI backend configuration
