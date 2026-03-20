# Runbook: Rotate JWT Secrets

**Audience:** Platform operators, security engineers
**Last updated:** 2026-03-16
**Applies to:** Kubilitics v0.1.1+

---

## Table of Contents

1. [Overview](#1-overview)
2. [When to Rotate](#2-when-to-rotate)
3. [Generate a New Secret](#3-generate-a-new-secret)
4. [Update the Kubernetes Secret](#4-update-the-kubernetes-secret)
5. [Rolling Restart](#5-rolling-restart)
6. [Verify Token Validation](#6-verify-token-validation)
7. [Emergency Revocation](#7-emergency-revocation)
8. [Automating Rotation](#8-automating-rotation)

---

## 1. Overview

Kubilitics uses JWT (JSON Web Tokens) for API authentication when `config.authMode` is set to `required` (the production default). The signing secret is stored in a Kubernetes Secret and injected via the `KUBILITICS_AUTH_JWT_SECRET` environment variable. The Helm chart manages this through `secret.authJWTSecret` in `values.yaml`.

Rotating the JWT secret invalidates all existing tokens, forcing users to re-authenticate. Plan the rotation during a maintenance window or ensure your client applications handle 401 responses gracefully.

---

## 2. When to Rotate

| Trigger | Urgency |
|---|---|
| Scheduled rotation (every 90 days recommended) | Planned maintenance |
| Team member with secret access leaves the organization | Within 24 hours |
| Secret exposed in logs, version control, or incident | Immediately |
| Compliance audit requires rotation evidence | Per policy schedule |
| Suspected unauthorized access | Immediately |

---

## 3. Generate a New Secret

The JWT secret must be at least **32 characters** long. Use a cryptographically secure random generator:

```bash
# Option A: OpenSSL (recommended)
NEW_SECRET=$(openssl rand -base64 48)
echo "$NEW_SECRET"

# Option B: /dev/urandom
NEW_SECRET=$(head -c 48 /dev/urandom | base64)

# Option C: Python
NEW_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
```

Store the generated secret temporarily. Do **not** commit it to version control.

---

## 4. Update the Kubernetes Secret

### Option A: Patch the existing Secret directly

```bash
NAMESPACE="kubilitics"
SECRET_NAME="kubilitics"  # or your custom secret.name from values.yaml

kubectl patch secret "$SECRET_NAME" -n "$NAMESPACE" \
  --type='json' \
  -p="[{\"op\": \"replace\", \"path\": \"/data/auth-jwt-secret\", \"value\": \"$(echo -n "$NEW_SECRET" | base64)\"}]"
```

### Option B: Delete and recreate

```bash
kubectl create secret generic "$SECRET_NAME" -n "$NAMESPACE" \
  --from-literal=auth-jwt-secret="$NEW_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Option C: Update via Helm values

Update your `values-production.yaml`:

```yaml
secret:
  enabled: true
  authJWTSecret: "<new-secret-value>"  # Will be base64 encoded by the chart
```

Then upgrade:

```bash
helm upgrade kubilitics deploy/helm/kubilitics/ \
  -n kubilitics \
  -f values-production.yaml
```

### Verify the Secret was updated

```bash
kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" \
  -o jsonpath='{.data.auth-jwt-secret}' | base64 -d
# Should match $NEW_SECRET
```

---

## 5. Rolling Restart

The backend reads `KUBILITICS_AUTH_JWT_SECRET` at startup. After updating the Secret, restart the pods to pick up the new value.

### Single-replica deployment (default)

```bash
kubectl rollout restart deployment kubilitics -n "$NAMESPACE"
kubectl rollout status deployment kubilitics -n "$NAMESPACE" --timeout=120s
```

### Multi-replica deployment

With `replicaCount > 1` and a PodDisruptionBudget, the rolling restart ensures zero downtime:

```bash
kubectl rollout restart deployment kubilitics -n "$NAMESPACE"

# Monitor the rollout -- old pods continue serving with the OLD secret
# until new pods are ready with the NEW secret
kubectl rollout status deployment kubilitics -n "$NAMESPACE" --timeout=300s
```

**Important:** During the rolling restart window, there is a brief period where old pods (old secret) and new pods (new secret) coexist. Tokens issued by old pods will fail validation on new pods and vice versa. This window is typically under 60 seconds. If this is unacceptable, scale to 0 first:

```bash
# Zero-downtime is sacrificed for consistency
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=0
kubectl rollout status deployment kubilitics -n "$NAMESPACE"
kubectl scale deployment kubilitics -n "$NAMESPACE" --replicas=2
kubectl rollout status deployment kubilitics -n "$NAMESPACE"
```

---

## 6. Verify Token Validation

### Step 1 -- Confirm old tokens are rejected

```bash
OLD_TOKEN="eyJhbGciOiJIUzI1NiIs..."  # A token issued before rotation

curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $OLD_TOKEN" \
  https://kubilitics.example.com/clusters
# Expected: 401
```

### Step 2 -- Obtain a new token and verify it works

```bash
# Login with credentials to get a new token
NEW_TOKEN=$(curl -s -X POST https://kubilitics.example.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<admin-password>"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  https://kubilitics.example.com/clusters
# Expected: 200
```

### Step 3 -- Verify the health endpoint

```bash
curl -s https://kubilitics.example.com/health | jq .
# {"status":"ok","version":"0.1.1", ...}
```

---

## 7. Emergency Revocation

If you suspect token compromise and need to immediately invalidate **all** sessions:

### Step 1 -- Generate and apply a new secret immediately

```bash
EMERGENCY_SECRET=$(openssl rand -base64 48)
NAMESPACE="kubilitics"
SECRET_NAME="kubilitics"

kubectl patch secret "$SECRET_NAME" -n "$NAMESPACE" \
  --type='json' \
  -p="[{\"op\": \"replace\", \"path\": \"/data/auth-jwt-secret\", \"value\": \"$(echo -n "$EMERGENCY_SECRET" | base64)\"}]"
```

### Step 2 -- Force-restart all pods simultaneously

```bash
# Delete all pods at once (not a rolling restart)
kubectl delete pods -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics --force --grace-period=0
```

This causes a brief outage but ensures **no pod** can validate old tokens after restart.

### Step 3 -- Notify users

All existing sessions are now invalid. Users must re-authenticate. If using OIDC or SAML, the re-authentication is transparent (redirect to IdP). For local users, they must log in again.

### Step 4 -- Audit

Check backend logs for any suspicious activity before the rotation:

```bash
kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=kubilitics \
  --since=1h --all-containers | grep -i "auth\|token\|unauthorized"
```

---

## 8. Automating Rotation

### Using External Secrets Operator

If you use [External Secrets Operator](https://external-secrets.io/), store the JWT secret in AWS Secrets Manager, HashiCorp Vault, or Azure Key Vault and configure automatic rotation:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: kubilitics-jwt
  namespace: kubilitics
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: kubilitics
    creationPolicy: Merge
  data:
    - secretKey: auth-jwt-secret
      remoteRef:
        key: kubilitics/jwt-secret
        property: value
```

### Using Reloader for automatic restarts

Install [Stakater Reloader](https://github.com/stakater/Reloader) to automatically restart pods when the Secret changes:

```yaml
# Add to deployment metadata.annotations
metadata:
  annotations:
    reloader.stakater.com/auto: "true"
```

This eliminates the manual rolling restart step.

---

## Rotation Checklist

- [ ] Generate new secret (minimum 32 characters, cryptographically random)
- [ ] Update Kubernetes Secret
- [ ] Rolling restart backend pods
- [ ] Verify old tokens return 401
- [ ] Verify new tokens return 200
- [ ] Verify `/health` endpoint is healthy
- [ ] Update secret in your secrets manager / vault
- [ ] Document rotation date for compliance audit trail
