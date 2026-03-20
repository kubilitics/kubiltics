# Kubilitics Backend API Documentation

## Overview

The Kubilitics Backend provides a comprehensive REST API and WebSocket interface for Kubernetes cluster management, topology visualization, and real-time monitoring.

**Base URL**: `http://localhost:819/api/v1`  
**API Version**: 1.0.0  
**Protocol**: HTTP/HTTPS, WebSocket

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Codes](#error-codes)
- [API Endpoints](#api-endpoints)
  - [Health & Capabilities](#health--capabilities)
  - [Authentication](#authentication-endpoints)
  - [User Management](#user-management)
  - [Cluster Management](#cluster-management)
  - [Topology](#topology)
  - [Resources](#resources)
  - [Logs](#logs)
  - [Metrics](#metrics)
  - [Events](#events)
  - [Shell & kcli](#shell--kcli)
  - [Projects](#projects)
  - [Audit Log](#audit-log)
- [WebSocket Endpoints](#websocket-endpoints)
- [Request/Response Schemas](#requestresponse-schemas)
- [Examples](#examples)

---

## Authentication

### Authentication Modes

The backend supports three authentication modes (configured via `auth_mode`):

- **`disabled`**: No authentication required (default for development)
- **`optional`**: Accepts Bearer tokens or anonymous requests
- **`required`**: Requires Bearer token for all requests

### Getting an Access Token

#### 1. Login

```bash
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}
```

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

#### 2. Using the Token

Include the token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  http://localhost:819/api/v1/clusters
```

#### 3. Refresh Token

When the access token expires, use the refresh token:

```bash
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response** (200 OK):
```json
{
  "access_token": "new-access-token...",
  "refresh_token": "new-refresh-token...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### API Key Authentication (BE-AUTH-003)

For programmatic access (e.g., kcli), use API keys:

```bash
curl -H "X-API-Key: kubilitics_xxxxxxxxxxxxxxxxxxxx" \
  http://localhost:819/api/v1/clusters
```

### Authorization Roles

- **`viewer`**: Read-only access (GET endpoints)
- **`operator`**: Can read and modify resources (GET, POST, PATCH, DELETE)
- **`admin`**: Full access including user management

Per-cluster permissions override global role for specific clusters.

---

## Rate Limiting

Rate limiting is enforced per IP address with different tiers based on endpoint type.

### Rate Limit Tiers

| Tier | Endpoints | Limit | Burst |
|------|-----------|-------|-------|
| **Exec/Shell** | `/shell`, `/kcli/exec`, `/kcli/stream`, `/pods/{name}/exec` | 10 req/min | 10 |
| **GET** | All GET endpoints | 120 req/min | 120 |
| **Standard** | All other endpoints (POST, PATCH, DELETE) | 60 req/min | 60 |

### Rate Limit Headers

All responses include rate limit headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1640995200
```

### Rate Limit Exceeded

When rate limit is exceeded, the API returns:

**Status**: `429 Too Many Requests`  
**Headers**:
```
Retry-After: 30
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
```

**Response Body**:
```json
{
  "error": "Rate limit exceeded. Please retry after 30 seconds."
}
```

### Excluded Endpoints

Rate limiting does not apply to:
- `/health` - Health check endpoint
- `/metrics` - Prometheus metrics endpoint

---

## Error Codes

All error responses follow this format:

```json
{
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Description | Common Causes |
|------|-------------|---------------|
| `200` | Success | - |
| `201` | Created | Resource created successfully |
| `400` | Bad Request | Invalid request parameters, malformed JSON |
| `401` | Unauthorized | Missing or invalid authentication token |
| `403` | Forbidden | Insufficient permissions (RBAC) |
| `404` | Not Found | Resource or cluster not found |
| `409` | Conflict | Resource already exists |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Server error, check logs |
| `503` | Service Unavailable | Circuit breaker open, cluster API unavailable |
| `504` | Gateway Timeout | Request to Kubernetes API timed out |

### Error Examples

**401 Unauthorized**:
```json
{
  "error": "Authentication required"
}
```

**403 Forbidden**:
```json
{
  "error": "Insufficient permissions: requires operator role"
}
```

**503 Service Unavailable** (Circuit Breaker):
```json
{
  "error": "Cluster API is temporarily unavailable due to repeated failures. Circuit breaker is open. Please retry after 30 seconds."
}
```

---

## API Endpoints

### Health & Capabilities

#### GET /health

Health check endpoint. No authentication required.

**Response** (200 OK):
```json
{
  "status": "healthy",
  "service": "kubilitics-backend",
  "version": "1.0.0",
  "topology_kinds": ["Pod", "Service", "Deployment", ...]
}
```

#### GET /capabilities

Get backend capabilities (e.g., supported topology resource kinds).

**Response** (200 OK):
```json
{
  "topology_kinds": ["Pod", "Service", "Deployment", ...]
}
```

---

### Authentication Endpoints

#### POST /api/v1/auth/login

Authenticate user and receive access/refresh tokens.

**Request Body**:
```json
{
  "username": "admin",
  "password": "password123"
}
```

**Response** (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Error Responses**:
- `400`: Invalid request body
- `401`: Invalid credentials
- `423`: Account locked (too many failed login attempts)
- `429`: Rate limit exceeded (login attempts)

#### POST /api/v1/auth/refresh

Refresh access token using refresh token.

**Request Body**:
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response** (200 OK): Same as login response

**Error Responses**:
- `400`: Invalid request body
- `401`: Invalid or expired refresh token

#### POST /api/v1/auth/logout

Logout (invalidates refresh token). Requires authentication.

**Response** (200 OK):
```json
{
  "message": "Logged out successfully"
}
```

#### GET /api/v1/auth/me

Get current user information. Requires authentication.

**Response** (200 OK):
```json
{
  "id": "user-uuid",
  "username": "admin",
  "role": "admin",
  "cluster_permissions": {
    "cluster-uuid-1": "admin",
    "cluster-uuid-2": "viewer"
  }
}
```

#### POST /api/v1/auth/change-password

Change user password. Requires authentication.

**Request Body**:
```json
{
  "current_password": "old-password",
  "new_password": "new-secure-password-min-12-chars"
}
```

**Response** (200 OK):
```json
{
  "message": "Password changed successfully"
}
```

**Error Responses**:
- `400`: Invalid password (doesn't meet policy)
- `401`: Current password incorrect

#### POST /api/v1/auth/api-keys

Create API key for programmatic access. Requires authentication.

**Request Body**:
```json
{
  "name": "kcli-production"
}
```

**Response** (201 Created):
```json
{
  "id": "key-uuid",
  "name": "kcli-production",
  "key": "kubilitics_xxxxxxxxxxxxxxxxxxxx",
  "created_at": "2024-01-01T10:00:00Z",
  "expires_at": null
}
```

**Note**: The API key is only shown once. Store it securely.

#### GET /api/v1/auth/api-keys

List user's API keys. Requires authentication.

**Response** (200 OK):
```json
[
  {
    "id": "key-uuid",
    "name": "kcli-production",
    "last_used": "2024-01-01T10:00:00Z",
    "created_at": "2024-01-01T09:00:00Z",
    "expires_at": null
  }
]
```

#### DELETE /api/v1/auth/api-keys/{keyId}

Delete API key. Requires authentication.

**Response** (200 OK):
```json
{
  "message": "API key deleted"
}
```

---

### User Management

All user management endpoints require `admin` role.

#### GET /api/v1/users

List all users. Admin only.

**Query Parameters**:
- `limit` (optional): Max results (default: 100)
- `offset` (optional): Pagination offset

**Response** (200 OK):
```json
[
  {
    "id": "user-uuid",
    "username": "admin",
    "role": "admin",
    "created_at": "2024-01-01T10:00:00Z",
    "last_login": "2024-01-01T11:00:00Z",
    "locked_until": null
  }
]
```

#### POST /api/v1/users

Create new user. Admin only.

**Request Body**:
```json
{
  "username": "newuser",
  "password": "secure-password-min-12-chars",
  "role": "viewer"
}
```

**Response** (201 Created):
```json
{
  "id": "user-uuid",
  "username": "newuser",
  "role": "viewer",
  "created_at": "2024-01-01T10:00:00Z"
}
```

#### GET /api/v1/users/{userId}

Get user details. Admin only.

**Response** (200 OK):
```json
{
  "id": "user-uuid",
  "username": "admin",
  "role": "admin",
  "created_at": "2024-01-01T10:00:00Z",
  "last_login": "2024-01-01T11:00:00Z",
  "locked_until": null
}
```

#### PATCH /api/v1/users/{userId}

Update user. Admin can change role; users can change their own password.

**Request Body**:
```json
{
  "role": "operator"
}
```

Or for password change:
```json
{
  "password": "new-password-min-12-chars"
}
```

**Response** (200 OK):
```json
{
  "id": "user-uuid",
  "username": "admin",
  "role": "operator",
  "updated_at": "2024-01-01T12:00:00Z"
}
```

#### DELETE /api/v1/users/{userId}

Delete user (soft delete). Admin only.

**Response** (200 OK):
```json
{
  "message": "User deleted"
}
```

#### POST /api/v1/users/{userId}/unlock

Unlock locked user account. Admin only.

**Response** (200 OK):
```json
{
  "message": "User unlocked"
}
```

#### GET /api/v1/users/{userId}/cluster-permissions

List user's cluster permissions. Admin only.

**Response** (200 OK):
```json
[
  {
    "cluster_id": "cluster-uuid",
    "role": "admin"
  }
]
```

#### POST /api/v1/users/{userId}/cluster-permissions

Set user's cluster permission. Admin only.

**Request Body**:
```json
{
  "cluster_id": "cluster-uuid",
  "role": "operator"
}
```

**Response** (200 OK):
```json
{
  "cluster_id": "cluster-uuid",
  "role": "operator"
}
```

#### DELETE /api/v1/users/{userId}/cluster-permissions/{clusterId}

Remove user's cluster permission. Admin only.

**Response** (200 OK):
```json
{
  "message": "Cluster permission removed"
}
```

---

### Cluster Management

#### GET /api/v1/clusters

List all clusters. Requires `viewer` role. Filtered by user permissions.

**Response** (200 OK):
```json
[
  {
    "id": "cluster-uuid",
    "name": "production",
    "context": "prod-context",
    "server_url": "https://api.k8s.example.com",
    "version": "v1.28.0",
    "status": "connected",
    "provider": "eks",
    "created_at": "2024-01-01T10:00:00Z",
    "last_connected": "2024-01-01T11:00:00Z"
  }
]
```

#### POST /api/v1/clusters

Add new cluster. Requires `admin` role.

**Request Body**:
```json
{
  "kubeconfig_path": "/path/to/kubeconfig",
  "context": "my-cluster"
}
```

Or with base64 kubeconfig:
```json
{
  "kubeconfig_base64": "base64-encoded-kubeconfig-content",
  "context": "my-cluster"
}
```

**Response** (201 Created):
```json
{
  "id": "cluster-uuid",
  "name": "my-cluster",
  "context": "my-cluster",
  "server_url": "https://api.k8s.example.com",
  "version": "v1.28.0",
  "status": "connected",
  "provider": "eks",
  "created_at": "2024-01-01T10:00:00Z",
  "last_connected": "2024-01-01T10:00:00Z"
}
```

#### GET /api/v1/clusters/discover

Discover clusters from kubeconfig. No authentication required if auth disabled.

**Response** (200 OK):
```json
[
  {
    "name": "docker-desktop",
    "context": "docker-desktop",
    "server_url": "https://kubernetes.docker.internal:6443"
  }
]
```

#### GET /api/v1/clusters/{clusterId}

Get cluster details. Requires `viewer` role.

**Response** (200 OK): Same as cluster object in list response

#### DELETE /api/v1/clusters/{clusterId}

Remove cluster. Requires `admin` role.

**Response** (200 OK):
```json
{
  "message": "Cluster removed"
}
```

#### GET /api/v1/clusters/{clusterId}/summary

Get cluster summary statistics. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "node_count": 5,
  "namespace_count": 12,
  "pod_count": 150,
  "deployment_count": 20
}
```

#### GET /api/v1/clusters/{clusterId}/overview

Get cluster overview. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "cluster": { ... },
  "summary": { ... },
  "recent_events": [ ... ]
}
```

#### GET /api/v1/clusters/{clusterId}/workloads

Get workloads overview. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "deployments": 20,
  "statefulsets": 5,
  "daemonsets": 3,
  "jobs": 10,
  "cronjobs": 2
}
```

#### GET /api/v1/clusters/{clusterId}/kubeconfig

Download kubeconfig for cluster. Requires `viewer` role.

**Response** (200 OK):
```
Content-Type: application/yaml
Content-Disposition: attachment; filename="kubeconfig-{clusterId}.yaml"

apiVersion: v1
kind: Config
...
```

---

### Topology

#### GET /api/v1/clusters/{clusterId}/topology

Get topology graph. Requires `viewer` role.

**Query Parameters**:
- `namespace` (optional): Filter by namespace
- `force_refresh` (optional): `true` to bypass cache

**Response** (200 OK):
```json
{
  "cluster_id": "cluster-uuid",
  "namespace": "default",
  "nodes": [
    {
      "id": "pod-default-nginx",
      "type": "Pod",
      "name": "nginx",
      "namespace": "default",
      "labels": { "app": "nginx" },
      "status": "Running",
      "metadata": { },
      "x": 100,
      "y": 200
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "deployment-default-nginx",
      "target": "replicaset-default-nginx",
      "type": "owner",
      "label": "owns"
    }
  ],
  "meta": {
    "node_count": 100,
    "edge_count": 150,
    "generated_at": "2024-01-01T10:00:00Z",
    "layout_seed": "deterministic-seed"
  }
}
```

#### GET /api/v1/clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name}

Get resource-specific topology subgraph. Requires `viewer` role.

**Path Parameters**:
- `kind`: Resource kind (e.g., "Pod", "Deployment")
- `namespace`: Namespace (use "-" or "_" for cluster-scoped resources)
- `name`: Resource name

**Response** (200 OK): Same format as topology endpoint

#### POST /api/v1/clusters/{clusterId}/topology/export

Export topology in various formats. Requires `operator` role.

**Request Body**:
```json
{
  "format": "png",
  "namespace": "default"
}
```

**Supported Formats**: `json`, `svg`, `drawio`, `png`

**Response** (200 OK):
- `Content-Type`: `image/png` (for PNG), `image/svg+xml` (for SVG), `application/json` (for JSON), `application/xml` (for draw.io)
- `Content-Disposition`: `attachment; filename="topology.{format}"`
- Body: Binary content (PNG/SVG) or JSON/XML

#### GET /api/v1/clusters/{clusterId}/topology/export/drawio

Export topology as draw.io XML. Requires `viewer` role.

**Query Parameters**:
- `namespace` (optional): Filter by namespace

**Response** (200 OK):
```
Content-Type: application/xml
Content-Disposition: attachment; filename="topology.drawio"

<mxfile>...</mxfile>
```

---

### Resources

#### GET /api/v1/clusters/{clusterId}/resources/{kind}

List resources by kind. Requires `viewer` role.

**Path Parameters**:
- `kind`: Resource kind (e.g., "pods", "deployments", "services")

**Query Parameters**:
- `namespace` (optional): Filter by namespace
- `limit` (optional): Max results (default: 100, max: 500)
- `continue` (optional): Pagination token
- `labelSelector` (optional): Label selector (e.g., "app=nginx")
- `fieldSelector` (optional): Field selector

**Response** (200 OK):
```json
{
  "items": [
    {
      "apiVersion": "v1",
      "kind": "Pod",
      "metadata": {
        "name": "nginx-pod",
        "namespace": "default"
      },
      "spec": { ... },
      "status": { ... }
    }
  ],
  "metadata": {
    "resourceVersion": "12345",
    "continue": "token-for-next-page",
    "total": 150
  }
}
```

#### GET /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}

Get specific resource. Requires `viewer` role.

**Path Parameters**:
- `kind`: Resource kind
- `namespace`: Namespace (use "-" or "_" for cluster-scoped)
- `name`: Resource name

**Response** (200 OK): Resource object

#### PATCH /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}

Patch resource using JSON merge patch. Requires `operator` role.

**Request Body**: JSON patch object

**Response** (200 OK): Updated resource object

#### DELETE /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}

Delete resource. Requires `operator` role.

**Headers**:
- `X-Confirm-Destructive`: Required for destructive operations

**Response** (200 OK):
```json
{
  "message": "Resource deleted"
}
```

#### POST /api/v1/clusters/{clusterId}/apply

Apply YAML manifest. Requires `operator` role.

**Request Body**: YAML or JSON Kubernetes manifest(s)

**Headers**:
- `Content-Type`: `application/yaml` or `application/json`
- `X-Confirm-Destructive`: Required if manifest contains destructive operations

**Response** (200 OK):
```json
{
  "applied": [
    {
      "kind": "Deployment",
      "namespace": "default",
      "name": "nginx",
      "action": "created"
    }
  ]
}
```

#### GET /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history

Get deployment rollout history. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "revisions": [
    {
      "revision": 3,
      "creationTimestamp": "2024-01-01T10:00:00Z",
      "changeCause": "Updated image",
      "ready": 3,
      "desired": 3,
      "available": 3,
      "images": ["nginx:1.21"]
    }
  ]
}
```

#### POST /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback

Rollback deployment to previous revision. Requires `operator` role.

**Request Body**:
```json
{
  "revision": 2
}
```

**Response** (200 OK):
```json
{
  "message": "Deployment rolled back to revision 2"
}
```

#### POST /api/v1/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/trigger

Trigger CronJob manually. Requires `operator` role.

**Response** (200 OK):
```json
{
  "job_name": "cronjob-trigger-12345",
  "message": "CronJob triggered"
}
```

#### GET /api/v1/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/jobs

List jobs created by CronJob. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "items": [ ... ]
}
```

#### POST /api/v1/clusters/{clusterId}/resources/jobs/{namespace}/{name}/retry

Retry failed job. Requires `operator` role.

**Response** (200 OK):
```json
{
  "message": "Job retried"
}
```

#### GET /api/v1/clusters/{clusterId}/resources/services/{namespace}/{name}/endpoints

Get service endpoints. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "endpoints": [
    {
      "ip": "10.244.1.5",
      "ports": [{"port": 80, "protocol": "TCP"}],
      "targetRef": {
        "kind": "Pod",
        "name": "nginx-pod"
      }
    }
  ]
}
```

#### GET /api/v1/clusters/{clusterId}/resources/configmaps/{namespace}/{name}/consumers

Get ConfigMap consumers (resources that reference it). Requires `viewer` role.

**Response** (200 OK):
```json
{
  "consumers": [
    {
      "kind": "Pod",
      "namespace": "default",
      "name": "nginx-pod"
    }
  ]
}
```

#### GET /api/v1/clusters/{clusterId}/resources/secrets/{namespace}/{name}/consumers

Get Secret consumers. Requires `viewer` role.

**Response** (200 OK): Same format as ConfigMap consumers

#### GET /api/v1/clusters/{clusterId}/resources/secrets/{namespace}/{name}/tls-info

Get TLS certificate information from Secret. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "certificate": {
    "subject": "CN=example.com",
    "issuer": "CN=Let's Encrypt",
    "validFrom": "2024-01-01T00:00:00Z",
    "validTo": "2024-04-01T00:00:00Z",
    "daysRemaining": 90
  }
}
```

#### GET /api/v1/clusters/{clusterId}/resources/persistentvolumeclaims/{namespace}/{name}/consumers

Get PVC consumers. Requires `viewer` role.

**Response** (200 OK): Same format as ConfigMap consumers

#### GET /api/v1/clusters/{clusterId}/resources/storageclasses/pv-counts

Get PersistentVolume counts per StorageClass. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "gp2": 10,
  "gp3": 5
}
```

#### GET /api/v1/clusters/{clusterId}/resources/namespaces/counts

Get resource counts per namespace. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "default": {
    "pods": 10,
    "deployments": 5
  }
}
```

#### GET /api/v1/clusters/{clusterId}/resources/serviceaccounts/token-counts

Get ServiceAccount token counts. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "default": {
    "default": 1,
    "nginx-sa": 2
  }
}
```

#### GET /api/v1/clusters/{clusterId}/crd-instances/{crdName}

List CRD instances. Requires `viewer` role.

**Query Parameters**:
- `namespace` (optional): Filter by namespace
- `limit` (optional): Max results (default: 100, max: 500)
- `continue` (optional): Pagination token

**Response** (200 OK): Same format as resource list

#### GET /api/v1/clusters/{clusterId}/search

Global search (command palette). Requires `viewer` role.

**Query Parameters**:
- `q`: Search query
- `limit` (optional): Max results (default: 25)

**Response** (200 OK):
```json
{
  "results": [
    {
      "kind": "Pod",
      "namespace": "default",
      "name": "nginx-pod",
      "match": "name"
    }
  ]
}
```

#### GET /api/v1/clusters/{clusterId}/features/metallb

Detect MetalLB feature. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "enabled": true,
  "version": "0.13.0"
}
```

---

### Logs

#### GET /api/v1/clusters/{clusterId}/logs/{namespace}/{pod}

Get pod logs. Requires `viewer` role.

**Query Parameters**:
- `container` (optional): Container name (required for multi-container pods)
- `follow` (optional): `true` to stream logs (WebSocket)
- `tail` (optional): Number of lines (default: 100)
- `since` (optional): Duration (e.g., "10m", "1h")

**Response** (200 OK):
```
Plain text log output
```

For `follow=true`, response is streamed via WebSocket.

---

### Metrics

#### GET /api/v1/clusters/{clusterId}/metrics/summary

Get unified metrics summary. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "summary": {
    "cpu": {
      "total": "10.5",
      "used": "5.2",
      "unit": "cores"
    },
    "memory": {
      "total": "64Gi",
      "used": "32Gi",
      "unit": "bytes"
    }
  },
  "query_ms": 150,
  "cache_hit": false
}
```

#### GET /api/v1/clusters/{clusterId}/metrics

Get cluster metrics. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "nodes": [ ... ],
  "namespaces": [ ... ]
}
```

#### GET /api/v1/clusters/{clusterId}/metrics/nodes/{nodeName}

Get node metrics. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "cpu": { ... },
  "memory": { ... }
}
```

#### GET /api/v1/clusters/{clusterId}/metrics/{namespace}/deployment/{name}

Get deployment metrics. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "replicas": {
    "desired": 3,
    "ready": 3,
    "available": 3
  },
  "pods": [ ... ]
}
```

Similar endpoints exist for:
- `/metrics/{namespace}/replicaset/{name}`
- `/metrics/{namespace}/statefulset/{name}`
- `/metrics/{namespace}/daemonset/{name}`
- `/metrics/{namespace}/job/{name}`
- `/metrics/{namespace}/cronjob/{name}`
- `/metrics/{namespace}/{pod}`

---

### Events

#### GET /api/v1/clusters/{clusterId}/events

Get Kubernetes events. Requires `viewer` role.

**Query Parameters**:
- `namespace` (optional): Filter by namespace
- `limit` (optional): Max results (default: 100, max: 500)
- `continue` (optional): Pagination token

**Response** (200 OK):
```json
{
  "items": [
    {
      "type": "Normal",
      "reason": "Created",
      "message": "Created pod",
      "firstTimestamp": "2024-01-01T10:00:00Z",
      "lastTimestamp": "2024-01-01T10:00:00Z",
      "count": 1,
      "involvedObject": {
        "kind": "Pod",
        "namespace": "default",
        "name": "nginx-pod"
      }
    }
  ],
  "metadata": {
    "continue": "token",
    "total": 50
  }
}
```

---

### Shell & kcli

#### POST /api/v1/clusters/{clusterId}/shell

Execute kubectl command. Requires `operator` role.

**Request Body**:
```json
{
  "command": "get pods",
  "namespace": "default"
}
```

**Response** (200 OK):
```json
{
  "stdout": "NAME READY STATUS\nnginx-pod 1/1 Running",
  "stderr": "",
  "exit_code": 0
}
```

#### GET /api/v1/clusters/{clusterId}/shell/status

Get shell status (effective context/namespace). Requires `viewer` role.

**Response** (200 OK):
```json
{
  "context": "my-cluster",
  "namespace": "default",
  "capabilities": ["exec", "port-forward"]
}
```

#### GET /api/v1/clusters/{clusterId}/shell/stream

Interactive shell stream (WebSocket PTY). Requires `operator` role.

**Query Parameters**:
- `namespace` (optional): Default namespace

**Protocol**: WebSocket

#### GET /api/v1/clusters/{clusterId}/shell/complete

Shell completion (IDE-style Tab). Requires `viewer` role.

**Query Parameters**:
- `command`: Command to complete
- `position`: Cursor position

**Response** (200 OK):
```json
{
  "completions": ["get", "describe", "delete"]
}
```

#### POST /api/v1/clusters/{clusterId}/kcli/exec

Execute kcli command. Requires `operator` role.

**Request Body**:
```json
{
  "command": "get pods",
  "namespace": "default"
}
```

**Response** (200 OK): Same format as shell exec

#### GET /api/v1/clusters/{clusterId}/kcli/stream

kcli stream (WebSocket PTY). Requires `operator` role.

**Query Parameters**:
- `mode` (optional): `ui` (default) or `shell`

**Protocol**: WebSocket

#### GET /api/v1/clusters/{clusterId}/kcli/complete

kcli completion. Requires `viewer` role.

**Response** (200 OK): Same format as shell completion

#### GET /api/v1/clusters/{clusterId}/kcli/tui/state

Get kcli TUI/session state. Requires `viewer` role.

**Response** (200 OK):
```json
{
  "state": { ... }
}
```

#### GET /api/v1/clusters/{clusterId}/pods/{namespace}/{name}/exec

Pod exec (WebSocket). Requires `operator` role.

**Query Parameters**:
- `container` (optional): Container name
- `command` (optional): Command to execute (default: `/bin/sh`)

**Protocol**: WebSocket

---

### Projects

#### GET /api/v1/projects

List projects. Requires `viewer` role.

**Response** (200 OK):
```json
[
  {
    "id": "project-uuid",
    "name": "production",
    "description": "Production environment",
    "clusters": ["cluster-uuid-1"],
    "namespaces": [
      {
        "cluster_id": "cluster-uuid-1",
        "namespace": "prod"
      }
    ]
  }
]
```

#### POST /api/v1/projects

Create project. Requires `admin` role.

**Request Body**:
```json
{
  "name": "production",
  "description": "Production environment"
}
```

**Response** (201 Created): Project object

#### GET /api/v1/projects/{projectId}

Get project details. Requires `viewer` role.

**Response** (200 OK): Project object

#### PATCH /api/v1/projects/{projectId}

Update project. Requires `admin` role.

**Request Body**:
```json
{
  "description": "Updated description"
}
```

**Response** (200 OK): Updated project object

#### DELETE /api/v1/projects/{projectId}

Delete project. Requires `admin` role.

**Response** (200 OK):
```json
{
  "message": "Project deleted"
}
```

#### POST /api/v1/projects/{projectId}/clusters

Add cluster to project. Requires `admin` role.

**Request Body**:
```json
{
  "cluster_id": "cluster-uuid"
}
```

**Response** (200 OK):
```json
{
  "message": "Cluster added to project"
}
```

#### DELETE /api/v1/projects/{projectId}/clusters/{clusterId}

Remove cluster from project. Requires `admin` role.

**Response** (200 OK):
```json
{
  "message": "Cluster removed from project"
}
```

#### POST /api/v1/projects/{projectId}/namespaces

Add namespace to project. Requires `admin` role.

**Request Body**:
```json
{
  "cluster_id": "cluster-uuid",
  "namespace": "prod",
  "team": "platform"
}
```

**Response** (200 OK):
```json
{
  "message": "Namespace added to project"
}
```

#### DELETE /api/v1/projects/{projectId}/namespaces/{clusterId}/{namespaceName}

Remove namespace from project. Requires `admin` role.

**Response** (200 OK):
```json
{
  "message": "Namespace removed from project"
}
```

---

### Audit Log

#### GET /api/v1/audit-log

List audit log entries. Requires `admin` role.

**Query Parameters**:
- `user_id` (optional): Filter by user ID
- `cluster_id` (optional): Filter by cluster ID
- `action` (optional): Filter by action
- `since` (optional): Filter entries since timestamp
- `until` (optional): Filter entries until timestamp
- `limit` (optional): Max results (default: 100)
- `format` (optional): `csv` for CSV export

**Response** (200 OK):
```json
[
  {
    "id": "audit-uuid",
    "timestamp": "2024-01-01T10:00:00Z",
    "user_id": "user-uuid",
    "username": "admin",
    "cluster_id": "cluster-uuid",
    "action": "delete",
    "resource_kind": "Pod",
    "resource_namespace": "default",
    "resource_name": "nginx-pod",
    "status_code": 200,
    "request_ip": "192.168.1.1",
    "details": "Resource deleted successfully"
  }
]
```

For `format=csv`, response is CSV with `Content-Type: text/csv` and `Content-Disposition: attachment`.

---

## WebSocket Endpoints

### Resource Updates

**URL**: `ws://localhost:819/ws/resources?cluster_id={id}&namespace={ns}`

Receive real-time Kubernetes resource updates.

**Message Format**:
```json
{
  "type": "RESOURCE_ADDED|RESOURCE_UPDATED|RESOURCE_DELETED",
  "cluster_id": "uuid",
  "resource": {
    "kind": "Pod",
    "namespace": "default",
    "name": "nginx-abc",
    "data": { }
  },
  "timestamp": "2024-01-01T10:00:00Z"
}
```

---

## Request/Response Schemas

### Common Headers

**Request Headers**:
- `Authorization`: `Bearer {token}` or `X-API-Key: {key}` (if auth enabled)
- `Content-Type`: `application/json` (for JSON requests)
- `X-Request-ID`: Optional request ID for tracing
- `X-Confirm-Destructive`: Required for DELETE operations
- `X-Trace-ID`: Trace ID for distributed tracing (response header)

**Response Headers**:
- `X-Request-ID`: Request ID for correlation
- `X-Trace-ID`: Trace ID for distributed tracing
- `X-RateLimit-Limit`: Rate limit per minute
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Unix timestamp when rate limit resets
- `Retry-After`: Seconds to wait before retry (429/503)

### Pagination

List endpoints support cursor-based pagination:

**Query Parameters**:
- `limit`: Max results (default: 100, max: 500)
- `continue`: Pagination token from previous response

**Response Metadata**:
```json
{
  "metadata": {
    "resourceVersion": "12345",
    "continue": "token-for-next-page",
    "total": 150
  }
}
```

### Error Response Format

```json
{
  "error": "Error message description"
}
```

---

## Examples

### Complete Workflow Example

```bash
# 1. Login (if auth enabled)
TOKEN=$(curl -s -X POST http://localhost:819/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}' | jq -r '.access_token')

# 2. Add a cluster
CLUSTER_ID=$(curl -s -X POST http://localhost:819/api/v1/clusters \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kubeconfig_path": "~/.kube/config",
    "context": "minikube"
  }' | jq -r '.id')

# 3. Get cluster summary
curl -s http://localhost:819/api/v1/clusters/$CLUSTER_ID/summary \
  -H "Authorization: Bearer $TOKEN" | jq

# 4. Get topology for default namespace
curl -s "http://localhost:819/api/v1/clusters/$CLUSTER_ID/topology?namespace=default&force_refresh=true" \
  -H "Authorization: Bearer $TOKEN" | jq

# 5. List pods with pagination
curl -s "http://localhost:819/api/v1/clusters/$CLUSTER_ID/resources/pods?namespace=default&limit=50" \
  -H "Authorization: Bearer $TOKEN" | jq

# 6. Get pod logs
curl -s "http://localhost:819/api/v1/clusters/$CLUSTER_ID/logs/default/nginx-pod?tail=50" \
  -H "Authorization: Bearer $TOKEN"

# 7. Get metrics summary
curl -s http://localhost:819/api/v1/clusters/$CLUSTER_ID/metrics/summary \
  -H "Authorization: Bearer $TOKEN" | jq

# 8. Get events
curl -s "http://localhost:819/api/v1/clusters/$CLUSTER_ID/events?namespace=default&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq
```

### WebSocket Client Example (JavaScript)

```javascript
// Connect to resource updates
const ws = new WebSocket('ws://localhost:819/ws/resources?cluster_id=' + clusterId);

ws.onopen = () => {
  console.log('Connected to resource updates');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Resource update:', data.type, data.resource);
  
  switch(data.type) {
    case 'RESOURCE_ADDED':
      // Handle new resource
      break;
    case 'RESOURCE_UPDATED':
      // Handle resource update
      break;
    case 'RESOURCE_DELETED':
      // Handle resource deletion
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from resource updates');
};
```

---

## Configuration

See [CONFIGURATION.md](./CONFIGURATION.md) for complete configuration reference.

---

## License

Apache 2.0 - See LICENSE file for details
