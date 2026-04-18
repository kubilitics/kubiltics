# Kubilitics Agent Helm Chart

Lightweight Kubernetes agent that registers a cluster with a Kubilitics hub
and pushes topology, events, and metrics over an outbound HTTPS connection.

**Deploy this on every cluster you want to monitor.** The hub itself
auto-registers the cluster it runs in — you only need this chart for
**additional** clusters.

## Architecture

- **Hub-and-spoke**: one Kubilitics hub, many lightweight agents.
- **Outbound only**: the agent dials the hub. The hub never dials agents.
  Works behind NAT, corporate proxies, private clusters — no inbound
  firewall changes required.
- **Per-cluster identity**: the agent uses the `kube-system` Namespace UID
  as a stable cluster identifier. Reinstalling the agent re-binds to the
  existing cluster row instead of duplicating it.
- **Refresh + access JWT pair**: after a one-time bootstrap-token exchange
  the agent holds a year-long refresh token (stored as an argon2id hash on
  the hub) and rotates short-lived access JWTs every hour.

## Prerequisites

- Kubernetes 1.24+
- Helm 3.8+
- A running Kubilitics hub reachable from this cluster (HTTPS recommended).
- A **bootstrap token** minted on the hub (single-use, default 24-hour TTL).

### Get a bootstrap token

```bash
# Run on a machine that can reach the hub.
HUB_URL=https://kubilitics.example.com

curl -sS -X POST "${HUB_URL}/api/v1/admin/clusters/bootstrap-token" \
  -H 'Content-Type: application/json' \
  -d '{"ttl_seconds":3600}' | jq -r '.bootstrap_token'
```

The response also includes a ready-to-paste `helm_command` field with the
URL and token already substituted — copy that to skip the next step.

## Install

```bash
helm repo add kubilitics https://kubilitics.github.io/kubilitics
helm repo update

helm install kubilitics-agent kubilitics/kubilitics-agent \
  --namespace kubilitics-system \
  --create-namespace \
  --set hub.url="https://kubilitics.example.com" \
  --set hub.token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

Wait for the pod and check the hub UI — the new cluster appears in the
cluster picker within ~30 seconds:

```bash
kubectl -n kubilitics-system rollout status deploy/kubilitics-agent
kubectl -n kubilitics-system logs deploy/kubilitics-agent --tail=20
# → expect: "kubilitics-agent starting; hub=… ns=kubilitics-system"
```

## Common Configurations

### Cluster behind a private CA

If the hub uses a certificate issued by a private CA (corporate, internal
PKI, self-signed), pass the CA bundle so the agent can verify the hub's
TLS:

```bash
helm install kubilitics-agent kubilitics/kubilitics-agent \
  --namespace kubilitics-system \
  --create-namespace \
  --set hub.url="https://kubilitics.internal.example.com" \
  --set hub.token="<bootstrap-token>" \
  --set-file hub.caBundle=./internal-ca.crt
```

### Plain HTTP (in-cluster Service URL)

Same-cluster traffic over the K8s Service network is implicitly trusted —
no TLS needed:

```bash
helm install kubilitics-agent kubilitics/kubilitics-agent \
  --namespace kubilitics-system \
  --create-namespace \
  --set hub.url="http://kubilitics.kubilitics-system.svc:8190" \
  --set hub.insecureSkipTLSVerify=true
```

`insecureSkipTLSVerify=true` is required when the URL is plain HTTP — the
agent refuses unencrypted traffic by default unless this flag explicitly
acknowledges it.

### Air-gapped / private registry

Pull images from your own registry:

```bash
helm install kubilitics-agent kubilitics/kubilitics-agent \
  --namespace kubilitics-system \
  --create-namespace \
  --set image.repository=registry.internal.example.com/kubilitics/kubilitics-agent \
  --set image.tag=v1.0.0 \
  --set image.pullPolicy=IfNotPresent \
  --set hub.url="..." \
  --set hub.token="..."
```

## Configuration Reference

| Key | Default | Description |
|-----|---------|-------------|
| `hub.url` | `""` | **Required.** Base URL of the Kubilitics hub (e.g. `https://kubilitics.example.com`). |
| `hub.token` | `""` | Bootstrap JWT minted on the hub. Single-use, exchanged for a refresh token on first registration. |
| `hub.caBundle` | `""` | PEM-encoded CA bundle for hub TLS verification. Use `--set-file` to load from a file. |
| `hub.insecureSkipTLSVerify` | `false` | Skip TLS verification. Required when `hub.url` starts with `http://` (otherwise the agent refuses to start). Use only for in-cluster Service URLs or local dev. |
| `image.repository` | `ghcr.io/kubilitics/kubilitics-agent` | Container image. |
| `image.tag` | `""` (chart appVersion) | Image tag. |
| `image.pullPolicy` | `IfNotPresent` | |
| `namespace` | `kubilitics-system` | Where the agent runs and stores its credential Secret. |
| `resources.requests.cpu` | `50m` | |
| `resources.requests.memory` | `64Mi` | |
| `resources.limits.cpu` | `200m` | |
| `resources.limits.memory` | `256Mi` | |

## What the agent installs

This chart provisions:

- A **Deployment** (`kubilitics-agent`) with one replica.
- A **ServiceAccount** with cluster-scoped read permissions on
  `nodes/pods/services/configmaps/events/namespaces` (read-only — the
  agent never mutates resources).
- A **Role** in `kubilitics-system` granting `secrets/get,create,update`
  on the `kubilitics-agent-creds` Secret (where the refresh token is
  stored, argon2id-hashed) and `tokenreviews.create` for same-cluster
  authentication exchanges.

No CRDs, no admission webhooks, no node DaemonSets.

## Uninstall

```bash
helm uninstall kubilitics-agent -n kubilitics-system
```

The credential Secret is removed with the chart (it has the agent's
ServiceAccount as its owner reference). On the hub side, the cluster row
is **kept** with status `disconnected` — admin can delete it from the
hub UI if no longer needed.

## Troubleshooting

### Agent CrashLoopBackOff

```bash
kubectl -n kubilitics-system logs deploy/kubilitics-agent --tail=30
```

Common causes and fixes:

| Log line | Meaning | Fix |
|---|---|---|
| `KUBILITICS_HUB_URL required` | `--set hub.url=` missing or empty. | Set the URL. |
| `plain HTTP refused; …` | Hub URL is `http://` without the insecure flag. | Use `https://`, or add `--set hub.insecureSkipTLSVerify=true` (in-cluster only). |
| `registration failed: hub 401 token_invalid` | Bootstrap JWT has bad signature or wrong issuer. | Mint a fresh token on the hub. |
| `registration failed: hub 401 token_used` | Token already exchanged. | Mint a fresh token. |
| `registration failed: hub 401 token_expired` | Token outlived its TTL. | Mint a fresh token. |
| `registration failed: hub 409` | Cluster UID collision (re-install over a stale row). | Hub UI → "Reset cluster" on the affected row, then reinstall. |
| `hub returned 410 — re-registration required` | Cluster was force-rotated on the hub side. | Agent will re-register automatically with the same bootstrap token if still valid; otherwise mint a new one. |

### Cluster shows `disconnected` in the hub UI

Heartbeats use the agent's refresh token (1-year TTL); access tokens
auto-rotate every hour. If the cluster goes `disconnected`:

1. Check the agent pod is `Running`: `kubectl -n kubilitics-system get pod -l app=kubilitics-agent`.
2. Check the hub URL is reachable from the cluster:
   ```bash
   kubectl -n kubilitics-system exec deploy/kubilitics-agent -- /agent --version 2>/dev/null
   # or use a debug pod with curl:
   kubectl -n kubilitics-system run debug --rm -it --image=curlimages/curl --restart=Never -- \
     -sS -o /dev/null -w "%{http_code}\n" https://kubilitics.example.com/health
   ```
3. Check refresh-token validity: `kubectl -n kubilitics-system get secret kubilitics-agent-creds`. If the Secret is missing, force a re-registration by deleting the agent pod (a fresh one will read the bootstrap token from values).
