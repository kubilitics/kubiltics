# Kubilitics — Integration Model

**Status:** Canonical  
**Source:** TASKS.md (v2.0) — Task A1.1  
**Purpose:** Define how the frontend obtains cluster data: via the Kubilitics backend (gateway) or directly from the Kubernetes API.

---

## 1. Canonical model: backend as gateway

When the **Kubilitics backend is present and configured**, the frontend MUST use it as the **sole gateway** to cluster data.

- **Frontend** talks only to the backend base URL (e.g. `http://localhost:8080`).
- **Backend** exposes the Kubilitics API at `/api/v1` (e.g. `/api/v1/clusters`, `/api/v1/clusters/{clusterId}/topology`, `/api/v1/clusters/{clusterId}/resources/...`). The path parameter name is **clusterId** (not `id`) in both OpenAPI and handler code; see `kubilitics-backend/api/swagger.yaml` and `internal/api/rest/`.
- **Backend** talks to one or more Kubernetes clusters (via kubeconfig or in-cluster config) and returns aggregated, normalized data.
- **No direct Kubernetes API URL** is configured in the frontend when running in this mode.

This applies to:

- **Desktop app:** Frontend loads in the Tauri WebView and uses the sidecar backend (e.g. `http://localhost:8080`). No K8s API URL is needed.
- **Web app (in-cluster or dev):** Frontend is configured with the backend URL (e.g. the URL of the Kubilitics service). All cluster and resource requests go through the backend.
- **Mobile app:** Connects to a backend instance (local or remote). No kubeconfig or direct K8s URL on the device.

**Benefits:**

- Single place for auth, RBAC, caching, and topology.
- Same API contract for desktop, web, and mobile.
- Backend can support multiple clusters and normalize responses.

---

## 2. Optional mode: direct Kubernetes API URL

When the **backend is not present or not used** (e.g. quick dev against a real cluster, or a special deployment), the frontend MAY be configured with a **direct Kubernetes API URL**.

- **Frontend** sends requests to the K8s API base URL (e.g. `https://cluster.example.com` or a proxy URL).
- **Paths** follow Kubernetes API conventions (e.g. `/api/v1/namespaces/default/pods`, `/apis/apps/v1/deployments`).
- **Topology** and other Kubilitics-specific endpoints are **not available** in this mode unless provided by a separate service.

This mode is **optional** and **documented for:**

- Local development when the backend is not running and the developer points the frontend at a kind/minikube/k3s API (or a proxy).
- Environments where the backend is deliberately not deployed and the UI is used only for read-only K8s API access.

**Limitations:**

- No multi-cluster via backend; no Kubilitics topology API; no backend-side caching or normalization.
- The frontend may show a reduced feature set or different UX when in “direct K8s” mode.

---

## 3. How the frontend chooses the mode

- **Desktop:** Always “backend as gateway” (sidecar). Backend URL is fixed (e.g. `http://localhost:8080`) or read from Tauri/env.
- **Web / Mobile:**  
  - If a **backend URL** is set (e.g. in settings or env), the frontend uses **backend as gateway** and all cluster/resource/topology requests go to `/api/v1/...` on that base URL.  
  - If **no backend URL** is set but a **Kubernetes API URL** is set (e.g. for dev), the frontend may use **direct K8s** mode and talk to the K8s API paths.  
- The frontend MUST NOT mix both modes for the same data (e.g. clusters from backend and resources from direct K8s in one session) unless explicitly designed and documented.

---

## 4. Summary

| Backend present? | Frontend data path        | Use case                    |
|------------------|---------------------------|-----------------------------|
| Yes              | Backend only (gateway)    | Desktop, web, mobile (canonical) |
| No               | Optional direct K8s URL   | Dev or special deployments  |

**Canonical production path:** Frontend → Kubilitics backend → Kubernetes API(s).  
**Optional path:** Frontend → Kubernetes API (direct), when backend is not used and documented.
