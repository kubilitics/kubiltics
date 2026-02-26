# Changelog

All notable changes to Kubilitics will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.1.1] - 2026-02-26

### Fixed
- Backend: nil-pointer panic in `ExecuteUpgrade` when `clusterService` is not injected (test and standalone-binary scenarios)
- Backend: community add-on IDs in registry tests updated to reflect `community/repo/chart` format used by ArtifactHub URL routing

### Added
- kcli: cost visibility commands (`kcli cost`) and security scan (`kcli security`)
- kcli: embedded terminal mode fixes and improved shell integration
- kcli: intent-aware AI tool selection replacing fixed 128-tool truncation
- Frontend: premium UI redesign — new metric visualisations, section enhancements, and layout polish
- Frontend: add-on catalog, install wizard, and lifecycle management UI
- Frontend: resource comparison view and YAML diff utilities
- Frontend: security dashboard components (HolographicMedal, NeuralScanner, SecurityPulse)
- Frontend: live resource updates hook and natural language search improvements
- Backend: add-on platform — catalog, install/upgrade/rollback lifecycle, Velero backup checkpoints, audit log, notification channels, maintenance windows, private catalog sources, rollout tracking
- Backend: OpenAPI spec for add-on endpoints
- Backend: Velero pre-upgrade backup checkpoint (non-fatal; upgrade proceeds on backup failure)
- docs: `docs/release-steps.md` — step-by-step runbook for future releases

### Changed
- Backend: community add-on ID format changed from `community/<packageID>` to `community/<repoName>/<chartName>` to support ArtifactHub `GetPackageByID` lookups
- Website moved to standalone repo (`Kubernetes/kubilitics-website`)

## [Unreleased]

### Foundation Phase - 2026-02-04

#### Added
- Initial project structure for backend, desktop, and mobile
- Go backend foundation with Kubernetes client integration
- Tauri desktop application scaffolding
- Tauri mobile application scaffolding
- Topology engine foundation with graph data structures
- REST API handlers for clusters and topology
- Data models for Cluster, Resource, Topology, Events
- Service layer (ClusterService, TopologyService)
- Configuration management with Viper
- Comprehensive documentation (README, ARCHITECTURE, TASKS)
- Contributing guidelines and security policy

#### Backend
- Kubernetes client-go v0.30.0 integration
- Resource discovery for core types (Pods, Deployments, Services, ReplicaSets, ConfigMaps, Secrets)
- Basic relationship inference (OwnerReferences, Label Selectors, Volume Mounts)
- Deterministic layout seed generation
- Graph validation (orphan edge detection)
- HTTP server with graceful shutdown
- CORS middleware
- Health check endpoint

#### Desktop
- Tauri 2.0 configuration
- Rust IPC commands (read_kubeconfig, get_app_data_dir)
- Sidecar process manager for Go backend
- Cross-platform build configuration
- File system access for kubeconfig

#### Mobile
- Tauri Mobile library setup
- API client for remote backend
- Commands for cluster connection and topology fetching

#### Documentation
- Comprehensive README with quick start
- Architecture deep-dive (topology engine, data flow)
- Complete task list with 200+ tasks
- Contributing guidelines
- Security policy

### In Progress
- [ ] Complete Kubernetes resource discovery (50+ types)
- [ ] Complete relationship inference (RBAC, Network, Autoscaling)
- [ ] WebSocket real-time layer
- [ ] Database persistence layer
- [ ] Export service (PNG, PDF, SVG)
- [ ] Desktop frontend integration
- [ ] Mobile native features (biometric auth, push notifications)
- [ ] Comprehensive testing suite

---

## [1.0.0] - TBD

### Planned Features

#### Backend
- Complete topology engine with all relationship types
- WebSocket real-time updates
- SQLite/PostgreSQL persistence
- Export service (PNG, PDF, SVG)
- Logs and metrics collection
- Events streaming

#### Desktop
- Full frontend integration
- Kubeconfig auto-detection
- Native menus and system tray
- Auto-updater
- Multi-cluster support

#### Mobile
- iOS app (App Store)
- Android app (Play Store)
- Offline mode with sync
- Biometric authentication
- Push notifications
- QR code connection

#### Testing
- 85%+ code coverage
- Integration tests with K8s
- E2E tests with Playwright
- Topology truth tests
- Performance benchmarks

#### Infrastructure
- CI/CD pipeline
- Automated releases
- Code signing
- App store submissions

---

---

## [0.1.0] - 2026-02-20

### 🚀 Kubilitics v0.1.0 — Desktop MVP

First public release of **Kubilitics** — an open-source, cross-platform Kubernetes cluster management desktop app built with Tauri, Go, and React.

#### ✨ What's Included

**Desktop App (macOS)**
- Native macOS app (`Kubilitics.app`) built with Tauri — no Electron, ~20MB
- Embedded Go sidecar backend (`kubilitics-backend`) on port 819
- AI sidecar (`kubilitics-ai`) for intelligent cluster insights
- kcli embedded terminal for interactive kubectl sessions
- Auto-detects `~/.kube/config` on launch — zero setup required

**Cluster Management**
- Multi-cluster support with kubeconfig auto-detection
- Real-time cluster overview — nodes, pods, namespaces, warnings
- SSE-based live overview stream (no polling)
- Cluster status tracking: connected / disconnected / error

**Resource Browser**
- Full CRUD for all standard Kubernetes resource types
- Nodes, Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs
- Services, Ingresses, ConfigMaps, Secrets, PVCs, PVs, StorageClasses
- RBAC: Roles, ClusterRoles, ServiceAccounts
- CRDs, MutatingWebhooks, ValidatingWebhooks
- Resource YAML editor with apply support
- Section overview pages: Networking, Storage, Scaling, Admission, CRDs

**Topology Visualisation**
- Interactive cluster topology graph (Cytoscape.js)
- Resource-level topology for any workload
- Draw.io export

**AI Assistant**
- Supports OpenAI, Anthropic (Claude), Ollama, and custom endpoints
- Model catalog with provider-specific model dropdowns
- API key stored securely in backend SQLite (never in localStorage)
- Toggle AI on/off without losing configuration

**Built-in Terminal**
- kcli: full interactive kubectl shell via WebSocket PTY
- Tab completion, history, real cluster context
- Pod exec support

#### 🐛 Key Bugs Fixed in This Release

| Bug | Fix |
|-----|-----|
| Empty cards / 503 errors on app launch | Circuit breaker half-open race condition fixed — breaker now recovers automatically |
| Requests routing to Vite dev server instead of sidecar | `__VITE_IS_TAURI_BUILD__` build-time constant eliminates `isTauri()` timing race |
| Cluster wiped on every restart | `BackendClusterValidator` now auto-reconnects on 503 instead of clearing cluster ID |
| API keys leaking to localStorage | `apiKey` removed from Zustand `partialize` — backend SQLite only |
| Azure/none provider sent to Go backend | `toBackendProvider()` centralises mapping to `openai/anthropic/ollama/custom` |

#### 🔌 New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/clusters/{id}/reconnect` | Reset circuit breaker + rebuild K8s client |
| `GET` | `/api/v1/clusters/{id}/overview/stream` | SSE real-time overview stream |

#### 🏗️ Architecture

```
Kubilitics.app
├── kubilitics-desktop  (Tauri host, Rust)
├── kubilitics-frontend (React + TypeScript, embedded in app)
├── kubilitics-backend  (Go sidecar, port 819 — K8s API, REST)
└── kubilitics-ai       (Go sidecar — AI, analytics, cost)
```

#### 📥 Installation

Download `Kubilitics.app.tar.gz` from the assets below, extract, move to `/Applications`, and launch.
Requires macOS (arm64/Apple Silicon). Your `~/.kube/config` is auto-detected on first launch.

#### 🗺️ What's Next — v0.1.1

- MCP (Model Context Protocol) server integration
- Feature enhancements and bug fixes from community feedback
- Linux and Windows desktop builds

> Built with ❤️ by [@vellankikoti](https://github.com/vellankikoti)

---

## Version History

### Pre-1.0 (Foundation)
- 0.1.0 - Desktop MVP (2026-02-20)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to Kubilitics.

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
