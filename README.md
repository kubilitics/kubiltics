<p align="center">
  <img src="kubilitics-frontend/public/brand/logo.png" alt="Kubilitics" height="120" />
</p>

<p align="center">
  <strong>The Kubernetes Operating System</strong><br />
  Multi-cluster management · Real-time topology · 55 AI tools · Powerful CLI — all from one platform.
</p>

<p align="center">
  <a href="https://github.com/vellankikoti/kubilitics/releases"><img src="https://img.shields.io/github/v/release/vellankikoti/kubilitics?style=flat-square&color=blue" alt="Release" /></a>
  <a href="https://github.com/vellankikoti/kubilitics/actions"><img src="https://img.shields.io/github/actions/workflow/status/vellankikoti/kubilitics/backend-ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://github.com/vellankikoti/kubilitics/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square" alt="License" /></a>
  <a href="https://kubilitics.com"><img src="https://img.shields.io/badge/website-kubilitics.com-purple?style=flat-square" alt="Website" /></a>
</p>

<p align="center">
  <a href="#%EF%B8%8F-desktop-app-download">Desktop App</a> •
  <a href="#-app-screens">Screens</a> •
  <a href="#%EF%B8%8F-helm-deployment-in-cluster">Helm Deploy</a> •
  <a href="#-features">Features</a> •
  <a href="#-ai-tools-cheatsheet">AI Tools</a> •
  <a href="#-comparison">Comparison</a> •
  <a href="#-architecture-1">Architecture</a> •
  <a href="#-documentation">Docs</a>
</p>

---

## Why Kubilitics?

| Problem | Kubilitics Solution |
|---------|-------------------|
| kubectl is powerful but opaque | **Visual resource intelligence** — see every resource, relationship, and status at a glance |
| Lens is deprecated / desktop-only | **Web + Desktop + In-Cluster** — deploy anywhere, access from any browser |
| Headlamp lacks multi-cluster | **True multi-cluster** — switch between Docker Desktop, EKS, AKS, GKE in one click |
| CLI is disconnected | **Integrated CLI** — kcli (kubectl wrapper) with cluster context management and blast radius analysis |
| Topology is afterthought | **Topology-first** — 5 view modes, semantic zoom, relationship inference, export to PNG, SVG, JSON, CSV |

---

## 🏛️ Architecture

![Kubilitics Architecture](docs/assets/architecture.svg)

---

## 📸 App Screens

> **To view all 8 interactive screens:** open [`docs/assets/app-screens.html`](docs/assets/app-screens.html) in your browser. Each screen is 1280×800 and matches the real production UI.

**Cluster Dashboard** — health score, resource gauges, event feed, namespace breakdown

**Fleet Overview** — all clusters at a glance with provider badges, health scores, and instant context-switching

**Topology View** — 5 view modes (Cluster / Namespace / Workload / RBAC / Resource-Centric) with export to PNG, SVG, JSON, CSV

**Workloads Table** — all deployments with real-time CPU/memory bars, status badges, and one-click inspect/topology

**Pod Detail** — containers, liveness probes, restart history, events, logs, metrics, YAML in one tabbed view

**AI Chat** (`⌘I`) — 55 MCP tools running live inside a chat panel; tool call blocks, safety confirmations, cluster-scoped context

**Events Stream** — 1,500+ events with type/reason/namespace filters and severity coloring

**Blast Radius** — select any resource, see exactly what breaks and what gets disrupted, with AI-recommended safer paths

---

## 🖥️ Desktop App — Download

The fastest way to get started. Signed, notarized releases — no server setup, no Docker, no `kubectl` wrangling needed. The backend runs as a bundled sidecar inside the app.

**[→ Download the latest release](https://github.com/vellankikoti/kubilitics/releases/latest)**

### macOS

```bash
brew tap vellankikoti/kubilitics
brew install --cask kubilitics
```

Or download the `.dmg` directly from the [releases page](https://github.com/vellankikoti/kubilitics/releases/latest).

### Windows

Download the `.msi` or `.exe` installer from the [releases page](https://github.com/vellankikoti/kubilitics/releases/latest) and run it — no admin rights required.

### Linux

Download the `.AppImage`, `.deb`, or `.rpm` from the [releases page](https://github.com/vellankikoti/kubilitics/releases/latest).

### What you get out of the box

- **Auto-discovery** — detects `~/.kube/config` on launch; clusters appear instantly
- **Sidecar backend** — Go backend + kcli bundled as child processes, no separate server
- **Offline-first** — works without internet for local clusters
- **Cross-platform** — macOS (.dmg), Windows (.msi), Linux (.deb / .AppImage / .rpm)
- **Auto-update** — in-app updates delivered automatically on new releases

On first launch, choose **Personal** (local kubeconfig) or **Team Server** (Helm in-cluster). Your `~/.kube/config` is auto-detected — clusters appear on the dashboard immediately.

---

## ⎈ Helm Deployment (In-Cluster)

Deploy Kubilitics to your Kubernetes cluster for team-wide browser access.

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Kubernetes | ≥ 1.24 |
| Helm | ≥ 3.8 (OCI support) |
| kubectl | configured |

### Install

```bash
# Install from OCI registry (recommended)
helm install kubilitics \
  oci://ghcr.io/vellankikoti/charts/kubilitics \
  --version 1.1.0 \
  --namespace kubilitics --create-namespace
```

```bash
# Or install from source
git clone https://github.com/vellankikoti/kubilitics.git
helm install kubilitics ./deploy/helm/kubilitics \
  --namespace kubilitics --create-namespace
```

### Verify

```bash
kubectl get pods -n kubilitics
kubectl get svc -n kubilitics
```

### Access (port-forward for local testing)

```bash
kubectl port-forward -n kubilitics svc/kubilitics 8190:8190
# Open http://localhost:5173 and set backend URL to http://localhost:8190
```

### Production (with Ingress)

```bash
helm install kubilitics \
  oci://ghcr.io/vellankikoti/charts/kubilitics \
  --version 1.1.0 \
  --namespace kubilitics --create-namespace \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=kubilitics.example.com \
  --set config.allowedOrigins="https://kubilitics.example.com"
```

### Full Configuration Reference

```bash
helm show values oci://ghcr.io/vellankikoti/charts/kubilitics --version 1.1.0
```

Key configuration options:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `image.tag` | `0.1.2` | Backend image version |
| `service.port` | `8190` | Backend service port |
| `database.type` | `sqlite` | `sqlite` or `postgresql` |
| `ingress.enabled` | `false` | Enable Ingress |
| `rbac.enabled` | `true` | Create RBAC resources |
| `persistence.enabled` | `true` | Persistent storage for SQLite |
| `config.authMode` | `required` | `required`, `optional`, or `disabled` |
| `serviceMonitor.enabled` | `false` | Prometheus ServiceMonitor |

---

## ✨ Features

### Multi-Cluster Management

Connect and switch between clusters instantly. Tested with:

| Provider | Verified | Notes |
|----------|----------|-------|
| Docker Desktop | ✅ | Auto-detected from `~/.kube/config` |
| AWS EKS | ✅ | Contexts from `aws eks update-kubeconfig` |
| Azure AKS | ✅ | Contexts from `az aks get-credentials` |
| GKE | ✅ | Contexts from `gcloud container clusters get-credentials` |
| k3s / k3d | ✅ | Auto-detected |
| kind | ✅ | Auto-detected |
| Minikube | ✅ | Auto-detected |
| Rancher / RKE2 | ✅ | Via kubeconfig |

### Resource Intelligence (70+ Resource Types)

Every Kubernetes resource type with real-time status, metrics, and drill-down:

**Workloads** — Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, ReplicaSets
**Networking** — Services, Ingresses, NetworkPolicies, EndpointSlices, Gateways (Gateway API)
**Storage** — PVCs, PVs, StorageClasses, VolumeSnapshots, VolumeAttachments
**Config** — ConfigMaps, Secrets, ResourceQuotas, LimitRanges, HPAs, VPAs
**RBAC** — Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, ServiceAccounts
**CRDs** — Custom Resource Definitions with automatic discovery
**Cluster** — Nodes, Namespaces, Events, Leases, PriorityClasses, RuntimeClasses

### Topology Engine (5 View Modes)

Interactive cluster topology powered by React Flow + ELK layout:

- **Cluster View** — Full cluster graph with all resource relationships
- **Namespace View** — Scoped to a namespace with inter-resource connections
- **Workload View** — Deployment → ReplicaSet → Pod → Container chain
- **Resource-Centric** — BFS traversal from any resource with configurable depth
- **RBAC View** — ServiceAccount → Role → RoleBinding permission graph

Export: PNG, SVG, JSON, CSV

### CLI & Operations

- **kcli** — Integrated kubectl with cluster context management
- **Blast Radius Calculator** — Predict impact before making changes
- **In-browser terminal** — Shell access with tab completion and context switching

### Dashboard & Monitoring

- Cluster health score with real-time metrics (CPU, Memory, Pod utilization)
- Capacity planning with donut gauges and trend analysis
- Fleet dashboard for multi-cluster overview
- Event stream with severity filtering

### Security & Auth

- SSO / OIDC / SAML authentication
- RBAC management (Admin / Operator / Viewer) with per-cluster permissions
- Audit logging with CSV export
- API key authentication for programmatic access
- MFA / TOTP support

---

## 🔄 Comparison

| Feature | Kubilitics | Lens | Headlamp | k9s |
|---------|-----------|------|----------|-----|
| Multi-cluster | ✅ Unified | ✅ | ⚠️ Limited | ❌ Single |
| Web access | ✅ Browser + Desktop | ❌ Desktop only | ✅ Web | ❌ Terminal |
| In-cluster deploy | ✅ Helm | ❌ | ✅ Helm | ❌ |
| Topology visualization | ✅ 5 modes + export | ❌ | ❌ | ❌ |
| Integrated CLI | ✅ kcli + shell | ❌ | ❌ | ❌ |
| 70+ resource types | ✅ | ✅ | ⚠️ ~30 | ✅ |
| Dark mode | ✅ System + manual | ✅ | ✅ | ✅ |
| Open source | ✅ Apache 2.0 | ❌ Proprietary | ✅ Apache 2.0 | ✅ Apache 2.0 |
| CRD support | ✅ Auto-discovery | ✅ | ⚠️ | ✅ |
| RBAC management | ✅ Visual | ⚠️ | ❌ | ❌ |
| Cost analysis | ✅ | ❌ | ❌ | ❌ |

---

## 🏗️ Architecture

### Repository Structure

```
kubilitics/
├── kubilitics-backend/        # Go REST API + WebSocket + Topology Engine
│   ├── cmd/server/            # Entry point (port 8190)
│   ├── internal/
│   │   ├── api/               # REST handlers, WebSocket hub
│   │   ├── k8s/               # Kubernetes client (client-go)
│   │   ├── topology/          # Graph builder, ELK layout, relationship inference
│   │   ├── service/           # Business logic, add-on platform
│   │   └── config/            # Configuration, env vars
│   └── go.mod
│
├── kubilitics-frontend/       # React + TypeScript + Vite SPA
│   ├── src/pages/             # 80+ resource pages
│   ├── src/components/        # Reusable UI components
│   ├── src/hooks/             # React Query hooks, K8s data fetching
│   ├── src/stores/            # Zustand state management
│   └── package.json
│
├── kubilitics-desktop/        # Tauri 2.0 desktop app (Rust)
│   ├── src-tauri/             # Rust sidecar manager
│   └── src/                   # Shared frontend
│
├── deploy/helm/kubilitics/    # Helm chart for in-cluster deployment
│   ├── Chart.yaml             # v0.1.0
│   ├── values.yaml            # All configurable values
│   └── templates/             # K8s resource templates
│
└── docs/                      # Architecture, runbooks, guides
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Framer Motion |
| State | Zustand, TanStack Query (React Query) |
| Topology | React Flow, ELK.js (layered layout) |
| Backend | Go 1.24, Gorilla Mux, client-go, SQLite/PostgreSQL |
| Desktop | Tauri 2.0 (Rust), WebView2/WKWebView |
| CLI | kcli (kubectl wrapper with shell integration) |
| CI/CD | GitHub Actions, Helm OCI (ghcr.io) |
| Charts | OCI artifacts at `oci://ghcr.io/vellankikoti/charts` |

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design and component architecture |
| [Integration Model](docs/INTEGRATION-MODEL.md) | Frontend ↔ Backend communication patterns |
| [Topology API](docs/TOPOLOGY-API-CONTRACT.md) | Topology response shape (nodes, edges, metadata) |
| [OpenAPI Spec](docs/api/openapi-spec.yaml) | REST API specification |
| [Release Standards](docs/RELEASE-STANDARDS.md) | Pre-release gate and quality checklist |
| [Helm Chart README](deploy/helm/kubilitics/README.md) | Chart configuration reference |
| [PostgreSQL Guide](docs/guides/postgresql-deployment.md) | Production database setup |
| [Horizontal Scaling](docs/guides/horizontal-scaling.md) | Multi-replica deployment |
| [Backup & Restore](docs/runbooks/backup-restore.md) | Database backup procedures |
| [JWT Rotation](docs/runbooks/rotate-jwt-secrets.md) | Secret rotation runbook |
| [SQLite → PostgreSQL](docs/runbooks/migrate-sqlite-postgresql.md) | Database migration guide |

---

## 🤖 AI Tools Cheatsheet

Kubilitics ships a built-in AI brain (open at `Cmd+I` / `Ctrl+I`) backed by **55 verified MCP tools** across four categories. All tools are safety-gated and cluster-scoped to your active cluster.

### Observation — read raw cluster state

| Tool | What it does |
|------|-------------|
| `list_resources` | List any K8s resource kind (Pods, Deployments, Services, Nodes, …) |
| `get_resource` | Full spec + status for a single named resource |
| `get_logs` | Pod logs with optional container, tail count, and time filter |
| `get_events` | Recent events filtered by namespace, object name, or reason |
| `get_cluster_health` | Overall health score, node count, pod count, component statuses |
| `get_topology` | Cluster topology graph — nodes, edges, and relationships |
| `search_resources` | Cross-kind fuzzy search by name or label |
| `observe_pod_metrics` | CPU + memory for a specific pod |
| `observe_node_metrics` | CPU + memory for a specific node |
| `observe_metrics` | CPU + memory for any resource kind |

### Inspect — deep-dive on a specific resource

27 `inspect_<kind>` tools that return enriched summaries, owner chains, health signals, and related resources — one per K8s kind:

`inspect_pod` · `inspect_node` · `inspect_namespace` · `inspect_service` · `inspect_ingress` · `inspect_networkpolicy` · `inspect_deployment` · `inspect_replicaset` · `inspect_statefulset` · `inspect_daemonset` · `inspect_job` · `inspect_cronjob` · `inspect_pvc` · `inspect_pv` · `inspect_storageclass` · `inspect_role` · `inspect_rolebinding` · `inspect_clusterrole` · `inspect_clusterrolebinding` · `inspect_secret` · `inspect_configmap` · `inspect_limitrange` · `inspect_resourcequota` · `inspect_hpa` · `inspect_pdb` · `inspect_vpa` · `inspect_crd`

### Analysis — AI-powered diagnostics

| Tool | What it does |
|------|-------------|
| `analyze_pod_health` | Restart counts, OOMKills, eviction patterns in a namespace |
| `analyze_deployment_health` | Rollout status, replica gaps, strategy issues |
| `analyze_node_pressure` | Memory / disk / PID pressure and eviction risk |
| `detect_resource_contention` | CPU/memory hot-spots and noisy neighbours |
| `analyze_network_connectivity` | Service-to-pod reachability and endpoint health |
| `analyze_rbac_permissions` | Permission gaps, over-privilege, and binding chains |
| `analyze_storage_health` | PVC binding status, capacity, and reclaim policy issues |
| `check_resource_limits` | Missing limits/requests and quota violations |
| `analyze_hpa_behavior` | Scaling history, target drift, and thrash detection |
| `analyze_log_patterns` | Error pattern extraction across pod logs |
| `assess_security_posture` | Privilege escalation, host-path mounts, root containers |
| `detect_configuration_drift` | Spec vs actual divergence across workloads |

### Execution — safety-gated cluster mutations

All execution tools require explicit user confirmation and pass through the safety engine before any change is made.

| Tool | What it does |
|------|-------------|
| `restart_pod` | Delete a pod to trigger a clean restart |
| `scale_deployment` | Set replica count on a Deployment |
| `cordon_node` | Mark a node unschedulable |
| `drain_node` | Evict pods and cordon a node for maintenance |
| `rollback_deployment` | Roll back a Deployment to a previous revision |
| `update_resource_limits` | Patch CPU/memory limits on a workload |
| `apply_resource_patch` | Apply a strategic-merge patch to any resource |
| `trigger_hpa_scale` | Force an HPA min/max adjustment |
| `delete_resource` | Delete a named resource (requires double-confirm) |

---

## 🚀 Quick Start (Web App / Source)

If you'd prefer to run the web app from source rather than the desktop installer:

```bash
# Terminal 1: Backend
cd kubilitics-backend
go run ./cmd/server
# Backend running at http://localhost:8190

# Terminal 2: Frontend
cd kubilitics-frontend
npm install && npm run dev
# Open http://localhost:5173
```

On first visit, choose **Personal** (local kubeconfig) or **Team Server** (Helm in-cluster). Your `~/.kube/config` is auto-detected — clusters appear automatically.

---

## 🧪 Development

### Prerequisites

- **Go** 1.24+ (backend)
- **Node.js** 20+ (frontend)
- **Rust** 1.75+ (desktop only)
- **Kubernetes cluster** (any — Docker Desktop works)

### Run Everything (two terminals)

```bash
# Terminal 1: Backend
cd kubilitics-backend && go run ./cmd/server

# Terminal 2: Frontend
cd kubilitics-frontend && npm install && npm run dev
```

Backend: http://localhost:8190 • Frontend: http://localhost:5173 • Metrics: http://localhost:8190/metrics

#### Port conflicts (all platforms)

The desktop dev session binds **fixed** ports — no fallback. If 8190 (backend),
8081/50061 (AI server), or 5173 (Vite) is already held, the sidecar exits with
a message naming the offending PID and the exact platform-native kill command.
`scripts/dev-preflight.mjs` (Node, cross-platform) runs before `cargo tauri dev`
and clears stale listeners from prior crashed sessions on macOS, Linux, **and**
Windows. If a port is held by an unrelated app, free it manually:

```bash
# macOS / Linux
lsof -ti tcp:8190 | xargs kill -9
```

```powershell
# Windows (PowerShell or cmd)
for /f "tokens=5" %a in ('netstat -ano ^| findstr :8190 ^| findstr LISTENING') do taskkill /F /PID %a
```

In-cluster (Helm chart): the backend is the only process in its container, so
8190 is always free and the fail-loud check is a no-op.

### Tests

```bash
# Backend
cd kubilitics-backend && go test -count=1 ./...

# Frontend
cd kubilitics-frontend && npm run test

# Vulnerability scan
cd kubilitics-backend && govulncheck ./...
```

### Build

```bash
# Backend binary
cd kubilitics-backend && go build -o bin/kubilitics-backend ./cmd/server

# Frontend production build
cd kubilitics-frontend && npm run build

# Desktop
cd kubilitics-desktop && npm install && cargo tauri build
```

| Platform | Output |
|----------|--------|
| macOS | `src-tauri/target/release/bundle/dmg/Kubilitics.dmg` |
| Windows | `src-tauri/target/release/bundle/msi/Kubilitics.msi` |
| Linux | `src-tauri/target/release/bundle/deb/kubilitics.deb` |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Run tests: `cd kubilitics-backend && go test ./... && cd ../kubilitics-frontend && npm run test`
4. Commit: `git commit -m 'feat: add my feature'`
5. Push: `git push origin feature/my-feature`
6. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 📜 License

Apache 2.0 — See [LICENSE](LICENSE) for details.

---

## 📧 Links

- **Website**: [kubilitics.com](https://kubilitics.com)
- **GitHub**: [github.com/vellankikoti/kubilitics](https://github.com/vellankikoti/kubilitics)
- **Issues**: [github.com/vellankikoti/kubilitics/issues](https://github.com/vellankikoti/kubilitics/issues)
- **Helm Charts**: `oci://ghcr.io/vellankikoti/charts/kubilitics`

---

<p align="center">
  <strong>Built with ❤️ by the Kubilitics team</strong><br />
  <sub>The Kubernetes Operating System — making K8s human-friendly.</sub>
</p>
