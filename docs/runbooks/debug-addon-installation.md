# Runbook: Debug Stuck Add-on Installation

**Audience:** Platform operators, cluster administrators
**Last updated:** 2026-03-16
**Applies to:** Kubilitics v0.1.1+

---

## Table of Contents

1. [Overview](#1-overview)
2. [Check Add-on Status via API](#2-check-add-on-status-via-api)
3. [Common Failure Modes](#3-common-failure-modes)
4. [Manual Helm Release Cleanup](#4-manual-helm-release-cleanup)
5. [Force Reinstall Procedure](#5-force-reinstall-procedure)
6. [Debugging the Backend Logs](#6-debugging-the-backend-logs)

---

## 1. Overview

Kubilitics manages add-on installation through its Helm-based add-on platform. Each add-on goes through a lifecycle state machine:

```
pending -> installing -> installed
                     \-> failed
installed -> upgrading -> installed
                      \-> failed
installed -> uninstalling -> (removed)
                         \-> failed
```

An add-on can get "stuck" when the Helm operation times out, the underlying pods fail to start, or the backend loses track of the Helm release state. This runbook covers diagnosis and recovery.

---

## 2. Check Add-on Status via API

### 2.1 List all installed add-ons for a cluster

```bash
CLUSTER_ID="<your-cluster-id>"
TOKEN="<your-jwt-token>"
BASE_URL="https://kubilitics.example.com"

curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/installed" | jq .
```

Look for entries with `"status": "installing"` or `"status": "failed"`.

### 2.2 Get details for a specific install

```bash
INSTALL_ID="<install-id-from-above>"

curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/installed/$INSTALL_ID" | jq .
```

Key fields to examine:

| Field | What to look for |
|---|---|
| `status` | `installing` (stuck) or `failed` |
| `statusMessage` | Error details from Helm or the backend |
| `helmReleaseName` | The Helm release name to inspect with `helm` CLI |
| `helmReleaseNamespace` | Namespace where the release was deployed |
| `addonId` | Which add-on catalog entry was installed |

### 2.3 Check Helm release history

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/installed/$INSTALL_ID/history" | jq .
```

### 2.4 Check audit events

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/installed/$INSTALL_ID/audit" | jq .
```

Audit events show the full lifecycle: who initiated the install, when each state transition happened, and any error messages.

---

## 3. Common Failure Modes

### 3.1 Helm Timeout

**Symptom:** Status is `installing` for more than 10 minutes. Audit shows "context deadline exceeded" or "timed out waiting for the condition".

**Diagnosis:**

```bash
# Check the Helm release status directly
RELEASE_NAME="<helmReleaseName from API>"
RELEASE_NS="<helmReleaseNamespace>"

# From inside the backend pod (it has helm capabilities)
NAMESPACE="kubilitics"
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "$NAMESPACE" "$POD" -c backend -- \
  helm status "$RELEASE_NAME" -n "$RELEASE_NS" --show-desc
```

Or if you have `helm` locally with the same cluster context:

```bash
helm status "$RELEASE_NAME" -n "$RELEASE_NS"
helm history "$RELEASE_NAME" -n "$RELEASE_NS"
```

**Resolution:**

1. Check if the underlying pods are pending (see 3.2 and 3.3)
2. If the Helm release is in `pending-install` state, clean it up (Section 4)
3. Increase Helm timeout in the add-on configuration if the chart legitimately needs more time

### 3.2 Image Pull Failures

**Symptom:** Pods created by the add-on are stuck in `ImagePullBackOff` or `ErrImagePull`.

**Diagnosis:**

```bash
kubectl get pods -n "$RELEASE_NS" -l "app.kubernetes.io/managed-by=Helm,app.kubernetes.io/instance=$RELEASE_NAME"

kubectl describe pod <stuck-pod> -n "$RELEASE_NS" | grep -A5 "Events:"
```

Look for:
- `Failed to pull image`: image name typo, tag does not exist, or registry is unreachable
- `unauthorized`: missing image pull secret

**Resolution:**

```bash
# If the registry requires authentication, create an image pull secret
kubectl create secret docker-registry regcred \
  -n "$RELEASE_NS" \
  --docker-server=registry.example.com \
  --docker-username=user \
  --docker-password=pass

# Patch the service account used by the add-on
kubectl patch serviceaccount default -n "$RELEASE_NS" \
  -p '{"imagePullSecrets": [{"name": "regcred"}]}'
```

Then force reinstall the add-on (Section 5).

### 3.3 RBAC / Permission Errors

**Symptom:** Helm install fails with "forbidden" or "cannot create resource" errors.

**Diagnosis:**

```bash
# Check the Kubilitics service account permissions
kubectl auth can-i create deployments \
  --as=system:serviceaccount:kubilitics:kubilitics \
  -n "$RELEASE_NS"

# Check for specific RBAC errors in backend logs
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=30m | grep -i "forbidden\|rbac\|unauthorized"
```

**Resolution:**

The Kubilitics backend needs cluster-wide permissions to install add-ons into arbitrary namespaces. Ensure the Helm chart's RBAC is enabled:

```yaml
# values.yaml
rbac:
  enabled: true
```

If the add-on needs to create cluster-scoped resources (CRDs, ClusterRoles), the Kubilitics service account needs cluster-admin or equivalent permissions:

```bash
# Temporary escalation (use with caution)
kubectl create clusterrolebinding kubilitics-cluster-admin \
  --clusterrole=cluster-admin \
  --serviceaccount=kubilitics:kubilitics
```

For production, create a scoped ClusterRole with only the permissions needed by your add-ons.

### 3.4 Namespace Does Not Exist

**Symptom:** Helm install fails with "namespace not found".

**Resolution:**

```bash
kubectl create namespace "$RELEASE_NS"
# Then retry the install via the Kubilitics API
```

### 3.5 Resource Quota Exceeded

**Symptom:** Pods fail to schedule. Events show "exceeded quota" or "insufficient cpu/memory".

**Diagnosis:**

```bash
kubectl describe resourcequota -n "$RELEASE_NS"
kubectl describe limitrange -n "$RELEASE_NS"
```

**Resolution:** Either increase the resource quota or reduce the add-on's resource requests in its Helm values.

---

## 4. Manual Helm Release Cleanup

When a Helm release is stuck in `pending-install`, `pending-upgrade`, or `pending-rollback`, it blocks any further operations. Helm will refuse to install, upgrade, or delete.

### 4.1 Check the release state

```bash
helm list -n "$RELEASE_NS" --all --filter "$RELEASE_NAME"
# STATUS column will show: pending-install, pending-upgrade, failed, etc.
```

### 4.2 Rollback a failed upgrade

```bash
# List revisions
helm history "$RELEASE_NAME" -n "$RELEASE_NS"

# Rollback to the last successful revision
helm rollback "$RELEASE_NAME" <revision-number> -n "$RELEASE_NS"
```

### 4.3 Remove a stuck pending-install release

```bash
# This is safe -- pending-install means nothing was actually deployed
helm uninstall "$RELEASE_NAME" -n "$RELEASE_NS" --no-hooks
```

If `helm uninstall` also fails:

```bash
# Nuclear option: remove the Helm release secret directly
kubectl get secrets -n "$RELEASE_NS" -l "owner=helm,name=$RELEASE_NAME"

# Delete all release secrets for this release
kubectl delete secrets -n "$RELEASE_NS" -l "owner=helm,name=$RELEASE_NAME"
```

**Warning:** Deleting Helm secrets directly means Helm loses all knowledge of the release. You must also clean up any resources the chart created (Deployments, Services, ConfigMaps, etc.) manually.

### 4.4 Clean up orphaned resources

After removing a stuck release, check for leftover resources:

```bash
kubectl get all -n "$RELEASE_NS" -l "app.kubernetes.io/instance=$RELEASE_NAME"
kubectl get configmaps,secrets,pvc -n "$RELEASE_NS" -l "app.kubernetes.io/instance=$RELEASE_NAME"

# Delete orphans
kubectl delete all -n "$RELEASE_NS" -l "app.kubernetes.io/instance=$RELEASE_NAME"
kubectl delete configmaps,secrets,pvc -n "$RELEASE_NS" -l "app.kubernetes.io/instance=$RELEASE_NAME"
```

---

## 5. Force Reinstall Procedure

After cleaning up the Helm release (Section 4), you need to update the Kubilitics database to reflect the cleanup, then reinstall.

### Step 1 -- Delete the install record via API

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/installed/$INSTALL_ID"
```

If the API refuses to delete (because the status is `installing`), you may need to update the database directly. This should be a last resort:

```bash
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "$NAMESPACE" "$POD" -c backend -- \
  sqlite3 /data/kubilitics.db \
  "UPDATE addon_installs SET status='failed', status_message='Manually marked failed for cleanup' WHERE id='$INSTALL_ID';"
```

After marking as `failed`, the API DELETE should work:

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/installed/$INSTALL_ID"
```

### Step 2 -- Reinstall the add-on

Use the Kubilitics UI or API to install the add-on again. The catalog endpoint lists available add-ons:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/catalog" | jq '.[] | {id, name, version}'
```

Install:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$BASE_URL/clusters/$CLUSTER_ID/addons/install" \
  -d '{
    "addonId": "<addon-id>",
    "namespace": "<target-namespace>",
    "values": {}
  }'
```

### Step 3 -- Monitor the installation stream

```bash
# The install stream endpoint provides real-time progress via WebSocket
# Use wscat or the Kubilitics UI to monitor
wscat -c "wss://kubilitics.example.com/clusters/$CLUSTER_ID/addons/install/stream?token=$TOKEN"
```

---

## 6. Debugging the Backend Logs

The Kubilitics backend logs all add-on lifecycle events. Key log patterns to search for:

```bash
NAMESPACE="kubilitics"
POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics -o jsonpath='{.items[0].metadata.name}')

# All addon-related logs
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=1h | grep -i "addon\|helm\|install"

# Errors only
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=1h | grep -i "error\|fail\|panic"

# State machine transitions
kubectl logs -n "$NAMESPACE" "$POD" -c backend --since=1h | grep -i "transition\|status"
```

### Increase log verbosity

If the default logs are insufficient, temporarily set the log level to `debug`:

```bash
kubectl set env deployment/kubilitics -n "$NAMESPACE" KUBILITICS_LOG_LEVEL=debug
kubectl rollout restart deployment/kubilitics -n "$NAMESPACE"

# After debugging, restore the normal level
kubectl set env deployment/kubilitics -n "$NAMESPACE" KUBILITICS_LOG_LEVEL=info
kubectl rollout restart deployment/kubilitics -n "$NAMESPACE"
```

---

## Troubleshooting Decision Tree

```
Add-on stuck?
  |
  +-- Status = "installing" for >10 min?
  |     |
  |     +-- Check: helm status <release> -n <ns>
  |     |     |
  |     |     +-- pending-install -> Clean up (Section 4.3), reinstall
  |     |     +-- deployed but pods failing -> Check pods (3.2, 3.3, 3.5)
  |     |
  |     +-- No Helm release found -> DB out of sync, mark failed, reinstall
  |
  +-- Status = "failed"?
  |     |
  |     +-- Check statusMessage for root cause
  |     +-- Fix the underlying issue
  |     +-- Delete install record, reinstall (Section 5)
  |
  +-- API returns 500?
        |
        +-- Check backend logs (Section 6)
        +-- Common: nil pointer (clusterService not initialized)
        +-- Restart backend pod
```
