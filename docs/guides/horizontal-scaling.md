# Horizontal Scaling Guide

**Audience:** Platform operators, SREs
**Applies to:** Kubilitics v0.1.1+
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture: 2-Replica Deployment](#2-architecture-2-replica-deployment)
3. [Prerequisites](#3-prerequisites)
4. [PostgreSQL Configuration](#4-postgresql-configuration)
5. [Redis Configuration](#5-redis-configuration)
6. [WebSocket Scaling with Redis PubSub](#6-websocket-scaling-with-redis-pubsub)
7. [Load Balancer Configuration](#7-load-balancer-configuration)
8. [Helm Values for Horizontal Scaling](#8-helm-values-for-horizontal-scaling)
9. [Resource Requirements by User Count](#9-resource-requirements-by-user-count)
10. [Verifying the Deployment](#10-verifying-the-deployment)
11. [Scaling Beyond 2 Replicas](#11-scaling-beyond-2-replicas)

---

## 1. Overview

The default Kubilitics deployment runs a single backend replica with SQLite. This guide covers scaling to 2+ replicas, which requires:

1. **PostgreSQL** -- SQLite does not support concurrent writers from multiple processes. PostgreSQL is required for any multi-replica deployment.
2. **Redis** -- WebSocket connections are per-replica. Redis PubSub ensures that events broadcast on one replica reach clients connected to other replicas.
3. **Load Balancer** -- Distributes HTTP and WebSocket traffic across replicas with sticky sessions for WebSocket stability.

### Architecture Diagram

```
                    ┌──────────────────────┐
                    │   Load Balancer       │
                    │ (Ingress / Service)   │
                    │  - HTTP round-robin   │
                    │  - WS sticky sessions │
                    └──────────┬───────────┘
                         ┌─────┴─────┐
                         │           │
                  ┌──────▼──┐  ┌──────▼──┐
                  │ Backend │  │ Backend │
                  │ Replica │  │ Replica │
                  │   #1    │  │   #2    │
                  └──┬───┬──┘  └──┬───┬──┘
                     │   │        │   │
              ┌──────▼───▼────────▼───▼──────┐
              │                               │
        ┌─────▼─────┐                  ┌──────▼─────┐
        │ PostgreSQL │                  │   Redis    │
        │  (shared)  │                  │  (PubSub)  │
        └────────────┘                  └────────────┘
```

---

## 2. Architecture: 2-Replica Deployment

### What Scales Horizontally

| Component | Scalable | Notes |
|---|:---:|---|
| Backend REST API | Yes | Stateless; any replica can serve any request |
| Backend WebSocket | Yes | With Redis PubSub for cross-replica event fan-out |
| Topology generation | Yes | CPU-bound; more replicas = more concurrent topology builds |
| Add-on operations | Yes | Helm operations are cluster-bound, not replica-bound |
| Frontend | Yes | Static assets; scale via CDN or multiple nginx replicas |

### What Does Not Scale

| Component | Constraint | Mitigation |
|---|---|---|
| K8s API watchers | One watcher set per cluster per backend replica | Watcher deduplication via leader election (planned) |
| Topology cache | Per-replica in-memory cache | Redis-backed shared cache (planned) |

---

## 3. Prerequisites

| Requirement | Details |
|---|---|
| Kubernetes 1.26+ | With Ingress controller (NGINX, Traefik, etc.) |
| Helm 3.12+ | For chart deployment |
| PostgreSQL 14+ | Managed service or Bitnami subchart |
| Redis 7+ | Bitnami subchart or managed service (ElastiCache, Memorystore, etc.) |
| TLS certificates | For HTTPS ingress |

---

## 4. PostgreSQL Configuration

See the [PostgreSQL Deployment Guide](postgresql-deployment.md) for full setup.

Minimum for 2-replica deployment:

```yaml
# values-ha.yaml
database:
  type: "postgresql"

postgresql:
  enabled: true
  auth:
    username: "kubilitics"
    database: "kubilitics"
  primary:
    persistence:
      size: 20Gi
    resources:
      requests:
        cpu: 500m
        memory: 512Mi
      limits:
        cpu: 2000m
        memory: 2Gi
```

---

## 5. Redis Configuration

### Using the Bitnami Subchart

```yaml
# values-ha.yaml (continued)
redis:
  enabled: true
  architecture: standalone    # Use "replication" for HA Redis
  auth:
    enabled: true
    password: ""              # Auto-generated if empty
  master:
    persistence:
      enabled: true
      size: 1Gi
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 256Mi
```

### Using Managed Redis

For AWS ElastiCache, GCP Memorystore, or Azure Cache for Redis:

```yaml
redis:
  enabled: false    # Disable subchart

# Provide connection details
env:
  - name: KUBILITICS_REDIS_URL
    value: "redis://:password@redis-host:6379/0"
  # Or use individual settings:
  - name: KUBILITICS_REDIS_HOST
    value: "redis-host"
  - name: KUBILITICS_REDIS_PORT
    value: "6379"
  - name: KUBILITICS_REDIS_PASSWORD
    valueFrom:
      secretKeyRef:
        name: kubilitics-redis
        key: redis-password
```

---

## 6. WebSocket Scaling with Redis PubSub

### The Problem

WebSocket connections are stateful and bound to a specific backend replica. When Replica #1 receives a Kubernetes event, clients connected to Replica #2 do not see it.

### The Solution

The Kubilitics backend uses Redis PubSub to fan out events across replicas:

1. When any replica receives a K8s resource event, it publishes to a Redis channel.
2. All replicas subscribe to those channels and broadcast to their local WebSocket clients.

### Channel Structure

```
kubilitics:events:resources:{clusterID}     # Resource change events
kubilitics:events:topology:{clusterID}      # Topology invalidation signals
kubilitics:events:k8s:{clusterID}           # Raw Kubernetes events
kubilitics:events:global                     # System-wide events (cluster add/remove)
```

### Configuration

```yaml
env:
  - name: KUBILITICS_PUBSUB_PROVIDER
    value: "redis"        # Options: "local" (single replica), "redis"
  - name: KUBILITICS_REDIS_URL
    value: "redis://kubilitics-redis-master:6379/0"
```

When `KUBILITICS_PUBSUB_PROVIDER` is `"local"` (default), events are only broadcast to WebSocket clients on the same replica. Set to `"redis"` for multi-replica deployments.

### Message Format

Each PubSub message is a JSON envelope:

```json
{
  "type": "RESOURCE_UPDATED",
  "clusterID": "abc-123",
  "namespace": "default",
  "kind": "Pod",
  "name": "nginx-xyz",
  "timestamp": "2026-03-16T10:30:00Z",
  "replicaID": "backend-7d8f9-abc"
}
```

Replicas skip messages originating from themselves (deduplicated by `replicaID`).

---

## 7. Load Balancer Configuration

### NGINX Ingress Controller

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kubilitics
  namespace: kubilitics
  annotations:
    # WebSocket support
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    # Sticky sessions for WebSocket stability
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/affinity-mode: "balanced"
    nginx.ingress.kubernetes.io/session-cookie-name: "kubilitics-affinity"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "3600"
    nginx.ingress.kubernetes.io/session-cookie-secure: "true"
    nginx.ingress.kubernetes.io/session-cookie-samesite: "Strict"
    # Rate limiting
    nginx.ingress.kubernetes.io/limit-rps: "50"
    nginx.ingress.kubernetes.io/limit-burst-multiplier: "3"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - kubilitics.example.com
      secretName: kubilitics-tls
  rules:
    - host: kubilitics.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kubilitics
                port:
                  number: 8080
```

### Traefik IngressRoute

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: kubilitics
  namespace: kubilitics
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`kubilitics.example.com`)
      kind: Rule
      services:
        - name: kubilitics
          port: 8080
          sticky:
            cookie:
              name: kubilitics-affinity
              secure: true
              httpOnly: true
              sameSite: strict
  tls:
    secretName: kubilitics-tls
```

### Key Load Balancer Requirements

| Requirement | Why |
|---|---|
| WebSocket upgrade support | Backend uses `/ws/resources` and `/ws/events` |
| Sticky sessions (cookie-based) | Prevents WebSocket reconnect storms during rolling updates |
| Timeout >= 3600s | WebSocket connections are long-lived |
| Health check on `/healthz/ready` | Avoid routing to unready replicas |

---

## 8. Helm Values for Horizontal Scaling

Complete values file for a 2-replica deployment:

```yaml
# values-ha.yaml
replicaCount: 2

podDisruptionBudget:
  enabled: true
  minAvailable: 1

updateStrategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 1

resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: 2000m
    memory: 1Gi

# Database
database:
  type: "postgresql"

postgresql:
  enabled: true
  auth:
    username: "kubilitics"
    database: "kubilitics"
  primary:
    persistence:
      size: 20Gi
    resources:
      requests:
        cpu: 500m
        memory: 512Mi

# Redis
redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: true
  master:
    persistence:
      size: 1Gi
    resources:
      requests:
        cpu: 100m
        memory: 128Mi

# Backend env
env:
  - name: KUBILITICS_PUBSUB_PROVIDER
    value: "redis"
  - name: KUBILITICS_DB_MAX_OPEN_CONNS
    value: "25"
  - name: KUBILITICS_DB_MAX_IDLE_CONNS
    value: "10"

# Ingress
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "kubilitics-affinity"
  hosts:
    - host: kubilitics.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: kubilitics-tls
      hosts:
        - kubilitics.example.com

# Probes
livenessProbe:
  httpGet:
    path: /healthz/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /healthz/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
```

Deploy:

```bash
helm upgrade --install kubilitics deploy/helm/kubilitics/ \
  -n kubilitics --create-namespace \
  -f values-ha.yaml
```

---

## 9. Resource Requirements by User Count

### 10 Users (Development / Small Team)

| Component | Replicas | CPU Request | Memory Request | Storage |
|---|---|---|---|---|
| Backend | 1 | 250m | 256Mi | -- |
| PostgreSQL | 1 | 250m | 256Mi | 10Gi |
| Redis | 0 (not needed) | -- | -- | -- |
| **Total** | **2 pods** | **500m** | **512Mi** | **10Gi** |

Estimated cost: ~$30/month on managed K8s.

### 50 Users (Team / Department)

| Component | Replicas | CPU Request | Memory Request | Storage |
|---|---|---|---|---|
| Backend | 2 | 500m each | 512Mi each | -- |
| PostgreSQL | 1 (HA optional) | 500m | 1Gi | 20Gi |
| Redis | 1 | 100m | 128Mi | 1Gi |
| **Total** | **4 pods** | **1,600m** | **2,152Mi** | **21Gi** |

Estimated cost: ~$80/month on managed K8s.

### 100 Users (Organization)

| Component | Replicas | CPU Request | Memory Request | Storage |
|---|---|---|---|---|
| Backend | 3 | 500m each | 512Mi each | -- |
| PostgreSQL | 1 (HA recommended) | 1000m | 2Gi | 50Gi |
| Redis | 1 (sentinel optional) | 200m | 256Mi | 2Gi |
| PgBouncer | 1 | 100m | 128Mi | -- |
| **Total** | **6 pods** | **2,800m** | **3,920Mi** | **52Gi** |

Estimated cost: ~$180/month on managed K8s.

### 500 Users (Enterprise)

| Component | Replicas | CPU Request | Memory Request | Storage |
|---|---|---|---|---|
| Backend | 5 | 1000m each | 1Gi each | -- |
| PostgreSQL | 2 (primary + standby) | 2000m each | 4Gi each | 200Gi |
| Redis | 3 (sentinel) | 200m each | 256Mi each | 2Gi each |
| PgBouncer | 2 | 200m each | 128Mi each | -- |
| **Total** | **12 pods** | **10,400m** | **14,768Mi** | **206Gi** |

Estimated cost: ~$600/month on managed K8s.

### Auto-Scaling (HPA)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: kubilitics
  namespace: kubilitics
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: kubilitics
  minReplicas: 2
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
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

---

## 10. Verifying the Deployment

### Check replica count

```bash
kubectl get pods -n kubilitics -l app.kubernetes.io/name=kubilitics
```

Expected: 2 Running pods.

### Verify Redis PubSub

```bash
# Connect to Redis CLI
kubectl exec -it kubilitics-redis-master-0 -n kubilitics -- redis-cli

# Check active channels
PUBSUB CHANNELS kubilitics:*
# Expected: channels for each connected cluster

# Check subscribers per channel
PUBSUB NUMSUB kubilitics:events:global
# Expected: number matches replica count
```

### Test WebSocket failover

1. Open the Kubilitics UI and connect to a cluster.
2. Delete one backend pod: `kubectl delete pod kubilitics-xxxx-0 -n kubilitics`
3. The UI should reconnect within 5 seconds and continue showing live events.
4. No topology data loss should occur.

### Test event propagation

1. Connect two browser tabs to Kubilitics (they may hit different replicas).
2. Create a resource in one tab (e.g., scale a deployment).
3. Both tabs should show the update within 2 seconds.

---

## 11. Scaling Beyond 2 Replicas

For deployments with 4+ replicas:

1. **Enable leader election** for K8s API watchers to avoid redundant watch streams. Set `KUBILITICS_LEADER_ELECTION=true` (requires a Lease resource).
2. **Switch to Redis-backed topology cache** to share cache across replicas. Set `KUBILITICS_TOPOLOGY_CACHE_PROVIDER=redis`.
3. **Deploy PgBouncer** to manage connection pooling centrally.
4. **Monitor Redis memory** -- PubSub is lightweight but message backlog during replica restarts can accumulate.
5. **Use pod anti-affinity** to spread replicas across nodes:
   ```yaml
   affinity:
     podAntiAffinity:
       preferredDuringSchedulingIgnoredDuringExecution:
         - weight: 100
           podAffinityTerm:
             labelSelector:
               matchExpressions:
                 - key: app.kubernetes.io/name
                   operator: In
                   values:
                     - kubilitics
             topologyKey: kubernetes.io/hostname
   ```
