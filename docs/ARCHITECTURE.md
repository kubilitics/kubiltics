# Kubilitics Architecture

## System Overview

Kubilitics is a production-grade Kubernetes management platform designed around three core principles:

1. **NO SaaS** - Desktop and mobile applications, not web services
2. **Direct Connection** - Applications connect directly to Kubernetes clusters
3. **Offline-First** - Desktop works entirely offline for local clusters

## Component Architecture

### 1. Backend (Go)

**Purpose**: Core engine for Kubernetes interaction and topology generation

**Technology Stack**:
- Go 1.24+
- client-go v0.30.0 (official Kubernetes client)
- Gorilla Mux (HTTP routing)
- Gorilla WebSocket (real-time updates)
- SQLite (desktop) / PostgreSQL (production)

**Core Responsibilities**:

1. **Kubernetes Client Integration**
   - Connects to K8s API via kubeconfig
   - Supports in-cluster and external connections
   - Handles authentication and authorization

2. **Resource Discovery**
   - Discovers ALL resource types (50+ core + CRDs)
   - Uses dynamic client for unknown types
   - Maintains resource watchers for real-time updates

3. **Topology Engine** (🔑 CORE FEATURE)
   - Builds complete relationship graphs
   - Infers relationships:
     - OwnerReferences (Pod → ReplicaSet → Deployment)
     - Label Selectors (Service → Pods)
     - Volume Mounts (Pod → ConfigMap/Secret/PVC)
     - Environment References (Pod → ConfigMap/Secret)
     - RBAC Bindings (ServiceAccount → Role → RoleBinding)
     - Network Policies
   - Generates deterministic layout seeds (same graph = same positions)
   - Validates graph completeness (no orphan nodes/edges)

4. **REST API**
   - Cluster management (CRUD)
   - Resource operations (CRUD)
   - Topology generation
   - Export service (PNG, PDF, SVG)

5. **WebSocket Real-Time Layer**
   - Streams resource updates
   - Streams Kubernetes events
   - Broadcasts topology changes

**API Endpoints**:

```
GET    /api/v1/clusters
POST   /api/v1/clusters
GET    /api/v1/clusters/{id}
DELETE /api/v1/clusters/{id}
GET    /api/v1/clusters/{id}/summary
GET    /api/v1/clusters/{id}/topology?namespace=default
POST   /api/v1/clusters/{id}/topology/export

WS     /ws/resources
WS     /ws/events
```

---

### 2. Desktop Application (Tauri + Rust)

**Purpose**: Native desktop application for offline-first Kubernetes management

**Technology Stack**:
- Tauri 2.0 (desktop framework)
- Rust 1.75+ (backend)
- React (frontend)
- Go backend (runs as sidecar)

**Architecture**:

```
┌───────────────────────────────────┐
│    WEBVIEW (React Frontend)        │
├───────────────────────────────────┤
│           IPC Layer               │
├───────────────────────────────────┤
│      TAURI CORE (Rust)            │
│  - Commands                       │
│  - Events                         │
│  - Native APIs                    │
│  - Sidecar Manager                │
├───────────────────────────────────┤
│   GO BACKEND (Sidecar Process)   │
│   localhost:8080                 │
└───────────────────────────────────┘
```

**Key Features**:
- **Sidecar Process Management**: Automatically starts/stops Go backend
- **File System Access**: Read/write kubeconfig files
- **Native Menus**: Platform-native menu bar
- **System Tray**: Minimize to tray
- **Auto-Updater**: Seamless updates
- **Platform Integration**: Notifications, clipboard, etc.

**Process Lifecycle**:

1. App starts → Tauri initializes
2. Tauri spawns Go backend as child process
3. Backend starts on localhost:8080
4. React frontend connects to localhost:8080
5. User interacts with UI
6. App closes → Backend process terminates

---

### 3. Mobile Application (Tauri Mobile)

**Purpose**: Remote Kubernetes management on iOS/Android

**Technology Stack**:
- Tauri 2.0 Mobile
- Rust (core)
- Swift (iOS native)
- Kotlin (Android native)
- React (frontend)

**Architecture**:

```
┌───────────────────────────────────┐
│  NATIVE LAYER (iOS/Android)      │
│  - Biometric Auth                │
│  - Push Notifications            │
│  - Deep Links                    │
├───────────────────────────────────┤
│      TAURI CORE (Rust)            │
│  - API Client                    │
│  - State Management              │
│  - Offline Storage (SQLite)      │
├───────────────────────────────────┤
│   WEBVIEW (React Frontend)       │
└───────────────────────────────────┘
         │
         │ HTTP/WebSocket
         ↓
┌───────────────────────────────────┐
│  KUBILITICS BACKEND             │
│  (Remote or Cluster-Local)      │
└───────────────────────────────────┘
```

**Key Features**:
- **Remote Connection**: Connects to backend via HTTPS
- **Offline Mode**: Caches topology and resource data locally (SQLite)
- **Biometric Auth**: Face ID / Touch ID / Fingerprint
- **Push Notifications**: APNs (iOS) / FCM (Android)
- **Background Sync**: Syncs queued actions when online
- **QR Code**: Quick cluster connection via QR code

---

## Topology Engine Deep Dive

### Problem Statement

Kubernetes resources form a complex web of relationships. These relationships are:
- **Explicit**: OwnerReferences, Label Selectors
- **Implicit**: Volume mounts, environment variable references
- **Multi-layered**: Pod → ReplicaSet → Deployment → HPA

**Challenge**: Build a COMPLETE, DETERMINISTIC graph showing ALL relationships.

### Solution Architecture

**Phase 1: Resource Discovery**

```go
func (e *Engine) discoverResources(ctx context.Context) {
    // Discover all resource types
    pods := client.CoreV1().Pods("").List(ctx)
    deployments := client.AppsV1().Deployments("").List(ctx)
    services := client.CoreV1().Services("").List(ctx)
    configMaps := client.CoreV1().ConfigMaps("").List(ctx)
    // ... 50+ more types
    
    // Create nodes for each resource
    for _, pod := range pods {
        graph.AddNode(createNode(pod))
    }
}
```

**Phase 2: Relationship Inference**

```go
func (e *Engine) inferRelationships(graph *Graph) {
    // 1. OwnerReferences: Pod -> ReplicaSet -> Deployment
    for _, pod := range pods {
        for _, owner := range pod.OwnerReferences {
            graph.AddEdge(owner.UID, pod.UID, "owner")
        }
    }
    
    // 2. Label Selectors: Service -> Pods
    for _, service := range services {
        for _, pod := range pods {
            if matchesSelector(pod.Labels, service.Spec.Selector) {
                graph.AddEdge(service.UID, pod.UID, "selector")
            }
        }
    }
    
    // 3. Volume Mounts: Pod -> ConfigMap/Secret/PVC
    for _, pod := range pods {
        for _, volume := range pod.Spec.Volumes {
            if volume.ConfigMap != nil {
                cm := findConfigMap(volume.ConfigMap.Name)
                graph.AddEdge(pod.UID, cm.UID, "volume")
            }
        }
    }
    
    // 4. Environment References: Pod -> ConfigMap/Secret
    // 5. RBAC: ServiceAccount -> Role -> RoleBinding
    // 6. Network: NetworkPolicy -> Pods
    // ... and many more
}
```

**Phase 3: Deterministic Layout**

```go
func (g *Graph) GenerateLayoutSeed() string {
    // Sort nodes and edges for determinism
    sortedNodes := sortByTypeAndName(g.Nodes)
    sortedEdges := sortBySourceAndTarget(g.Edges)
    
    // Create hash of sorted structure
    hash := sha256(serialize(sortedNodes, sortedEdges))
    return hash
}
```

This seed is sent to frontend, ensuring the same graph always renders with the same layout.

**Phase 4: Validation**

```go
func (g *Graph) Validate() error {
    // Check for orphan edges
    for _, edge := range g.Edges {
        if g.GetNode(edge.Source) == nil {
            return fmt.Errorf("orphan edge: source not found")
        }
    }
    
    // Check for duplicate nodes
    // Check for circular dependencies
    // Check for incomplete relationships
    
    return nil
}
```

### Topology Output Example

```json
{
  "nodes": [
    {
      "id": "pod-abc123",
      "type": "Pod",
      "namespace": "default",
      "name": "nginx-abc123",
      "status": "Running"
    },
    {
      "id": "deploy-xyz789",
      "type": "Deployment",
      "namespace": "default",
      "name": "nginx-deployment",
      "status": "Active"
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "deploy-xyz789",
      "target": "pod-abc123",
      "type": "owner",
      "label": "owns"
    }
  ],
  "meta": {
    "node_count": 2,
    "edge_count": 1,
    "layout_seed": "a3f2b9c...",
    "generated_at": "2026-02-04T12:34:56Z",
    "version": "1.0"
  }
}
```

---

## Data Flow

### Desktop Application Data Flow

```
User Action
  ↓
React Component
  ↓ (fetch/WebSocket)
Go Backend (localhost:8080)
  ↓ (client-go)
Kubernetes API
  ↓
Cluster
```

### Mobile Application Data Flow

```
User Action
  ↓
React Component
  ↓ (HTTPS/WSS)
Remote Backend
  ↓ (client-go)
Kubernetes API
  ↓
Cluster
```

---

## Deployment Modes

### 1. Desktop Sidecar

- **Use Case**: Individual developers, local clusters
- **Backend**: Go binary bundled with app
- **Database**: SQLite (app data directory)
- **Connection**: kubeconfig from ~/.kube/config

### 2. In-Cluster Deployment (Helm)

- **Use Case**: Team-shared environment
- **Backend**: Kubernetes Deployment
- **Database**: PostgreSQL (StatefulSet)
- **Connection**: ServiceAccount (in-cluster config)
- **Access**: Ingress + Mobile apps

### 3. Standalone Server

- **Use Case**: Enterprise deployment
- **Backend**: Binary on VM/bare metal
- **Database**: External PostgreSQL
- **Connection**: Configurable kubeconfig

---

## Security Considerations

### Backend

- **No Authentication**: Backend trusts all requests (runs locally or behind auth proxy)
- **RBAC**: Respects Kubernetes RBAC (uses kubeconfig credentials)
- **API Rate Limiting**: Prevents abuse
- **Input Validation**: All inputs validated

### Desktop

- **Sandboxed WebView**: Limited API access
- **IPC Security**: Commands whitelisted
- **File Access**: Scoped to specific directories
- **Process Isolation**: Backend runs as separate process

### Mobile

- **HTTPS Only**: All backend communication encrypted
- **Certificate Pinning**: Prevents MITM attacks
- **Biometric Auth**: Device-level security
- **Secure Storage**: Keychain (iOS) / Keystore (Android)

---

## Performance

### Topology Engine Benchmarks

- **1,000 nodes**: <200ms
- **10,000 nodes**: <2s
- **100,000 nodes**: <20s

### Memory Usage

- **Backend**: ~50MB base + ~10KB per resource
- **Desktop**: ~100MB (app) + backend
- **Mobile**: ~80MB

---

## Future Enhancements

1. **AI/MCP Integration**: AI-powered cluster insights
2. **GraphQL API**: Alternative to REST
3. **Plugin System**: Extend functionality
4. **Multi-Cluster Management**: Manage multiple clusters
5. **Time-Travel Debugging**: Replay cluster state
6. **Advanced Filtering**: Complex topology queries
7. **Collaborative Features**: Team annotations

---

This architecture is designed for production use, with a focus on correctness, performance, and user experience.
