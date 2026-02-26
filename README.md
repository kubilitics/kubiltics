# Kubilitics - The Kubernetes Operating System

**A production-grade Kubernetes management platform** that makes K8s finally human-friendly.

## 🎯 Project Overview

Kubilitics is delivered as:

1. **Desktop Application** (macOS, Windows, Linux) - Offline-first, local Kubernetes management
2. **Mobile Application** (iOS, Android) - Remote cluster monitoring and management
3. **Backend Services** (Go) - Core engine, topology builder, API layer

**NO SaaS. NO Cloud Accounts. NO Authentication.**

This is a native application that connects directly to your Kubernetes clusters.

---

## 📚 Repository Structure

```
.
├── kubilitics-backend/         Go backend services
│   ├── cmd/server/             Main entry point
│   ├── internal/
│   │   ├── api/                REST & WebSocket APIs
│   │   ├── k8s/                Kubernetes client integration
│   │   ├── topology/           Topology engine
│   │   ├── service/            Business logic
│   │   ├── models/             Data models
│   │   └── config/             Configuration
│   └── go.mod
│
├── kubilitics-desktop/         Tauri desktop application
│   ├── src/                    React frontend
│   ├── src-tauri/              Rust backend
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── commands.rs
│   │   │   └── sidecar.rs
│   │   └── tauri.conf.json
│   └── Cargo.toml
│
├── kubilitics-frontend/        Web app (React + TypeScript + Vite)
│   ├── src/                    App source, pages, components, stores
│   ├── public/
│   └── package.json
│
├── kubilitics-website/         Marketing/landing site (Vite + React/TS)
│   ├── src/                    Pages, components, assets
│   └── package.json
│
├── kubilitics-mobile/          Tauri mobile application
│   ├── src/                    React frontend
│   ├── src-tauri/              Rust core
│   │   └── src/lib.rs
│   ├── gen/
│   │   ├── android/            Android project
│   │   └── apple/              iOS project
│   └── Cargo.toml
│
├── project-docs/               Implementation guides & architecture docs
│   ├── IMPLEMENTATION-GUIDE.md
│   ├── backend-part-*.md
│   ├── frontend-part-*.md
│   └── tauri-*-implementation.md
│
├── tests/                      End-to-end tests
│   ├── e2e/                    Playwright tests
│   ├── integration/            Go integration tests
│   └── fixtures/               Test data
│
└── docs/                       Project documentation
    ├── ARCHITECTURE.md
    ├── INTEGRATION-MODEL.md    How frontend connects (backend vs direct K8s)
    ├── TOPOLOGY-API-CONTRACT.md  Canonical topology API response shape (nodes/edges/metadata)
    └── PHASE1_COMPLETION_REPORT.md
```

---

## 📖 Documentation

- **[Architecture](docs/ARCHITECTURE.md)** — System and component architecture.
- **[Integration model](docs/INTEGRATION-MODEL.md)** — How the frontend connects to the backend (gateway) vs direct Kubernetes API. **Canonical:** use backend when present; optional direct K8s URL when backend is not used.
- **[Topology API contract](docs/TOPOLOGY-API-CONTRACT.md)** — Canonical topology response shape: nodes (`kind`, `id`, `metadata`, `computed`), edges (`relationshipType`, `source`, `target`), `metadata.layoutSeed`, `metadata.isComplete`. OpenAPI: `kubilitics-backend/api/swagger.yaml`.
- **[Observability](docs/OBSERVABILITY.md)** — Structured logging (request ID, JSON), Prometheus metrics (`/metrics`), graceful shutdown and timeouts.
- **[Isolation model](docs/ISOLATION-MODEL.md)** — Data isolation: cluster as boundary, single-tenant deployment, API enforcement (D1.1).
- **[Secure defaults](docs/SECURE-DEFAULTS.md)** — Input validation, secure headers, destructive-action confirmation (X-Confirm-Destructive), apply size limit (D1.2).
- **[Retention](docs/RETENTION.md)** — Retention strategies for audit logs, topology snapshots, metrics (D1.3).
- **[SSO design](docs/SSO-DESIGN.md)** — Optional SSO integration (SAML/OIDC), group-based access (D2.1).
- **[Distribution](docs/DISTRIBUTION.md)** — Desktop build pipeline, code signing, installers, Helm chart, CI/CD, release automation (Phase R).
- **[Release process](docs/RELEASE-PROCESS.md)** — Versioning, tagging, changelog, GitHub releases (O1.3).
- **[Pre-push and live E2E checklist](docs/PRE-PUSH-AND-LIVE-E2E.md)** — Local verification, push checklist, and live app E2E steps.
- **Implementation guides** — See [project-docs/](project-docs/) for backend, frontend, and Tauri blueprints.

---

## ✨ Key Features

### Backend

✅ **Exhaustive Resource Discovery** - Discovers all 50+ K8s resource types + CRDs  
✅ **Topology Engine** - Builds complete relationship graphs with deterministic layout  
✅ **Real-Time Updates** - WebSocket streams for live cluster state  
✅ **REST API** - Full CRUD operations for all resources  
✅ **Export Service** - WYSIWYG topology export (PNG, PDF, SVG)  

### Desktop

✅ **Offline-First** - Works without internet (for local clusters)  
✅ **Auto-Discovery** - Automatically detects kubeconfig  
✅ **Native UI** - Platform-native window chrome  
✅ **Sidecar Backend** - Go backend runs as child process  
✅ **Cross-Platform** - macOS, Windows, Linux  

### Mobile

✅ **Remote Management** - Connect to cluster-local backend  
✅ **Offline Mode** - Caches data for offline viewing  
✅ **Biometric Auth** - Face ID / Touch ID / Fingerprint  
✅ **Push Notifications** - Alerts for cluster events  
✅ **Touch-Optimized** - Mobile-first UI  

---

## 🚀 Quick Start

### Prerequisites

- **Go** 1.24+
- **Rust** 1.75+
- **Node.js** 20+
- **Kubernetes cluster** (kind/k3s/minikube/EKS/GKE/etc.)

### One-command dev (backend + frontend)

From the repo root:

```bash
# Copy env template (KUBILITICS_*, VITE_API_URL)
cp .env.example .env   # optional; edit as needed

# Start backend then frontend (single command)
make dev
```

Or run in two terminals: `make backend-dev` and `make frontend-dev`. Backend: http://localhost:819. Frontend: http://localhost:5173 (Vite). Metrics: http://localhost:819/metrics. See `project-docs/PORTS.md` for all ports.

### 1. Backend

```bash
cd kubilitics-backend

# Install dependencies
go mod download

# Run backend
go run ./cmd/server

# Backend runs on http://localhost:819 (override with KUBILITICS_PORT)
```

### 2. Desktop

```bash
cd kubilitics-desktop

# Install dependencies
npm install
cargo install tauri-cli --version ^2.0

# Build Go backend
cd ../kubilitics-backend
go build -o ../kubilitics-desktop/src-tauri/binaries/kubilitics-backend cmd/server/main.go

# Run desktop app
cd ../kubilitics-desktop
cargo tauri dev
```

### 3. Mobile

```bash
cd kubilitics-mobile

# Install dependencies
npm install
cargo install tauri-cli --version ^2.0

# iOS
cargo tauri ios init
cargo tauri ios dev

# Android
cargo tauri android init
cargo tauri android dev
```

### 4. Web app (kubilitics-frontend)

```bash
cd kubilitics-frontend
npm install
npm run dev
# App runs on http://localhost:5173 (or next available port)
```

### 5. Website (kubilitics-website)

```bash
cd kubilitics-website
npm install
npm run dev
# Landing site runs on http://localhost:5173 (or next available port)
```

---

## 🛠️ Development

### Backend Development

```bash
# Run tests
cd kubilitics-backend
go test ./...

# Run with coverage
go test -v -race -coverprofile=coverage.out ./...

# Build binary
go build -o bin/kubilitics-backend cmd/server/main.go
```

### Desktop Development

```bash
# Development mode (hot reload)
cargo tauri dev

# Build for production
cargo tauri build

# Platform-specific builds
cargo tauri build --target x86_64-apple-darwin  # macOS Intel
cargo tauri build --target aarch64-apple-darwin # macOS Apple Silicon
cargo tauri build --target x86_64-pc-windows-msvc # Windows
cargo tauri build --target x86_64-unknown-linux-gnu # Linux
```

### Mobile Development

```bash
# iOS development
cargo tauri ios dev

# Android development
cargo tauri android dev

# Build for release
cargo tauri ios build --release
cargo tauri android build --release
```

---

## 📦 Building & Distribution

### Desktop

**macOS:**
```bash
cargo tauri build --target universal-apple-darwin
# Output: src-tauri/target/release/bundle/dmg/Kubilitics.dmg
```

**Windows:**
```bash
cargo tauri build --target x86_64-pc-windows-msvc
# Output: src-tauri/target/release/bundle/msi/Kubilitics.msi
```

**Linux:**
```bash
cargo tauri build --target x86_64-unknown-linux-gnu
# Output: src-tauri/target/release/bundle/deb/kubilitics.deb
```

### Mobile

**iOS (App Store):**
```bash
xcodebuild -workspace gen/apple/Kubilitics.xcworkspace \
  -scheme Kubilitics \
  -configuration Release \
  -archivePath build/Kubilitics.xcarchive \
  archive
```

**Android (Play Store):**
```bash
cd gen/android
./gradlew bundleRelease
# Output: app/build/outputs/bundle/release/app-release.aab
```

---

## 🧪 Testing

### Unit Tests

```bash
# Backend
cd kubilitics-backend
go test ./...

# Desktop (Rust)
cd kubilitics-desktop/src-tauri
cargo test
```

### Integration Tests

```bash
# Set up test cluster
kind create cluster --name kubilitics-test

# Run integration tests
cd kubilitics-backend
go test -v ./tests/integration/...
```

### E2E Tests

```bash
# Install Playwright
npm install -D @playwright/test
npx playwright install

# Run E2E tests
npx playwright test
```

---

## 📝 API Documentation

### REST API

Base URL: `http://localhost:8080/api/v1`

#### Clusters

- `GET /clusters` - List all configured clusters
- `POST /clusters` - Add new cluster
- `GET /clusters/{id}` - Get cluster details
- `DELETE /clusters/{id}` - Remove cluster
- `GET /clusters/{id}/summary` - Get cluster summary

#### Topology

- `GET /clusters/{id}/topology` - Get topology graph
  - Query params: `?namespace=default`
- `POST /clusters/{id}/topology/export` - Export topology
  - Body: `{"format": "png|pdf|svg"}`

#### WebSocket

- `WS /ws/resources` - Real-time resource updates
- `WS /ws/events` - Kubernetes events stream

---

## 🏛️ Architecture

### Backend Architecture

```
┌────────────────────────────────────────┐
│          KUBILITICS BACKEND              │
├────────────────────────────────────────┤
│                                          │
│  API LAYER (REST + WebSocket)           │
│  ↓                                       │
│  SERVICE LAYER (Business Logic)         │
│  ↓                                       │
│  TOPOLOGY ENGINE (Graph Builder)        │
│  ↓                                       │
│  K8S CLIENT (client-go)                 │
│  ↓                                       │
│  KUBERNETES CLUSTER                     │
│                                          │
└────────────────────────────────────────┘
```

### Desktop Architecture

```
┌────────────────────────────────────────┐
│       KUBILITICS DESKTOP APP           │
├────────────────────────────────────────┤
│  REACT FRONTEND (WebView)              │
│  ↕ IPC                                 │
│  TAURI CORE (Rust)                     │
│  │                                      │
│  ├─ Native APIs (File, Dialog, etc)   │
│  └─ Sidecar Manager                  │
│      ↓                                  │
│  GO BACKEND (Child Process)            │
│  localhost:8080                        │
└────────────────────────────────────────┘
```

---

## 🧑‍💻 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📜 License

Apache 2.0

---

## 📧 Support

For questions and support:
- GitHub Issues: https://github.com/kubilitics/kubilitics
- Documentation: https://docs.kubilitics.com

---

**Built with ❤️ by the Kubilitics team**
