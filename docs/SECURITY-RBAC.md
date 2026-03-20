# RBAC and Identity Model (C3.1)

## Current behavior: single identity per cluster

The Kubilitics backend uses **one Kubernetes identity per cluster**. Each registered cluster is associated with a kubeconfig (and context); the backend creates a single client per cluster and uses it for all requests to that cluster.

**Implication: all users of the backend see the same visibility.** Anyone who can call the Kubilitics API can see and do whatever the cluster’s kubeconfig allows. There is no per-user or per-request identity: the backend does not forward the caller’s credentials or tokens to the Kubernetes API.

## 403 propagation

When the Kubernetes API returns **403 Forbidden** (e.g. RBAC denies the service account or kubeconfig identity), the backend:

- Maps the error to HTTP **403** in the API response (no downgrade to 500 or generic error).
- Returns the K8s error message in the response body so clients can show “Forbidden” and the reason (e.g. “secrets is forbidden: User \"system:serviceaccount:...\" cannot list resource \"secrets\"”).

Handlers that call the K8s client (ListResources, GetResource, DeleteResource, ApplyManifest) use `apierrors.IsForbidden(err)` and respond with `http.StatusForbidden` and `err.Error()`. This is implemented in `internal/api/rest/resources.go`.

## Future: per-request identity

To support “users see only what they’re allowed to,” the backend would need to:

- Accept per-request identity (e.g. OIDC token or forwarded user token).
- Create or reuse a K8s client that uses that identity for the request (e.g. impersonation or a per-user client).
- Map 403 from K8s to 403 in the API as today.

Until then, deployments that need user-scoped visibility should either use one Kubilitics instance per tenant or integrate an auth layer that restricts which clusters and namespaces a caller can access at the API gateway level.
