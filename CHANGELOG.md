# Changelog

All notable changes to Kubilitics will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.0.0] - 2026-03-14

### Highlights

Kubilitics v1.0.0 is the first stable release — a major milestone with 67 commits of new features, design overhaul, and production hardening since v0.1.3.

### Added

**Topology v2 Engine**
- Complete topology v2 visualization engine with React Flow, ELK layout, and semantic zoom
- Five view modes: Cluster, Namespace, Workload, Resource-centric (BFS), and RBAC
- Namespace selector and view mode filtering for scoped exploration
- Resource-centric deep linking with configurable traversal depth
- Full-resolution PNG/SVG/JSON/CSV/Draw.io export with descriptive filenames
- Relationship inference for ConfigMaps, Secrets, ServiceAccounts, and RBAC resources
- Per-kind truncation tracking for large clusters with warning messages
- Performance benchmarks and determinism tests for topology builds

**Design System Overhaul**
- Unified Apple-level design system with premium light theme
- Complete dark mode system with system preference detection and manual toggle
- Loading states, micro-interactions, and skeleton loaders across all pages
- WCAG accessibility audit with centralized design tokens
- Redesigned overview pages with consistent UX and human-friendly labels
- Redesigned ModeSelection and HomePage with cluster metrics (CPU/Memory)

**UX Improvements**
- Simulated Linux shell terminal replacing raw shell access
- Fast mutation polling for real-time resource updates
- List/detail page UX enhancements with reusable components
- Settings: Appearance, Keyboard Shortcuts, and About sections
- Auto-mode detection for streamlined onboarding (browser vs desktop)
- Global search redesign with namespace filter integration
- Sidebar resource counts for all resource types
- DetailPodTable with group actions integrated across all detail pages

**Performance**
- Three-tier layout strategy preventing page freeze on large topologies
- Adaptive ELK + category grid hybrid layout for all topology views
- Adaptive export scaling for large namespaces

### Fixed

- Default browser users to desktop mode, fixing broken /connect page
- Namespace filter double-toggle caused by label+Radix Checkbox interaction
- CPU values display with 3 decimal precision instead of stripped zeros
- Namespace selection persistence in URL for back-button navigation
- Never allow empty namespace set preventing all-namespaces freeze
- Default to "default" namespace (like kubectl) to avoid loading all resources
- Backend topology: import cycle in v2 benchmark tests resolved
- Backend topology: per-kind truncation tracking (KindTruncated field) added to Graph

### Desktop

- Version strings synchronized across tauri.conf.json (1.0.0), Cargo.toml (1.0.0), and package.json (1.0.0)
- URL/port configuration validated: backend (819), AI (8081), frontend dev (5173) all correctly wired
- CSP policy verified for all localhost connections
- Sidecar binary management (backend + AI + kcli) verified
- Tauri updater endpoint configured at releases.kubilitics.dev

## [v0.1.3] - 2026-03-07

### Fixed

**Topology Export**
- Fix zero-byte PNG exports for large namespaces (130+ resources) — canvas scale now dynamically capped to stay within browser's ~32767px max dimension limit
- Fix `URL.revokeObjectURL` race condition causing zero-byte downloads for large files — delayed revocation by 30s across all export utilities and 57 detail pages
- Fix SVG/PNG exports on Tauri desktop — now route through Tauri-aware `downloadFile()` instead of inline blob URLs that fail in webview
- Fix `exportPNG()` method name in ResourceTopologyTab — was calling nonexistent `exportPNG` instead of `exportAsPNG`
- Add dynamic scale cap to `exportPng.ts`, `CytoscapeCanvas.tsx`, and `TopologyCanvas.tsx` — prevents empty data URLs when graph exceeds canvas limits

**Topology UX**
- Fix edge labels invisible at fit-to-screen zoom — set `min-zoomed-font-size: 0` with `font-size: 12` and dark color
- Fix namespace cross-filter bug — clicking node filter no longer resets namespace to "All Namespaces"
- Fix loading state — show spinner overlay instead of mock graph while topology loads
- Redesign resource type filter badges — compact K8s abbreviations (Deploy, STS, PVC, CM) with group separators and tooltips
- Add descriptive export filenames with cluster/namespace/resource context and timestamps across all export formats

**Backend**
- Cache pod specs during topology discovery to eliminate ~200 redundant per-pod API calls during relationship inference
- O(1) edge deduplication in GraphEnhancer using Set-based lookup instead of O(edges) linear scan

## [v0.1.2] - 2026-03-02

### Fixed

**Frontend UX**
- Resource status cards: adaptive grid layout that fills rows evenly (3-10 cards)
- Resource status cards: truncate long values (UUIDs, PVC names) with tooltip on hover
- Resource status cards: uniform card heights across all resolutions
- Resource status cards: monospace font auto-applied to technical values
- Resource status cards: uppercase label hierarchy for better scannability
- Topology overlays: all 6 overlay types (Health, Cost, Security, Performance, Dependency, Traffic) wired in per-resource topology views
- Topology export: loading toast feedback (toast.loading → toast.success/error) for all export formats
- Topology overlay legend panel with color scale and metadata stats
- Toasts in Tauri desktop: removed `next-themes` dependency (no ThemeProvider in tree caused silent failures in WKWebView)
- Toasts in Tauri desktop: removed `backdrop-filter` CSS (known WKWebView rendering bug for fixed-position elements)
- Toasts in Tauri desktop: added explicit z-index and pointer-events for portal visibility
- CodeEditor: migrated from CodeMirror to Monaco Editor for YAML editing
- YamlViewer: upgraded with diff view and multi-version support
- HomePage: cluster card text overflow handling
- AIAssistant: drag constraint boundaries

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
  --set image.tag=1.0.0 \
  --namespace kubilitics --create-namespace
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed deployment instructions.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to Kubilitics.

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
