# Kubilitics Backend

The Kubernetes Operating System - Backend Services

## Overview

Kubilitics backend is a production-grade Kubernetes management platform built in Go. It provides:

- **Exhaustive Resource Discovery**: Discovers all 50+ K8s resource types + CRDs
- **Topology Engine**: Builds complete relationship graphs with deterministic layout
- **Real-Time Updates**: WebSocket streams for live cluster state
- **REST API**: Full CRUD operations for all resources
- **Export Service**: WYSIWYG topology export (PNG, PDF, SVG)

## Architecture

```
┌─────────────────────────────────────────┐
│          API LAYER                      │
│  REST API  │  WebSocket  │  GraphQL     │
├─────────────────────────────────────────┤
│         SERVICE LAYER                   │
│  Cluster │ Topology │ Resource │ Events │
├─────────────────────────────────────────┤
│          DATA LAYER                     │
│  client-go │ Database │ Cache           │
└─────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- **Go 1.24+** - [Download](https://go.dev/dl/)
- **Kubernetes cluster** - Any Kubernetes cluster (kind/k3s/minikube/EKS/GKE/AKS/etc.)
- **kubeconfig** - At `~/.kube/config` or set `KUBILITICS_KUBECONFIG_PATH`

### Installation

```bash
# Clone repository
git clone <repository-url>
cd kubilitics-os-emergent/kubilitics-backend

# Install dependencies
go mod download

# Build binary (optional)
go build -o bin/kubilitics-backend cmd/server/main.go
```

### Running the Backend

#### Option 1: Development Mode (No Authentication, HTTP)

```bash
# Run with defaults (HTTP on port 819, no auth)
go run cmd/server/main.go

# Or use compiled binary
./bin/kubilitics-backend

# Backend runs on http://localhost:819
# Health check: curl http://localhost:819/health
```

#### Option 2: With Authentication

```bash
# Set authentication mode and JWT secret
export KUBILITICS_AUTH_MODE=required
export KUBILITICS_AUTH_JWT_SECRET="your-secret-key-minimum-32-characters-long"
export KUBILITICS_AUTH_ADMIN_USER=admin
export KUBILITICS_AUTH_ADMIN_PASS=changeme123

# Run backend
go run cmd/server/main.go

# Login to get token
curl -X POST http://localhost:819/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme123"}'
```

#### Option 3: With TLS/HTTPS

```bash
# Generate self-signed certificate for development
openssl req -x509 -newkey rsa:4096 -keyout tls-key.pem -out tls-cert.pem -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:::1"

# Run with TLS
export KUBILITICS_TLS_ENABLED=true
export KUBILITICS_TLS_CERT_PATH=./tls-cert.pem
export KUBILITICS_TLS_KEY_PATH=./tls-key.pem
go run cmd/server/main.go

# Backend runs on https://localhost:819
```

### Verify Installation

```bash
# Check health
curl http://localhost:819/health

# Expected response:
# {"status":"healthy","service":"kubilitics-backend","version":"1.0.0"}

# List clusters (if auth disabled)
curl http://localhost:819/api/v1/clusters

# With authentication
curl http://localhost:819/api/v1/clusters \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Configuration

See [CONFIGURATION.md](./CONFIGURATION.md) for complete configuration reference.

**Quick Configuration Examples:**

```bash
# Using environment variables
export KUBILITICS_PORT=819
export KUBILITICS_DATABASE_PATH=/var/lib/kubilitics/kubilitics.db
export KUBILITICS_LOG_LEVEL=info
export KUBILITICS_LOG_FORMAT=json
export KUBILITICS_ALLOWED_ORIGINS="http://localhost:5173,https://kubilitics.example.com"
```

Or create `config.yaml`:

```yaml
port: 819
database_path: ./kubilitics.db
log_level: info
log_format: json
allowed_origins:
  - http://localhost:5173
```

### Next Steps

1. **Add a Cluster**: See [API Documentation](./API_DOCUMENTATION.md#cluster-management)
2. **View Topology**: `GET /api/v1/clusters/{clusterId}/topology`
3. **Explore Resources**: `GET /api/v1/clusters/{clusterId}/resources/{kind}`
4. **Read API Docs**: See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

### TLS/HTTPS Configuration (BE-TLS-001)

#### Development (Self-Signed Certificate)

Generate a self-signed certificate for local development:

```bash
# Generate self-signed certificate and key
openssl req -x509 -newkey rsa:4096 -keyout tls-key.pem -out tls-cert.pem -days 365 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:::1"

# Run backend with TLS
KUBILITICS_TLS_ENABLED=true \
KUBILITICS_TLS_CERT_PATH=./tls-cert.pem \
KUBILITICS_TLS_KEY_PATH=./tls-key.pem \
go run cmd/server/main.go

# Backend runs on https://localhost:819
# Note: Browser will show security warning for self-signed cert (expected)
```

#### Production (Let's Encrypt)

For production, use Let's Encrypt certificates via cert-manager or similar:

1. **Using cert-manager in Kubernetes:**
   ```yaml
   # Create Certificate resource
   apiVersion: cert-manager.io/v1
   kind: Certificate
   metadata:
     name: kubilitics-tls
   spec:
     secretName: kubilitics-tls-secret
     issuerRef:
       name: letsencrypt-prod
       kind: ClusterIssuer
     dnsNames:
       - kubilitics.example.com
   ```

2. **Mount certificate in Helm values:**
   ```yaml
   config:
     tlsEnabled: true
     tlsCertPath: "/etc/tls/tls.crt"
     tlsKeyPath: "/etc/tls/tls.key"
   
   volumes:
     - name: tls-certs
       secret:
         secretName: kubilitics-tls-secret
   
   volumeMounts:
     - name: tls-certs
       mountPath: /etc/tls
       readOnly: true
   ```

3. **Environment Variables:**
   ```bash
   KUBILITICS_TLS_ENABLED=true
   KUBILITICS_TLS_CERT_PATH=/etc/tls/tls.crt
   KUBILITICS_TLS_KEY_PATH=/etc/tls/tls.key
   ```

**Note:** When TLS is disabled, the server logs a warning: `⚠️  TLS is disabled — not recommended for production`

### Build

```bash
# Build binary
go build -o bin/kubilitics-backend cmd/server/main.go

# Run
./bin/kubilitics-backend
```

### kcli Integration

The backend uses **kcli** (Kubilitics CLI) as a sidecar binary for executing Kubernetes commands. kcli is downloaded from GitHub releases during Docker builds and is not built from source in this repository.

**Version Management:**
- kcli version is pinned in `KCLI_VERSION` file (default: `v1.0.0`)
- Docker builds download kcli binary from: `https://github.com/vellankikoti/kcli/releases/download/{VERSION}/kcli-linux-{ARCH}`
- To update kcli version, update `KCLI_VERSION` file or pass `--build-arg KCLI_VERSION=v1.x.x` to Docker build

**Local Development:**
- For integration tests, kcli binary is downloaded automatically by CI workflows
- For local development, use `make kcli` to download kcli binary
- Or set `KCLI_BIN` environment variable to point to an existing kcli binary

**Standalone kcli:**
- kcli is also available as a standalone tool: https://github.com/vellankikoti/kcli
- Users can install kcli independently without the full Kubilitics platform

### Configuration

See [CONFIGURATION.md](./CONFIGURATION.md) for complete configuration reference.

**Quick Example**:

Create `config.yaml`:
```yaml
port: 819
database_path: ./kubilitics.db
log_level: info
log_format: json
allowed_origins:
  - http://localhost:5173
```

Or use environment variables:
```bash
export KUBILITICS_PORT=819
export KUBILITICS_DATABASE_PATH=./kubilitics.db
export KUBILITICS_LOG_LEVEL=info
export KUBILITICS_LOG_FORMAT=json
```

## API Documentation

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for complete API reference including:
- All endpoints with request/response schemas
- Authentication and authorization
- Rate limiting details
- Error codes and handling
- WebSocket protocols
- Examples

**Quick Reference**:
- **Health**: `GET /health`
- **Clusters**: `GET /api/v1/clusters`, `POST /api/v1/clusters`
- **Topology**: `GET /api/v1/clusters/{id}/topology`
- **Resources**: `GET /api/v1/clusters/{id}/resources/{kind}`
- **Metrics**: `GET /api/v1/clusters/{id}/metrics/summary`
- **WebSocket**: `ws://localhost:819/ws/resources`

## Testing

```bash
# Unit tests
go test ./...

# With coverage
go test -v -race -coverprofile=coverage.out ./...

# Integration tests
go test -v ./tests/integration/...
```

## Documentation

- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)**: Complete API reference with all endpoints, authentication, rate limiting, and examples
- **[CONFIGURATION.md](./CONFIGURATION.md)**: Complete configuration reference with all fields, environment variables, and defaults
- **[README.md](./README.md)**: This file - quick start guide

## Development notes

**Topology:** After changing backend topology code (e.g. `internal/topology/engine_resource.go`), do a clean rebuild and restart: from repo root run `make clean && make backend`, then start the backend (e.g. `./scripts/restart.sh`). Resource-scoped topology (including Node) uses the running binary’s switch and `ResourceTopologyKinds`; an old or cached binary may return "resource topology not implemented" for kinds that are already supported in source.

## Deployment

### Docker

```bash
# Build image
docker build -t kubilitics-backend .

# Run container
docker run -p 819:819 \
  -v ~/.kube/config:/root/.kube/config \
  kubilitics-backend
```

### Helm

```bash
# Install in cluster
helm install kubilitics deployments/helm/kubilitics
```

## License

Apache 2.0
