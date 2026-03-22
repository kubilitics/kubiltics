# Changelog

All notable changes to Kubilitics will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.2.0] - 2026-03-22

### Added

**DevSecOps Scanning Engine**
- Trivy filesystem vulnerability scanning with SARIF output
- Semgrep SAST analysis for Go, TypeScript, and Dockerfile
- Gitleaks secrets detection with pre-commit integration
- Kubescape Kubernetes security scanning against NSA/CISA framework
- Full CI workflow for automated security scanning on every PR

**Enterprise Settings Page Redesign**
- Complete visual overhaul with SectionCard-based layout
- Cluster management with switch/delete actions always visible
- Desktop engine info, analytics toggle, and system diagnostics
- About section with product/version/platform/license metadata

**Unified Detail Page UX**
- SectionCard pattern applied to all 51 resource detail pages
- Labels, Annotations, Selector sections on all 18 detail pages
- Apple-grade segmented-control tab bar with spring animation
- Consistent hero stat cards across Pod, Deployment, ReplicaSet, StatefulSet, DaemonSet

### Fixed

**Performance**
- Eliminated 500+ concurrent API requests on page load via staleTime/gcTime
- Resource sidebar counts use 10-minute staleTime to prevent re-fetching
- Deployment Pods tab now shows only owner-filtered pods (not label-matched strays)

**Stability**
- Settings page no longer freezes or shows infinite skeleton loading
- CronJobDetail hooks violation fixed (useMemo after early return)
- All addon/AI traces removed (8,187 lines cleaned)
- ESLint errors and warnings resolved for production readiness

**CI/CD**
- Helm chart schema if/then conditionals fixed for all Helm versions
- Kind smoke test: PostgreSQL disabled, label selectors corrected, E2E auth-mode detection
- HEAD method support on health endpoints for Docker/CI health checks
- CORS integration tests fixed to use GET with header dump
- Backend port migrated from 819 to 8190 across entire codebase

### Changed
- Default Helm authMode changed from "required" to "optional" (dev-friendly)
- Helm chart version bumped to 0.2.0
- Frontend version bumped to 0.2.0

## [v0.1.2] - 2026-03-20

### Breaking Changes

**AI Layer Removed**
- Removed entire `kubilitics-ai/` Go module (LLM providers, MCP server, analytics engine, reasoning, safety framework, security scanner, cost optimizer)
- Removed all frontend AI components, hooks, stores, services, and pages
- Removed AI from Helm chart, CI/CD workflows, Docker build, desktop sidecar
- AI code preserved at https://github.com/vellankikoti/kotg.git (branch `feat/kubilitics-ai-module`)

### Added

**In-Cluster Deployment Fixes**
- Frontend pod CrashLoopBackOff resolved (readOnlyRootFilesystem, emptyDir permissions, Dockerfile fixes)
- In-cluster backend discovery via ServiceAccount-based `rest.InClusterConfig()` fallback
- Frontend-to-backend connectivity via nginx reverse proxy with relative URLs when `IN_CLUSTER=true`
- `values-ci.yaml` for Kind cluster testing configuration

**Multi-Cluster Support**
- Unified "Add Cluster" flow across all entry points
- Fleet Dashboard for multi-cluster overview
- Cost Dashboard, SLO Dashboard, Compliance Dashboard
- RBAC Management and RBAC Reports pages

**Topology v2 Engine**
- React Flow + ELK layout with semantic zoom
- Five view modes: Cluster, Namespace, Workload, Resource-centric, RBAC
- Full-resolution PNG/SVG/JSON/CSV/Draw.io export
- Relationship inference for ConfigMaps, Secrets, ServiceAccounts, RBAC resources

**Design System**
- Unified Apple-level design system with premium light and dark themes
- Loading states, micro-interactions, and skeleton loaders
- WCAG accessibility audit with centralized design tokens

**Performance**
- Three-tier layout strategy preventing page freeze on large topologies
- Virtualized log viewer with dynamic row heights
- Adaptive ELK + category grid hybrid layout

### Fixed
- Backend cluster discovery in-cluster (no kubeconfig available)
- Frontend backend URL resolution returning localhost in-cluster
- Vite manualChunks breaking React imports
- Docker entrypoint permissions for nginx config.js injection
- Watch loop blocking kubectl with `exec.CommandContext`

### Removed
- `kubilitics-ai/` — entire AI backend module (150+ files)
- `.github/workflows/ai-ci.yml`
- All AI Helm templates (ai-deployment, ai-service, ai-secret, ai-serviceaccount, ai-pvc)
- Frontend: 50+ AI components, 20+ AI hooks, 3 AI stores, AI service layer
- Desktop: AI sidecar process management
- Docker: AI build target, AI service in docker-compose

### Architecture

```
Kubilitics
├── kubilitics-desktop  (Tauri 2.0 host, Rust)
├── kubilitics-frontend (React + TypeScript + Vite SPA)
├── kubilitics-backend  (Go REST API + WebSocket, SQLite, port 8190)
└── kcli                (AI-powered kubectl CLI replacement, Go)
```

### Installation

**Desktop (macOS)**
Download `Kubilitics.app.tar.gz` from the release assets, extract, move to `/Applications`, and launch.
Your `~/.kube/config` is auto-detected on first launch.

**Helm (In-Cluster)**
```bash
helm install kubilitics oci://ghcr.io/kubilitics/charts/kubilitics \
  --version 0.1.2 \
  --namespace kubilitics --create-namespace
```

---

## [v0.1.1] - 2026-03-02

### Added

**kcli TUI (k9s-like Terminal UI)**
- Namespace switching, direct namespace command (`:ns <name>`)
- Cost visibility commands and security scan
- Intent-aware AI tool selection
- Embedded terminal mode with shell completion

**Backend**
- Add-on platform: catalog sync, install/upgrade/rollback lifecycle
- Port-forward handler, API key prefix migration
- WebSocket hub improvements, topology engine enhancements

**Frontend**
- Production UI hardening across 40+ pages
- Add-on catalog and install wizard
- Topology engine: D3 canvas, Cytoscape engine, export formats

**Desktop**
- Tauri 2.0 sidecar bundling (backend + kcli)
- Cross-platform build configuration

### Fixed
- kcli TUI namespace selection behavior
- Backend WebSocket send-on-closed-channel panic
- Frontend shell panel and keyboard shortcut isolation
- CI Go toolchain bumped for stdlib CVE fixes

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to Kubilitics.

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
