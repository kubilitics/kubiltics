# Runbook: Troubleshoot WebSocket Disconnections

**Audience:** Platform operators, SREs, frontend developers
**Last updated:** 2026-03-16
**Applies to:** Kubilitics v0.1.1+

---

## Table of Contents

1. [Overview](#1-overview)
2. [Common Causes](#2-common-causes)
3. [Nginx / Ingress Configuration](#3-nginx--ingress-configuration)
4. [Debug with Browser DevTools](#4-debug-with-browser-devtools)
5. [Server-Side Connection Logging](#5-server-side-connection-logging)
6. [Load Balancer Configuration](#6-load-balancer-configuration)
7. [Multi-Replica Setup with Redis PubSub](#7-multi-replica-setup-with-redis-pubsub)
8. [Client-Side Reconnection](#8-client-side-reconnection)

---

## 1. Overview

Kubilitics uses WebSocket connections for real-time features including:

| Endpoint | Purpose |
|---|---|
| `/clusters/{id}/overview/stream` | Live cluster overview updates |
| `/clusters/{id}/addons/install/stream` | Real-time add-on installation progress |
| `/clusters/{id}/pods/{ns}/{name}/exec` | Pod exec terminal (interactive) |
| `/clusters/{id}/shell/stream` | Cloud shell (interactive kubectl PTY) |
| `/clusters/{id}/kcli/stream` | kcli stream (UI mode or shell mode) |

The backend uses `gorilla/websocket` for WebSocket handling. The frontend connects to these endpoints through whatever proxy/ingress sits in front of the backend (Nginx Ingress, Traefik, AWS ALB, etc.).

WebSocket disconnections are the most common user-facing issue in production Kubilitics deployments and are almost always caused by proxy/load balancer misconfiguration.

---

## 2. Common Causes

| Cause | Symptom | Fix Section |
|---|---|---|
| Proxy timeout (60s default) | Connection drops after exactly 60s of inactivity | Section 3, 6 |
| Missing `Upgrade` header forwarding | WebSocket handshake fails (HTTP 400) | Section 3 |
| Load balancer draining | Connections drop during deployments | Section 6 |
| CORS origin mismatch | WebSocket handshake rejected (HTTP 403) | Section 5 |
| TLS termination issues | `wss://` fails, `ws://` works | Section 3 |
| Backend pod OOM killed | Sudden disconnect, no graceful close | Section 5 |
| Connection limit per user/cluster | New connections rejected after limit | Section 5 |
| Network policy blocking | Connection timeout or reset | Section 3 |

---

## 3. Nginx / Ingress Configuration

### 3.1 Required Nginx Ingress annotations

The Kubilitics Helm chart's Ingress template (`deploy/helm/kubilitics/templates/ingress.yaml`) sets default timeouts of 300 seconds. For WebSocket to work, the following annotations are critical:

```yaml
# values.yaml
ingress:
  enabled: true
  className: "nginx"
  annotations:
    # WebSocket support
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"    # 1 hour
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"    # 1 hour
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "60"

    # Required for WebSocket upgrade
    nginx.ingress.kubernetes.io/connection-proxy-header: "keep-alive, Upgrade"

    # Increase buffer size for WebSocket frames
    nginx.ingress.kubernetes.io/proxy-buffer-size: "8k"

    # SSL
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"

    # Body size (for large kcli responses)
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
```

### 3.2 Verify Nginx is forwarding Upgrade headers

```bash
# Check the generated Nginx config
INGRESS_POD=$(kubectl get pods -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n ingress-nginx "$INGRESS_POD" -- \
  cat /etc/nginx/nginx.conf | grep -A20 "kubilitics"
```

Look for:

```
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

If these are missing, add the annotation:

```yaml
nginx.ingress.kubernetes.io/configuration-snippet: |
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
```

### 3.3 Traefik configuration

If using Traefik as the Ingress controller:

```yaml
# IngressRoute for WebSocket endpoints
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: kubilitics-ws
  namespace: kubilitics
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`kubilitics.example.com`) && PathPrefix(`/clusters`)
      kind: Rule
      services:
        - name: kubilitics
          port: 819
      middlewares:
        - name: kubilitics-ws-headers
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: kubilitics-ws-headers
  namespace: kubilitics
spec:
  headers:
    customRequestHeaders:
      Connection: "keep-alive, Upgrade"
```

### 3.4 Istio configuration

For Istio service mesh, WebSocket works out of the box but you may need to adjust timeouts in the VirtualService:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: kubilitics
  namespace: kubilitics
spec:
  hosts:
    - kubilitics.example.com
  gateways:
    - kubilitics-gateway
  http:
    - match:
        - uri:
            prefix: /clusters
          headers:
            upgrade:
              exact: websocket
      route:
        - destination:
            host: kubilitics
            port:
              number: 819
      timeout: 3600s
    - route:
        - destination:
            host: kubilitics
            port:
              number: 819
```

### 3.5 Network Policy verification

If `networkPolicy.enabled: true` in values.yaml, ensure the ingress controller namespace is correctly configured:

```bash
kubectl get networkpolicy -n kubilitics -o yaml
```

The NetworkPolicy must allow traffic from the ingress controller namespace:

```yaml
networkPolicy:
  enabled: true
  ingress:
    namespace: "ingress-nginx"  # Must match your ingress controller's namespace
```

---

## 4. Debug with Browser DevTools

### 4.1 Check WebSocket connections

1. Open **Chrome DevTools** (F12) > **Network** tab
2. Filter by **WS** (WebSocket)
3. Navigate to a page that uses WebSocket (e.g., cluster dashboard)
4. Click on the WebSocket connection entry

**Healthy connection:**
- Status: `101 Switching Protocols`
- Messages tab shows bidirectional JSON frames
- Connection stays open

**Failed connection indicators:**
- Status `400`: Missing or incorrect `Upgrade` header (proxy issue)
- Status `403`: CORS origin check failed
- Status `404`: Backend not routing WebSocket endpoints
- Connection closes immediately: Check the **Close** frame code and reason

### 4.2 WebSocket close codes

| Code | Meaning | Likely cause |
|---|---|---|
| 1000 | Normal closure | User navigated away or server shut down gracefully |
| 1001 | Going away | Server is shutting down (deployment rollout) |
| 1006 | Abnormal closure | No close frame received -- network issue or proxy timeout |
| 1008 | Policy violation | Auth token expired or origin rejected |
| 1009 | Message too big | Frame size exceeds server limit |
| 1011 | Internal error | Server-side crash or panic |

### 4.3 Test WebSocket connectivity from CLI

```bash
# Using wscat (install: npm install -g wscat)
wscat -c "wss://kubilitics.example.com/clusters/<id>/overview/stream?token=<jwt>" \
  --no-check

# Using websocat
websocat "wss://kubilitics.example.com/clusters/<id>/overview/stream?token=<jwt>" \
  --text
```

If this fails but curl to the health endpoint works, the issue is in WebSocket upgrade handling (proxy configuration).

### 4.4 Test with plain HTTP upgrade

```bash
curl -v \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Authorization: Bearer <jwt>" \
  "https://kubilitics.example.com/clusters/<id>/overview/stream"
```

Expected response: `HTTP/1.1 101 Switching Protocols` with `Upgrade: websocket` header.

---

## 5. Server-Side Connection Logging

### 5.1 Check backend logs for WebSocket events

```bash
NAMESPACE="kubilitics"
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')

# All WebSocket-related logs
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=30m | \
  grep -i "websocket\|ws\|upgrade\|connection"

# Origin check failures
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=30m | \
  grep -i "origin\|cors\|forbidden"

# Connection limit hits
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=30m | \
  grep -i "limit\|exceeded\|rejected"
```

### 5.2 CORS / Origin configuration

The backend's `wsCheckOrigin` function validates the Origin header against `KUBILITICS_ALLOWED_ORIGINS`. If the frontend origin does not match, WebSocket connections are rejected with HTTP 403.

Check the current allowed origins:

```bash
kubectl get deployment kubilitics -n "$NAMESPACE" \
  -o jsonpath='{.spec.template.spec.containers[0].env}' | jq '.[] | select(.name=="KUBILITICS_ALLOWED_ORIGINS")'
```

Update if needed:

```yaml
# values.yaml
config:
  allowedOrigins: "https://kubilitics.example.com,https://kubilitics-staging.example.com"
```

### 5.3 Connection limits

The backend enforces a per-cluster, per-user WebSocket connection limit (defined as `maxWSConnsPerClusterUser` in the handler). If users are hitting this limit:

```bash
# Check for connection limit messages
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=1h | grep -i "limit.*reached"
```

Common cause: the frontend opens multiple WebSocket connections without closing previous ones (e.g., navigating between clusters without cleanup).

### 5.4 Enable debug logging

```bash
kubectl set env deployment/kubilitics -n "$NAMESPACE" KUBILITICS_LOG_LEVEL=debug
kubectl rollout restart deployment/kubilitics -n "$NAMESPACE"

# Reproduce the issue, then collect logs
kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -c backend --since=10m > ws-debug.log

# Restore normal logging
kubectl set env deployment/kubilitics -n "$NAMESPACE" KUBILITICS_LOG_LEVEL=info
kubectl rollout restart deployment/kubilitics -n "$NAMESPACE"
```

### 5.5 Check pod resource usage

Sudden WebSocket drops can be caused by OOM kills:

```bash
# Check for OOM events
kubectl get events -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp | grep -i "oom\|kill\|evict"

# Check current memory usage
kubectl top pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics
```

If the pod is near its memory limit, increase resources:

```yaml
resources:
  limits:
    memory: 1Gi    # Up from default 512Mi
  requests:
    memory: 256Mi
```

---

## 6. Load Balancer Configuration

### 6.1 AWS Application Load Balancer (ALB)

ALB supports WebSocket natively but has an idle timeout (default: 60 seconds). Increase it:

```yaml
# Ingress annotations for AWS ALB Ingress Controller
ingress:
  annotations:
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS": 443}]'
    # Idle timeout: max 4000 seconds
    alb.ingress.kubernetes.io/load-balancer-attributes: "idle_timeout.timeout_seconds=3600"
```

### 6.2 AWS Network Load Balancer (NLB)

NLB idle timeout is fixed at 350 seconds and cannot be changed. Use keepalive pings on the application layer (the backend sends WebSocket pings automatically).

### 6.3 Google Cloud Load Balancer

```yaml
# BackendConfig for GKE Ingress
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: kubilitics-ws
  namespace: kubilitics
spec:
  timeoutSec: 3600
  connectionDraining:
    drainingTimeoutSec: 300
```

Reference in the Service annotation:

```yaml
metadata:
  annotations:
    cloud.google.com/backend-config: '{"default": "kubilitics-ws"}'
```

### 6.4 Azure Application Gateway

```yaml
# Application Gateway Ingress Controller (AGIC)
ingress:
  annotations:
    appgw.ingress.kubernetes.io/connection-draining: "true"
    appgw.ingress.kubernetes.io/connection-draining-timeout: "300"
    appgw.ingress.kubernetes.io/request-timeout: "3600"
```

### 6.5 Connection draining during deployments

During a rolling update, existing WebSocket connections to old pods are terminated. To minimize disruption:

```yaml
# Increase terminationGracePeriodSeconds in the deployment
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60  # Give connections time to close gracefully
```

The backend handles SIGTERM by closing WebSocket connections with a `1001 Going Away` close frame, giving clients a chance to reconnect to a new pod.

---

## 7. Multi-Replica Setup with Redis PubSub

When running `replicaCount > 1`, WebSocket connections are load-balanced across pods. A user's HTTP request may hit Pod A, but their WebSocket connection may be on Pod B. For features that require server-to-client push (e.g., broadcasting cluster events), all pods need to receive the same events.

### 7.1 The problem

Without a shared message bus:
- Pod A processes an add-on install event
- Pod A pushes an update to WebSocket clients connected to it
- Clients connected to Pod B never receive the update

### 7.2 Solution: Redis PubSub

Configure a Redis instance for cross-pod WebSocket event broadcasting:

```yaml
# values.yaml
redis:
  enabled: true
  host: "redis-master.kubilitics.svc.cluster.local"
  port: 6379
  password: ""
  db: 0
```

For now (v0.1.1), use **sticky sessions** as a workaround to ensure a user's WebSocket always connects to the same pod:

### 7.3 Sticky sessions (current workaround)

#### Nginx Ingress

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/affinity-mode: "persistent"
    nginx.ingress.kubernetes.io/session-cookie-name: "kubilitics-affinity"
    nginx.ingress.kubernetes.io/session-cookie-expires: "86400"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "86400"
    nginx.ingress.kubernetes.io/session-cookie-secure: "true"
    nginx.ingress.kubernetes.io/session-cookie-samesite: "Strict"
```

#### Traefik

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: kubilitics-sticky
spec:
  headers:
    customResponseHeaders:
      Set-Cookie: "kubilitics-affinity=<hash>; Path=/; Secure; HttpOnly; SameSite=Strict"
```

#### Verify sticky sessions are working

```bash
# Make multiple requests and check the pod that handles them
for i in $(seq 1 5); do
  curl -s -H "Cookie: kubilitics-affinity=test" \
    -H "Authorization: Bearer $TOKEN" \
    https://kubilitics.example.com/health | jq -r '.hostname // empty'
done
# All should return the same pod hostname
```

---

## 8. Client-Side Reconnection

The Kubilitics frontend implements automatic WebSocket reconnection with exponential backoff. If users report frequent reconnections:

### 8.1 Check reconnection behavior in browser console

Open DevTools > Console, filter for "websocket" or "ws":

```
[WS] Connected to wss://kubilitics.example.com/clusters/.../overview/stream
[WS] Connection closed (code: 1006, reason: "")
[WS] Reconnecting in 1000ms (attempt 1/10)
[WS] Connected to wss://kubilitics.example.com/clusters/.../overview/stream
[WS] Connection closed (code: 1006, reason: "")
[WS] Reconnecting in 2000ms (attempt 2/10)
```

If you see rapid `1006` disconnects:
- The proxy is killing idle connections (fix timeout settings per Section 3/6)
- The backend pod is being OOM killed (check Section 5.5)

### 8.2 Network quality check

For users on unstable networks (VPN, satellite, mobile):

```bash
# From the client machine, test connectivity stability
ping -c 100 kubilitics.example.com | tail -5
# Check for packet loss percentage

# Test WebSocket ping-pong latency
wscat -c "wss://kubilitics.example.com/clusters/<id>/overview/stream?token=<jwt>" \
  --no-check -x '{"type":"ping"}'
```

---

## Troubleshooting Decision Tree

```
WebSocket not connecting?
  |
  +-- HTTP 400 on upgrade?
  |     +-- Proxy not forwarding Upgrade header -> Section 3
  |
  +-- HTTP 403?
  |     +-- Origin check failed -> Section 5.2 (allowedOrigins)
  |     +-- Token expired -> Re-authenticate
  |
  +-- HTTP 404?
  |     +-- Wrong URL path -> Check endpoint paths in Section 1
  |
  +-- Connects then drops immediately?
  |     +-- Check close code (Section 4.2)
  |     +-- Connection limit reached -> Section 5.3
  |
  +-- Drops after ~60s of inactivity?
  |     +-- Proxy idle timeout -> Section 3 (increase timeouts)
  |     +-- Load balancer timeout -> Section 6
  |
  +-- Drops during deployment?
  |     +-- Connection draining -> Section 6.5
  |     +-- Client should auto-reconnect -> Section 8
  |
  +-- Random drops under load?
        +-- Pod OOM -> Section 5.5
        +-- Multi-replica without sticky sessions -> Section 7
```

---

## Quick Fixes Reference

| Problem | Quick fix |
|---|---|
| 60s timeout drops | `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` |
| WebSocket 400 | Add `configuration-snippet` with Upgrade headers |
| WebSocket 403 | Update `config.allowedOrigins` in values.yaml |
| Drops during deploy | Set `terminationGracePeriodSeconds: 60` |
| ALB timeout | `idle_timeout.timeout_seconds=3600` |
| Multi-replica inconsistency | Enable sticky sessions (Section 7.3) |
