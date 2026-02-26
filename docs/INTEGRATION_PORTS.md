# Kubilitics Integration Ports Reference

This document provides a comprehensive reference for all ports used by Kubilitics services and how to configure them.

## Port Assignment Summary

| Service | Default Port | Purpose | Environment Variable |
|---------|-------------|---------|---------------------|
| **Backend** | `819` | REST API and gRPC server | `KUBILITICS_PORT` |
| **AI Backend** | `8081` | AI service HTTP API and WebSocket | `KUBILITICS_HTTP_PORT` |
| **Frontend** | `5173` | Development server (Vite) | N/A (Vite default) |
| **Backend gRPC** | `50051` | gRPC streaming connection | `KUBILITICS_GRPC_PORT` (backend) |
| **AI Backend gRPC** | `9090` | AI service gRPC (if used) | `KUBILITICS_GRPC_PORT` (AI) |

## Service Details

### Backend (kubilitics-backend)

- **HTTP Port**: `819` (default)
- **gRPC Port**: `50051` (default)
- **Environment Variable**: `KUBILITICS_PORT` (sets HTTP port)
- **Configuration**: Set via environment variable or config file

**Example:**
```bash
export KUBILITICS_PORT=819
cd kubilitics-backend && go run ./cmd/server
```

**Health Check:**
```bash
curl http://localhost:819/health
```

### AI Backend (kubilitics-ai)

- **HTTP Port**: `8081` (default)
- **gRPC Port**: `9090` (default, if used)
- **Environment Variable**: `KUBILITICS_HTTP_PORT` (sets HTTP port)
- **Backend Connection**: Connects to backend at `http://localhost:819` (HTTP) and `localhost:50051` (gRPC)

**Example:**
```bash
export KUBILITICS_HTTP_PORT=8081
export KUBILITICS_BACKEND_URL=http://localhost:819
cd kubilitics-ai && go run ./cmd/server
```

**Health Check:**
```bash
curl http://localhost:8081/health
curl http://localhost:8081/info
```

### Frontend (kubilitics-frontend)

- **Development Port**: `5173` (Vite default)
- **Production**: Served via backend or static hosting
- **Configuration**: Set in `vite.config.ts` or via `--port` flag

**Example:**
```bash
cd kubilitics-frontend && npm run dev -- --port 5173
```

## Integration Points

### Frontend → Backend

- **Base URL**: `http://localhost:819`
- **API Endpoints**: `/api/v1/*`
- **WebSocket**: `ws://localhost:819/ws/*`
- **Configuration**: Set in `kubilitics-frontend/src/lib/backendConstants.ts`

### Frontend → AI Backend

- **Base URL**: `http://localhost:8081`
- **API Endpoints**: `/api/v1/ai/*`
- **WebSocket**: `ws://localhost:8081/api/v1/ai/chat/stream`
- **Configuration**: Set in frontend environment variables or config

### AI Backend → Backend

- **HTTP Base URL**: `http://localhost:819` (default)
- **gRPC Address**: `localhost:50051` (default)
- **Environment Variables**:
  - `KUBILITICS_BACKEND_URL` - HTTP base URL (default: `http://localhost:819`)
  - `KUBILITICS_BACKEND_ADDRESS` - gRPC address (default: `localhost:50051`)

**Configuration Files:**
- `kubilitics-ai/internal/config/defaults.go` - Default values
- `kubilitics-ai/internal/mcp/server/backend_http.go` - HTTP client defaults
- `kubilitics-ai/internal/mcp/server/handlers_observation.go` - Handler defaults

## Port Override Guide

### Override Backend Port

```bash
# Via environment variable
export KUBILITICS_PORT=9000
cd kubilitics-backend && go run ./cmd/server

# Or via command line flag (if supported)
cd kubilitics-backend && go run ./cmd/server --port 9000
```

### Override AI Backend Port

```bash
# Via environment variable
export KUBILITICS_HTTP_PORT=9001
cd kubilitics-ai && go run ./cmd/server
```

### Override Backend URL from AI

```bash
# Set custom backend URL
export KUBILITICS_BACKEND_URL=http://localhost:9000
cd kubilitics-ai && go run ./cmd/server
```

## Helm Chart Configuration

In Kubernetes deployments via Helm, ports are configured in `deploy/helm/kubilitics/values.yaml`:

```yaml
backend:
  service:
    port: 819

ai:
  service:
    port: 8081
```

## Desktop Application

The desktop application (Tauri) uses Content Security Policy (CSP) to allow connections:

- Backend: `http://localhost:819`
- AI Backend: `http://localhost:8081`

CSP configuration is in `kubilitics-desktop/src-tauri/tauri.conf.json`.

## WebSocket CORS Configuration

The AI backend WebSocket server allows connections from:

- `http://localhost:3000` (development)
- `http://localhost:5173` (Vite default)

To add custom origins, set:
```bash
export KUBILITICS_WS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173,https://app.example.com"
```

## Verification

### Check Port Usage

```bash
# macOS/Linux
lsof -i :819  # Backend
lsof -i :8081 # AI Backend
lsof -i :5173 # Frontend

# Or using netstat
netstat -an | grep LISTEN | grep -E ':(819|8081|5173)'
```

### Run Integration Smoke Test

```bash
./scripts/test-integration-smoke.sh
```

This script validates:
- Backend health endpoint
- AI Backend health endpoint
- AI Backend info endpoint
- Backend API endpoints
- WebSocket endpoints
- Port conflicts

## Troubleshooting

### Port Already in Use

If you see "address already in use" errors:

```bash
# Find process using port
lsof -ti :819 | xargs kill -9  # Backend
lsof -ti :8081 | xargs kill -9 # AI Backend
lsof -ti :5173 | xargs kill -9 # Frontend
```

### Services Can't Connect

1. **Verify ports are correct:**
   - Backend should be on `819`, not `8080`
   - AI Backend should be on `8081`, not `8080`

2. **Check environment variables:**
   ```bash
   echo $KUBILITICS_PORT
   echo $KUBILITICS_HTTP_PORT
   echo $KUBILITICS_BACKEND_URL
   ```

3. **Verify firewall rules** (if applicable)

4. **Check service logs** for connection errors

### Wrong Port References

If you see references to port `8080` in logs or errors:

- **Backend**: Should use port `819`, not `8080`
- **AI Backend**: Should use port `8081`, not `8080`
- **AI → Backend calls**: Should use `http://localhost:819`, not `http://localhost:8080`

## Migration Notes

### From Port 8080 to 819 (Backend)

If you have existing deployments using port `8080`:

1. Update environment variables:
   ```bash
   export KUBILITICS_PORT=819
   ```

2. Update Helm values:
   ```yaml
   backend:
     service:
       port: 819
   ```

3. Update frontend configuration if hardcoded

4. Update any load balancer or ingress configurations

### From Port 8080 to 8081 (AI Backend)

If you have existing deployments using port `8080` for AI:

1. Update environment variables:
   ```bash
   export KUBILITICS_HTTP_PORT=8081
   ```

2. Update Helm values:
   ```yaml
   ai:
     service:
       port: 8081
   ```

3. Update frontend AI service URLs

4. Update WebSocket CORS origins (remove `8080`, ensure `8081` is allowed)

## References

- Backend Configuration: `kubilitics-backend/internal/config/config.go`
- AI Backend Configuration: `kubilitics-ai/internal/server/config.go`
- Frontend Configuration: `kubilitics-frontend/src/lib/backendConstants.ts`
- Helm Chart: `deploy/helm/kubilitics/values.yaml`
- Integration Test: `scripts/test-integration-smoke.sh`
