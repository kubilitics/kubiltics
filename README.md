<p align="center">
  <img src="kubilitics-frontend/public/kubilitics-logo.svg" alt="Kubilitics" height="80" />
</p>

<h1 align="center">Kubilitics</h1>

<p align="center">
  <strong>The Kubernetes Operating System</strong><br />
  Multi-cluster management, real-time topology, AI-powered operations — all from one platform.
</p>

<p align="center">
  <a href="https://github.com/kubilitics/kubilitics/releases"><img src="https://img.shields.io/github/v/release/kubilitics/kubilitics?style=flat-square&color=blue" alt="Release" /></a>
  <a href="https://github.com/kubilitics/kubilitics/actions"><img src="https://img.shields.io/github/actions/workflow/status/kubilitics/kubilitics/backend-ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://github.com/kubilitics/kubilitics/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square" alt="License" /></a>
  <a href="https://kubilitics.com"><img src="https://img.shields.io/badge/website-kubilitics.com-purple?style=flat-square" alt="Website" /></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-multi-cluster-demo">Demo</a> •
  <a href="#%EF%B8%8F-helm-deployment-in-cluster">Helm Deploy</a> •
  <a href="#-desktop-app">Desktop</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-documentation">Docs</a>
</p>

---

<!--
  📸 SCREENSHOT PLACEHOLDER
  Replace this with an actual screenshot of the Kubilitics dashboard.
  Recommended: 1920x1080 PNG showing multi-cluster dashboard with 3 clusters connected.

  ![Kubilitics Dashboard](docs/images/dashboard-hero.png)
-->

## Why Kubilitics?

| Problem | Kubilitics Solution |
|---------|-------------------|
| kubectl is powerful but opaque | **Visual resource intelligence** — see every resource, relationship, and status at a glance |
| Lens is deprecated / desktop-only | **Web + Desktop + In-Cluster** — deploy anywhere, access from any browser |
| Headlamp lacks multi-cluster | **True multi-cluster** — switch between Docker Desktop, EKS, AKS, GKE in one click |
| No AI in existing tools | **AI-powered operations** — kcli (AI kubectl), blast radius analysis, incident investigation |
| Topology is afterthought | **Topology-first** — 5 view modes, semantic zoom, relationship inference, export to PNG/SVG/Draw.io |

---

## 🚀 Quick Start

### Option 1: Web App (fastest — 2 minutes)

```bash
# 1. Start the backend
cd kubilitics-backend
go run ./cmd/server
# Backend running at http://localhost:819

# 2. Start the frontend (in a new terminal)
cd kubilitics-frontend
npm install && npm run dev
# Open http://localhost:5173
```

On first visit, choose **Personal** (local kubeconfig) or **Team Server** (Helm in-cluster).
Your `~/.kube/config` is auto-detected — clusters appear automatically.

### Option 2: Desktop App (macOS / Windows / Linux)

```bash
cd kubilitics-desktop
npm install
cargo tauri dev
```

The desktop app bundles the backend as a sidecar — no separate server needed.

### Option 3: Helm (In-Cluster Deployment)

See [Helm Deployment](#%EF%B8%8F-helm-deployment-in-cluster) below.

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

<!--
  📸 SCREENSHOT PLACEHOLDER: Multi-cluster switcher showing 3 connected clusters
  ![Multi-Cluster](docs/images/multi-cluster-switcher.png)
-->

### Resource Intelligence (70+ Resource Types)

Every Kubernetes resource type with real-time status, metrics, and drill-down:

**Workloads** — Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, ReplicaSets
**Networking** — Services, Ingresses, NetworkPolicies, EndpointSlices, Gateways (Gateway API)
**Storage** — PVCs, PVs, StorageClasses, VolumeSnapshots, VolumeAttachments
**Config** — ConfigMaps, Secrets, ResourceQuotas, LimitRanges, HPAs, VPAs
**RBAC** — Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, ServiceAccounts
**CRDs** — Custom Resource Definitions with automatic discovery
**Cluster** — Nodes, Namespaces, Events, Leases, PriorityClasses, RuntimeClasses

<!--
  📸 SCREENSHOT PLACEHOLDER: Resource list page showing Deployments with status badges
  ![Resources](docs/images/resource-list.png)
-->

### Topology Engine (5 View Modes)

Interactive cluster topology powered by React Flow + ELK layout:

- **Cluster View** — Full cluster graph with all resource relationships
- **Namespace View** — Scoped to a namespace with inter-resource connections
- **Workload View** — Deployment → ReplicaSet → Pod → Container chain
- **Resource-Centric** — BFS traversal from any resource with configurable depth
- **RBAC View** — ServiceAccount → Role → RoleBinding permission graph

Export: PNG, SVG, JSON, CSV, Draw.io

<!--
  📸 SCREENSHOT PLACEHOLDER: Topology view showing resource relationships
  ![Topology](docs/images/topology-view.png)
-->

### AI-Powered Operations

- **kcli** — AI-powered kubectl replacement with natural language commands
- **Blast Radius Calculator** — Predict impact before making changes
- **AI Investigation** — Root cause analysis for failing resources
- **Safety Guard** — AI actions require human approval (configurable autonomy levels 1-5)

### Dashboard & Monitoring

- Cluster health score with real-time metrics (CPU, Memory, Pod utilization)
- Capacity planning with donut gauges and trend analysis
- Fleet dashboard for multi-cluster overview
- Event stream with severity filtering

### Enterprise Features

- SSO / OIDC authentication
- RBAC management and audit logging
- Cost dashboard and SLO monitoring
- Backup/restore for cluster state
- Compliance dashboard
- Network policy templates

---

## 🎬 Multi-Cluster Demo

<!--
  🎥 VIDEO PLACEHOLDER
  Record a 3-5 minute demo showing:
  1. Mode Selection (Personal vs Team Server)
  2. Connect Docker Desktop cluster (auto-detected)
  3. Dashboard with health metrics
  4. Switch to EKS cluster — show workloads, pods, topology
  5. Switch to AKS cluster — show namespaces, services
  6. Fleet Dashboard showing all 3 clusters
  7. Resource drill-down: Deployment → ReplicaSet → Pod → Containers → Logs
  8. Topology view with relationship graph
  9. kcli AI command demo

  Upload to YouTube and replace the link below:

  [![Kubilitics Demo](https://img.youtube.com/vi/VIDEO_ID/maxresdefault.jpg)](https://www.youtube.com/watch?v=VIDEO_ID)
-->

> **Demo video coming soon** — Multi-cluster walkthrough with Docker Desktop, AWS EKS, and Azure AKS.

---

## ⎈ Helm Deployment (In-Cluster)

Deploy Kubilitics to your Kubernetes cluster for team-wide access.

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
  oci://ghcr.io/kubilitics/charts/kubilitics \
  --version 1.0.0 \
  --namespace kubilitics --create-namespace
```

```bash
# Or install from source
git clone https://github.com/kubilitics/kubilitics.git
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
kubectl port-forward -n kubilitics svc/kubilitics 819:819
# Open http://localhost:5173 and set backend URL to http://localhost:819
```

### Production (with Ingress)

```bash
helm install kubilitics \
  oci://ghcr.io/kubilitics/charts/kubilitics \
  --version 1.0.0 \
  --namespace kubilitics --create-namespace \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=kubilitics.example.com \
  --set config.allowedOrigins="https://kubilitics.example.com"
```

### With AI Backend

```bash
helm install kubilitics \
  oci://ghcr.io/kubilitics/charts/kubilitics \
  --version 1.0.0 \
  --namespace kubilitics --create-namespace \
  --set ai.enabled=true \
  --set ai.secret.enabled=true \
  --set ai.secret.anthropicApiKey="sk-ant-..."
```

### Full Configuration Reference

```bash
helm show values oci://ghcr.io/kubilitics/charts/kubilitics --version 1.0.0
```

Key configuration options:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `image.tag` | `1.0.0` | Backend image version |
| `service.port` | `819` | Backend service port |
| `database.type` | `sqlite` | `sqlite` or `postgresql` |
| `ingress.enabled` | `false` | Enable Ingress |
| `ai.enabled` | `false` | Enable AI backend |
| `rbac.enabled` | `true` | Create RBAC resources |
| `persistence.enabled` | `true` | Persistent storage for SQLite |
| `config.authMode` | `required` | `required`, `optional`, or `disabled` |
| `serviceMonitor.enabled` | `false` | Prometheus ServiceMonitor |

---

## 🖥️ Desktop App

Native desktop application built with Tauri 2.0 (Rust + WebView):

- **Auto-discovery** — detects `~/.kube/config` on launch
- **Sidecar backend** — Go backend + AI + kcli bundled as child processes
- **Offline-first** — works without internet for local clusters
- **Cross-platform** — macOS (.dmg), Windows (.msi), Linux (.deb/.AppImage)

### Build from Source

```bash
cd kubilitics-desktop
npm install
cargo tauri build
```

| Platform | Output |
|----------|--------|
| macOS | `src-tauri/target/release/bundle/dmg/Kubilitics.dmg` |
| Windows | `src-tauri/target/release/bundle/msi/Kubilitics.msi` |
| Linux | `src-tauri/target/release/bundle/deb/kubilitics.deb` |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         KUBILITICS                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│   │  Desktop     │  │  Web App     │  │  In-Cluster (Helm)   │  │
│   │  Tauri 2.0   │  │  React+Vite  │  │  K8s Deployment      │  │
│   └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│          │                  │                      │               │
│          └──────────────────┼──────────────────────┘               │
│                             │                                      │
│                    ┌────────▼────────┐                             │
│                    │   Go Backend    │  REST API + WebSocket       │
│                    │   Port 819     │  SQLite / PostgreSQL        │
│                    └────────┬────────┘                             │
│                             │                                      │
│              ┌──────────────┼──────────────┐                      │
│              │              │              │                       │
│     ┌────────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐               │
│     │  Topology     │ │  K8s     │ │  AI Backend │               │
│     │  Engine       │ │  Client  │ │  Port 8081  │               │
│     │  (ELK+React   │ │  (client │ │  (Claude /  │               │
│     │   Flow)       │ │   -go)   │ │   OpenAI)   │               │
│     └───────────────┘ └────┬─────┘ └────────────┘               │
│                             │                                      │
│                    ┌────────▼────────┐                             │
│                    │  Kubernetes     │                             │
│                    │  Cluster(s)     │                             │
│                    │  EKS / AKS /   │                             │
│                    │  GKE / Docker   │                             │
│                    └─────────────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

### Repository Structure

```
kubilitics/
├── kubilitics-backend/        # Go REST API + WebSocket + Topology Engine
│   ├── cmd/server/            # Entry point (port 819)
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
├── kubilitics-ai/             # AI backend service (Go)
│   └── cmd/ai/               # Entry point (port 8081)
│
├── kcli/                      # AI-powered kubectl replacement (Go)
│   └── cmd/kcli/             # CLI entry point
│
├── kubilitics-desktop/        # Tauri 2.0 desktop app (Rust)
│   ├── src-tauri/             # Rust sidecar manager
│   └── src/                   # Shared frontend
│
├── deploy/helm/kubilitics/    # Helm chart for in-cluster deployment
│   ├── Chart.yaml             # v1.0.0
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
| Backend | Go 1.25, Gorilla Mux, client-go, SQLite/PostgreSQL |
| Desktop | Tauri 2.0 (Rust), WebView2/WKWebView |
| AI | Claude (Anthropic), OpenAI, Ollama (self-hosted) |
| CI/CD | GitHub Actions, Helm OCI (ghcr.io) |
| Charts | OCI artifacts at `oci://ghcr.io/kubilitics/charts` |

---

## 🧪 Development

### Prerequisites

- **Go** 1.25+ (backend, kcli)
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

Backend: http://localhost:819 • Frontend: http://localhost:5173 • Metrics: http://localhost:819/metrics

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

# kcli
cd kcli && go build -o bin/kcli ./cmd/kcli
```

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

## 🔄 Comparison

| Feature | Kubilitics | Lens | Headlamp | k9s |
|---------|-----------|------|----------|-----|
| Multi-cluster | ✅ Unified | ✅ | ⚠️ Limited | ❌ Single |
| Web access | ✅ Browser + Desktop | ❌ Desktop only | ✅ Web | ❌ Terminal |
| In-cluster deploy | ✅ Helm | ❌ | ✅ Helm | ❌ |
| Topology visualization | ✅ 5 modes + export | ❌ | ❌ | ❌ |
| AI operations | ✅ kcli + investigation | ❌ | ❌ | ❌ |
| 70+ resource types | ✅ | ✅ | ⚠️ ~30 | ✅ |
| Dark mode | ✅ System + manual | ✅ | ✅ | ✅ |
| Open source | ✅ Apache 2.0 | ❌ Proprietary | ✅ Apache 2.0 | ✅ Apache 2.0 |
| CRD support | ✅ Auto-discovery | ✅ | ⚠️ | ✅ |
| RBAC management | ✅ Visual | ⚠️ | ❌ | ❌ |
| Cost analysis | ✅ | ❌ | ❌ | ❌ |

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
- **GitHub**: [github.com/kubilitics/kubilitics](https://github.com/kubilitics/kubilitics)
- **Issues**: [github.com/kubilitics/kubilitics/issues](https://github.com/kubilitics/kubilitics/issues)
- **Helm Charts**: `oci://ghcr.io/kubilitics/charts/kubilitics`

---

<p align="center">
  <strong>Built with ❤️ by the Kubilitics team</strong><br />
  <sub>The Kubernetes Operating System — making K8s human-friendly.</sub>
</p>
