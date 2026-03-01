# Changelog

All notable changes to Kubilitics will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.1.1] - 2026-03-02

### Added

**kcli TUI (k9s-like Terminal UI)**
- Namespace switching: Enter on a namespace row switches context and reloads pods (like k9s)
- Direct namespace command: `:ns <name>` switches namespace without navigating to namespace list; `:ns all` reverts to all-namespaces mode
- Unit tests covering all namespace switch scenarios
- Cost visibility commands (`kcli cost`) and security scan (`kcli security`)
- Intent-aware AI tool selection replacing fixed 128-tool truncation
- Embedded terminal mode with shell completion and aliases

**Backend**
- Add-on platform: catalog sync (ArtifactHub), install/upgrade/rollback lifecycle, drift detection, dependency resolution
- Port-forward handler for pod port forwarding via REST API
- API key prefix migration for improved security
- Body-limit middleware, metrics auth, RBAC enhancements
- WebSocket hub improvements with per-cluster per-user connection limits
- Topology engine: resource-level topology, relationship inference enhancements
- OpenAPI spec for add-on endpoints

**Frontend**
- Production UI hardening across 40+ pages and components
- Add-on catalog, install wizard (dependency plan, dry-run, preflight, execute steps)
- Topology engine: D3 canvas, Cytoscape engine, AGT renderer, export (CSV, JSON, PDF, PNG, SVG)
- Resource comparison view and YAML diff utilities
- Overview pagination, notification formatter, table sizing utilities
- Code editor, log viewer, and terminal viewer improvements
- Connection-required banner, backend status banner polish

**Desktop**
- Tauri 2.0 sidecar bundling (backend + AI + kcli)
- CSP updated for images, WebSocket, fonts
- Cross-platform build configuration (macOS, Windows, Linux)

### Fixed
- kcli TUI: namespace selection no longer shows detail view — it switches context and reloads resources
- Backend: send-on-closed-channel panic in WebSocket stream handlers (kcli_stream.go, shell_stream.go) — context cancelled before channel close
- Backend: WebSocket origin validation now includes 127.0.0.1 and [::1] loopback variants (fixes Vite dev server connections)
- Frontend: shell panel default mode changed from 'shell' to 'ui' (Bubble Tea TUI) for better out-of-box experience
- Frontend: shell panel z-index raised to z-[60] so it renders above all UI layers
- Frontend: input isolation — UI mode bypasses shell-mode tab completion and line buffer tracking
- Frontend: global keyboard shortcuts (g+p, g+n, /) no longer capture keystrokes meant for terminal
- Frontend: WebSocket URL constructor fixed (missing colon in protocol)
- Desktop: version strings aligned across tauri.conf.json, Cargo.toml, and package.json
- CI: Go toolchain bumped to 1.25.7 — resolves 10 stdlib CVEs
- CI: context-aware kubectl calls fix watch-loop blocking in tests

### Architecture

```
Kubilitics
├── kubilitics-desktop  (Tauri 2.0 host, Rust)
├── kubilitics-frontend (React + TypeScript + Vite SPA)
├── kubilitics-backend  (Go REST API + WebSocket, SQLite, port 819)
├── kubilitics-ai       (Go AI backend service, port 8081)
└── kcli                (AI-powered kubectl CLI replacement, Go)
```

### Installation

**Desktop (macOS)**
Download `Kubilitics.app.tar.gz` from the release assets, extract, move to `/Applications`, and launch.
Your `~/.kube/config` is auto-detected on first launch.

**Helm (In-Cluster)**
```bash
helm install kubilitics deploy/helm/kubilitics \
  --set image.tag=0.1.1 \
  --namespace kubilitics --create-namespace
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment instructions.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to Kubilitics.

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
