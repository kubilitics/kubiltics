# Kubilitics — Kubernetes Relationship Intelligence Engine
## Topology Enhancement Tasks · Full Coverage · v2.0

> **North Star:** Every Kubernetes reference → every edge. No omissions. No workload-only shortcuts.
> This document is implementation-ready. Each task is atomic and verifiable.

---

## 1. Architecture: Relationship-First Engine

### 1.1 Core Design Principles

```
Current (v1):  per-kind builder functions   → manual, incomplete, inconsistent
Target  (v2):  declarative relationship rules → exhaustive, uniform, extensible
```

**Engine Pipeline (v2):**

```
┌─────────────────────────────────────────────────────────────┐
│  K8s API Server                                              │
│        ↓  (parallel namespace-scoped batch fetch)           │
│  NamespaceSnapshot  (cached, 30s TTL, mutex-protected)      │
│        ↓                                                    │
│  RelationshipRuleRegistry  (declarative, per-ref-type)      │
│        ↓  (parallel extraction across all rules)            │
│  RelationshipIndex  (forward + reverse maps, O(1) lookup)   │
│        ↓                                                    │
│  SubgraphExpander  (BFS from seed, depth-limited, capped)   │
│        ↓                                                    │
│  GraphSerializer  → JSON API response                       │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Relationship Rule Registry (NEW)

Replace per-kind builder functions with declarative rules:

```go
type RelationshipRule struct {
    ID          string         // unique identifier
    SourceKind  string         // source K8s kind
    TargetKind  string         // target K8s kind
    RefType     RefType        // ownerRef | selector | claimRef | fieldRef | volumeMount | envRef | roleRef | subjectRef | annotationRef
    Label       string         // edge display label
    Direction   Direction      // Forward | Backward | Bidirectional
    Extractor   func(source runtime.Object) []TargetRef
    Confidence  float64        // 0.0–1.0 (1.0 = explicit ref, 0.6 = selector-inferred)
}
```

**All 60+ rules are registered at engine init. Adding a new rule = adding one entry.**

### 1.3 Bidirectional Relationship Index

```go
type RelationshipIndex struct {
    outEdges map[string][]Edge  // sourceID → []Edge
    inEdges  map[string][]Edge  // targetID → []Edge  (reverse lookup for "what depends on me")
}
```

Both directions are populated on first namespace fetch. Subgraph queries run in O(depth × fanout).

### 1.4 Reference Types to Parse (Complete)

| RefType | Kubernetes Field | Example |
|---------|-----------------|---------|
| `ownerRef` | `metadata.ownerReferences` | Pod → ReplicaSet |
| `selector` | `spec.selector` / `spec.podSelector` | Service → Pods |
| `nodeSelector` | `spec.nodeSelector` | Pod → Node (candidate) |
| `nodeName` | `spec.nodeName` | Pod → Node (actual) |
| `claimRef` | `spec.claimRef` | PV → PVC |
| `volumeName` | `spec.volumeName` | PVC → PV |
| `storageClass` | `spec.storageClassName` | PVC/PV → StorageClass |
| `volumeCM` | `spec.volumes[].configMap.name` | Pod → ConfigMap |
| `volumeSecret` | `spec.volumes[].secret.secretName` | Pod → Secret |
| `volumePVC` | `spec.volumes[].persistentVolumeClaim.claimName` | Pod → PVC |
| `volumeProjected` | `spec.volumes[].projected.sources[].{configMap\|secret}` | Pod → ConfigMap/Secret |
| `envCM` | `spec.containers[].env[].valueFrom.configMapKeyRef.name` | Pod → ConfigMap |
| `envSecret` | `spec.containers[].env[].valueFrom.secretKeyRef.name` | Pod → Secret |
| `envFromCM` | `spec.containers[].envFrom[].configMapRef.name` | Pod → ConfigMap |
| `envFromSecret` | `spec.containers[].envFrom[].secretRef.name` | Pod → Secret |
| `serviceAccountName` | `spec.serviceAccountName` | Pod → ServiceAccount |
| `imagePullSecret` | `spec.imagePullSecrets[].name` | Pod/SA → Secret |
| `priorityClass` | `spec.priorityClassName` | Pod → PriorityClass |
| `runtimeClass` | `spec.runtimeClassName` | Pod → RuntimeClass |
| `scaleTargetRef` | `spec.scaleTargetRef` | HPA/VPA → Workload |
| `roleRef` | `roleRef.name + roleRef.kind` | RoleBinding → Role/ClusterRole |
| `subjectRef` | `subjects[].name` (where kind=ServiceAccount) | RoleBinding → ServiceAccount |
| `ingressClass` | `spec.ingressClassName` | Ingress → IngressClass |
| `ingressBackend` | `spec.rules[].http.paths[].backend.service.name` | Ingress → Service |
| `webhookService` | `webhooks[].clientConfig.service.name` | Webhook → Service |
| `pdbSelector` | `spec.selector` | PDB → workload Pods |
| `volumeClaimTemplate` | `spec.volumeClaimTemplates[].metadata.name` | StatefulSet → PVC |
| `csiDriver` | `spec.csiDriverName` | CSINode → CSIDriver |
| `attachedVolumes` | `status.volumesAttached[].name` | Node → VolumeAttachment |
| `leaseHolder` | `spec.holderIdentity` | Lease → Node/Pod |
| `gatewayRef` | `spec.parentRefs[].name` | HTTPRoute → Gateway |
| `gatewayServiceRef` | `spec.addresses[].value` | Gateway → Service |

---

## 2. Backend Implementation Tasks

### 2.1 Engine Refactor

- [ ] **B-01** Create `internal/topology/rules/` package — `RelationshipRule`, `RefType`, `Direction` types
- [ ] **B-02** Create `internal/topology/rules/registry.go` — global rule registry with `Register()` + `All()` + `BySourceKind(kind)` accessors
- [ ] **B-03** Create `internal/topology/cache/namespace_snapshot.go` — parallel-fetch all resources per namespace, TTL-cached with `sync.RWMutex`
- [ ] **B-04** Create `internal/topology/index/relationship_index.go` — bidirectional edge index, `O(1)` forward + reverse lookup
- [ ] **B-05** Create `internal/topology/expander/subgraph_expander.go` — BFS expander: depth param, node cap, `Truncated` flag, lazy fetch
- [ ] **B-06** Refactor `BuildResourceSubgraph` to use expander (keep existing builders as fallback for now)
- [ ] **B-07** Add `errgroup`-based parallel fetch to `NamespaceSnapshot.Fetch(ctx, namespace)`
- [ ] **B-08** Add 30s TTL cache for subgraph results keyed by `(clusterID, kind, namespace, name)`
- [ ] **B-09** Add `?depth=N` query param to topology API (default=3, max=6)
- [ ] **B-10** Add `?filter=kind1,kind2` query param — prune nodes not in filter set from response

---

## 3. Resource Coverage — 62 Kinds

### 3.1 Workloads (10 kinds)

#### Pod
**Current:** ✅ Supported | **Gap:** missing PriorityClass edge, RuntimeClass edge, topologySpreadConstraints

- [ ] **W-01** Pod → PriorityClass via `spec.priorityClassName`
- [ ] **W-02** Pod → RuntimeClass via `spec.runtimeClassName`
- [ ] **W-03** Pod → Node via `spec.nodeName` (already exists — verify edge label is "Scheduled on")
- [ ] **W-04** Pod → ConfigMap: cover ALL reference paths: volumes, env.valueFrom, envFrom, projected volumes, init containers, ephemeral containers ← **use unified `podSpecExtractConfigMaps(spec)` helper**
- [ ] **W-05** Pod → Secret: same exhaustive coverage as W-04 via `podSpecExtractSecrets(spec)`
- [ ] **W-06** Pod → ServiceAccount: edge from Pod, reverse edge from SA (already partial)
- [ ] **W-07** Pod → imagePullSecret (Secret) via `spec.imagePullSecrets[].name`
- [ ] **W-08** Pod ← NetworkPolicy: reverse edge (NetworkPolicy governs Pod via podSelector)
- [ ] **W-09** Pod ← PodDisruptionBudget: reverse edge (PDB targets Pod via selector)
- [ ] **W-10** Pod ← Service: reverse edge (Service selects Pod via label selector)

#### Deployment
**Current:** ✅ Supported | **Gap:** missing PDB, volumeClaimTemplate in rollout, RBAC chain

- [ ] **W-11** Deployment ← PodDisruptionBudget via selector matching `spec.template.labels`
- [ ] **W-12** Deployment → ServiceAccount (via pod template `spec.serviceAccountName`)
- [ ] **W-13** Deployment → ConfigMap (via pod template volumes + env — reuse `podSpecExtractConfigMaps`)
- [ ] **W-14** Deployment → Secret (via pod template volumes + env)
- [ ] **W-15** Deployment → PriorityClass (via pod template `spec.priorityClassName`)
- [ ] **W-16** Deployment ← ClusterRoleBinding / RoleBinding (via subjects referencing pod's SA)

#### ReplicaSet
**Current:** ✅ Supported | **Gap:** ConfigMap/Secret via pod template

- [ ] **W-17** ReplicaSet → ConfigMap / Secret / ServiceAccount (via pod template spec)

#### StatefulSet
**Current:** ✅ Supported | **Gap:** volumeClaimTemplates → PVCs, ConfigMap/Secret

- [ ] **W-18** StatefulSet → PVC via `spec.volumeClaimTemplates` — generate expected PVC names `{template.name}-{statefulset-name}-{index}`, look up existing PVCs matching pattern
- [ ] **W-19** StatefulSet → ConfigMap / Secret / ServiceAccount (via pod template spec)
- [ ] **W-20** StatefulSet ← PodDisruptionBudget (selector match)

#### DaemonSet
**Current:** ✅ Supported | **Gap:** ConfigMap/Secret/SA/PDB

- [ ] **W-21** DaemonSet → ConfigMap / Secret / ServiceAccount (via pod template spec)
- [ ] **W-22** DaemonSet ← PodDisruptionBudget (selector match)

#### Job
**Current:** ✅ Supported | **Gap:** ConfigMap/Secret/SA in pod template

- [ ] **W-23** Job → ConfigMap / Secret / ServiceAccount (via pod template spec)

#### CronJob
**Current:** ✅ Supported | **Gap:** ConfigMap/Secret/SA in job template

- [ ] **W-24** CronJob → ConfigMap / Secret / ServiceAccount (via job template pod template spec)

#### ReplicationController
**Current:** ✅ Supported | **Gap:** ConfigMap/Secret/SA, PDB

- [ ] **W-25** ReplicationController → ConfigMap / Secret / ServiceAccount (via pod template spec)
- [ ] **W-26** ReplicationController ← PodDisruptionBudget (selector match)

#### PodDisruptionBudget ← NEW
**Current:** ❌ Not supported

- [ ] **W-27** Add `buildPodDisruptionBudgetSubgraph`: PDB → target workload Pods (via `spec.selector`), resolve selector → Pods → their owner workloads (Deployment/StatefulSet/DaemonSet)
- [ ] **W-28** Add `"PodDisruptionBudget"` to `ResourceTopologyKinds` + switch case
- [ ] **W-29** Add `"PodDisruptionBudget"` to frontend `RESOURCE_TOPOLOGY_SUPPORTED_KINDS`
- [ ] **W-30** Add PDB normalization: `"poddisruptionbudgets"/"pdb"` → `"PodDisruptionBudget"`

#### PodTemplate ← NEW (lower priority)
**Current:** ❌ Not supported

- [ ] **W-31** Add `buildPodTemplateSubgraph`: PodTemplate → ConfigMap / Secret / ServiceAccount (via spec)

---

### 3.2 Autoscaling (4 kinds)

#### HorizontalPodAutoscaler
**Current:** ✅ Supported | **Gap:** metrics sources

- [ ] **A-01** HPA → ConfigMap / Secret via `spec.metrics[].external.metric.selector` annotations (for KEDA-style)

#### VerticalPodAutoscaler ← NEW (CRD)
**Current:** ❌ Not supported (CRD, may not be installed)

- [ ] **A-02** Add `buildVerticalPodAutoscalerSubgraph` using dynamic client: VPA → target Deployment/StatefulSet (via `spec.targetRef`)
- [ ] **A-03** Guard with `isAPIAvailable("autoscaling.k8s.io", "v1", "verticalpodautoscalers")` — skip gracefully if CRD absent
- [ ] **A-04** Add VPA to frontend kind list + add VPA-specific NODE_COLOR (indigo family)

#### KEDA ScaledObject ← NEW (CRD)
**Current:** ❌ Not supported

- [ ] **A-05** Add `buildScaledObjectSubgraph` using dynamic client: ScaledObject → target Deployment/StatefulSet (via `spec.scaleTargetRef`), ScaledObject → Secret (trigger auth secrets)
- [ ] **A-06** Guard with `isAPIAvailable("keda.sh", "v1alpha1", "scaledobjects")`
- [ ] **A-07** Add KEDA node color (orange-red family)

#### KEDA ScaledJob ← NEW (CRD)
**Current:** ❌ Not supported

- [ ] **A-08** Add `buildScaledJobSubgraph`: ScaledJob → Job template → Pods
- [ ] **A-09** Guard with `isAPIAvailable("keda.sh", "v1alpha1", "scaledjobs")`

---

### 3.3 Networking (12 kinds)

#### Service
**Current:** ✅ Supported | **Gap:** ExternalName DNS, headless SA

- [ ] **N-01** Service → ExternalName target (annotation node) for `spec.type=ExternalName`
- [ ] **N-02** Service ← MutatingWebhookConfiguration (via `webhooks[].clientConfig.service.name`)
- [ ] **N-03** Service ← ValidatingWebhookConfiguration (same pattern as N-02)

#### Endpoints
**Current:** ✅ Supported — OK

#### EndpointSlice
**Current:** ✅ Supported — OK

#### Ingress
**Current:** ✅ Supported | **Gap:** TLS secrets, IngressClass

- [ ] **N-04** Ingress → Secret (TLS) via `spec.tls[].secretName`
- [ ] **N-05** Ingress → IngressClass via `spec.ingressClassName`

#### IngressClass
**Current:** ✅ Supported | **Gap:** reverse lookup from Ingresses

- [ ] **N-06** IngressClass ← Ingress (reverse: all Ingresses referencing this IngressClass)

#### NetworkPolicy
**Current:** ✅ Supported | **Gap:** egress rules, namespaceSelector

- [ ] **N-07** NetworkPolicy egress rules → target pods (via `spec.egress[].to[].podSelector`)
- [ ] **N-08** NetworkPolicy → Namespace (via `spec.egress/ingress[].to/from[].namespaceSelector`)

#### Gateway ← NEW (Gateway API CRD)
**Current:** ❌ Not supported

- [ ] **N-09** Add `buildGatewaySubgraph` using dynamic client: Gateway → GatewayClass (via `spec.gatewayClassName`), Gateway ← HTTPRoutes that reference it
- [ ] **N-10** Guard with `isAPIAvailable("gateway.networking.k8s.io", "v1", "gateways")`
- [ ] **N-11** Add Gateway node color (blue-green gradient)

#### HTTPRoute ← NEW (Gateway API CRD)
**Current:** ❌ Not supported

- [ ] **N-12** Add `buildHTTPRouteSubgraph`: HTTPRoute → Gateway (via `spec.parentRefs[].name`), HTTPRoute → Service (via `spec.rules[].backendRefs[].name`)
- [ ] **N-13** Guard with `isAPIAvailable("gateway.networking.k8s.io", "v1", "httproutes")`

#### GRPCRoute ← NEW (Gateway API CRD)
**Current:** ❌ Not supported

- [ ] **N-14** Add `buildGRPCRouteSubgraph` (same pattern as HTTPRoute)

#### GatewayClass ← NEW (Gateway API CRD)
**Current:** ❌ Not supported

- [ ] **N-15** Add `buildGatewayClassSubgraph`: GatewayClass ← Gateways

---

### 3.4 Storage (10 kinds)

#### PersistentVolumeClaim
**Current:** ✅ Supported | **Gap:** VolumeSnapshot reference

- [ ] **S-01** PVC ← VolumeSnapshot (via `spec.dataSource.name` where `kind=VolumeSnapshot`)

#### PersistentVolume
**Current:** ✅ Supported | **Gap:** CSIDriver, Node affinity

- [ ] **S-02** PV → CSIDriver (via `spec.csi.driver`)
- [ ] **S-03** PV → Node (via `spec.nodeAffinity.required` node selector terms)

#### StorageClass
**Current:** ✅ Supported | **Gap:** CSIDriver, provisioner mapping

- [ ] **S-04** StorageClass → CSIDriver (via `provisioner` field matching CSIDriver name)

#### VolumeAttachment
**Current:** ✅ Supported | **Gap:** PV, Node

- [ ] **S-05** VolumeAttachment → PV (via `spec.source.persistentVolumeName`)
- [ ] **S-06** VolumeAttachment → Node (via `spec.nodeName`)

#### VolumeSnapshot ← NEW (CRD)
**Current:** ❌ Not supported

- [ ] **S-07** Add `buildVolumeSnapshotSubgraph`: VolumeSnapshot → PVC (source `spec.source.persistentVolumeClaimName`), VolumeSnapshot → VolumeSnapshotClass (via `spec.volumeSnapshotClassName`), VolumeSnapshot → VolumeSnapshotContent (via `status.boundVolumeSnapshotContentName`)
- [ ] **S-08** Guard with `isAPIAvailable("snapshot.storage.k8s.io", "v1", "volumesnapshots")`

#### VolumeSnapshotClass ← NEW (CRD)
**Current:** ❌ Not supported

- [ ] **S-09** Add `buildVolumeSnapshotClassSubgraph`: VolumeSnapshotClass ← VolumeSnapshots (reverse lookup)

#### VolumeSnapshotContent ← NEW (CRD)
**Current:** ❌ Not supported

- [ ] **S-10** Add `buildVolumeSnapshotContentSubgraph`: VolumeSnapshotContent → VolumeSnapshot (via `spec.volumeSnapshotRef`), VolumeSnapshotContent → PV (via `spec.source.volumeHandle`)

#### CSIDriver ← NEW
**Current:** ❌ Not supported

- [ ] **S-11** Add `buildCSIDriverSubgraph`: CSIDriver ← PVs (using this driver), CSIDriver ← StorageClasses (provisioner == driver name)
- [ ] **S-12** Add `"CSIDriver"` to `ResourceTopologyKinds` + switch + frontend list

#### CSINode ← NEW
**Current:** ❌ Not supported

- [ ] **S-13** Add `buildCSINodeSubgraph`: CSINode → Node (same name), CSINode → CSIDriver (via `spec.drivers[].name`)
- [ ] **S-14** Add `"CSINode"` to `ResourceTopologyKinds` + switch + frontend list

#### CSIStorageCapacity ← NEW
**Current:** ❌ Not supported

- [ ] **S-15** Add `buildCSIStorageCapacitySubgraph`: CSIStorageCapacity → StorageClass (via `storageClassName`), CSIStorageCapacity → Node (via `nodeTopology`)
- [ ] **S-16** Guard: CSIStorageCapacity is GA in 1.24+, but check availability

---

### 3.5 RBAC (6 kinds)

#### Role ← NEW standalone topology
**Current:** ⚠️ Inferred in cluster-wide graph but NO dedicated `buildRoleSubgraph`

- [ ] **R-01** Add `buildRoleSubgraph`: Role ← RoleBindings that reference this Role (via `roleRef.name + roleRef.kind == "Role"`), show ServiceAccounts as subjects of those bindings
- [ ] **R-02** Add `"Role"` to `ResourceTopologyKinds` + switch + frontend list

#### ClusterRole ← NEW standalone topology
**Current:** ⚠️ Same gap as Role

- [ ] **R-03** Add `buildClusterRoleSubgraph`: ClusterRole ← RoleBindings + ClusterRoleBindings that reference it
- [ ] **R-04** Add `"ClusterRole"` to `ResourceTopologyKinds` + switch + frontend list

#### RoleBinding ← NEW standalone topology
**Current:** ⚠️ Inferred but no dedicated builder

- [ ] **R-05** Add `buildRoleBindingSubgraph`: RoleBinding → Role/ClusterRole (via `roleRef`), RoleBinding → ServiceAccount subjects (via `subjects[].kind == "ServiceAccount"`)
- [ ] **R-06** Add `"RoleBinding"` to `ResourceTopologyKinds` + switch + frontend list

#### ClusterRoleBinding ← NEW standalone topology
**Current:** ⚠️ Same gap as RoleBinding

- [ ] **R-07** Add `buildClusterRoleBindingSubgraph`: ClusterRoleBinding → ClusterRole (via `roleRef`), ClusterRoleBinding → ServiceAccount subjects
- [ ] **R-08** Add `"ClusterRoleBinding"` to `ResourceTopologyKinds` + switch + frontend list

#### ServiceAccount
**Current:** ✅ Supported | **Gap:** RoleBinding chain (SA ← RoleBindings), ClusterRoleBinding chain

- [ ] **R-09** SA ← RoleBindings (all RoleBindings in namespace where `subjects[].name == sa.name && subjects[].kind == "ServiceAccount"`)
- [ ] **R-10** SA ← ClusterRoleBindings (cluster-wide, same subject matching)
- [ ] **R-11** SA → Role chain: SA ← RoleBinding → Role (show full 3-hop RBAC path from SA detail)

#### Add RBAC normalizers
- [ ] **R-12** Add `normalizeResourceKind` cases: `"roles"/"role"` → `"Role"`, `"clusterroles"/"clusterrole"` → `"ClusterRole"`, `"rolebindings"/"rolebinding"` → `"RoleBinding"`, `"clusterrolebindings"/"clusterrolebinding"` → `"ClusterRoleBinding"`

---

### 3.6 Infrastructure (8 kinds)

#### Node
**Current:** ✅ Supported | **Gap:** VolumeAttachment, Lease, CSINode

- [ ] **I-01** Node → VolumeAttachment (via `status.volumesAttached[].name`)
- [ ] **I-02** Node ← Lease (via `spec.holderIdentity == node.name`) — use `coordination.k8s.io/v1`
- [ ] **I-03** Node ← CSINode (same name as Node)
- [ ] **I-04** Node taint labels shown as badge annotations on node detail (not edges — data enrichment)

#### Namespace
**Current:** ✅ Supported — OK (comprehensive builder added in this session)

#### LimitRange
**Current:** ✅ Supported | **Gap:** show which workloads are affected (reverse link from Pods)

- [ ] **I-05** LimitRange → all Pods in same namespace (reverse: "Limits" edge, sample 5 pod nodes max for clarity)

#### ResourceQuota
**Current:** ✅ Supported | **Gap:** show affected resources by quota type

- [ ] **I-06** ResourceQuota — add computed usage annotation showing `used/hard` per resource type (from `status.used`)

#### PriorityClass
**Current:** ✅ Single-node only (leaf) | **Gap:** which Pods use it

- [ ] **I-07** Add reverse lookup: PriorityClass ← Pods (across all namespaces) that have `spec.priorityClassName == priorityClass.name`
- [ ] **I-08** Implement PriorityClass as meaningful subgraph (currently renders only the single node)

#### RuntimeClass ← NEW
**Current:** ❌ Not supported

- [ ] **I-09** Add `buildRuntimeClassSubgraph`: RuntimeClass ← Pods using `spec.runtimeClassName == runtimeClass.name`
- [ ] **I-10** Add `"RuntimeClass"` to `ResourceTopologyKinds` + switch + frontend list

#### Lease ← NEW
**Current:** ❌ Not supported

- [ ] **I-11** Add `buildLeaseSubgraph`: Lease → Node (via `spec.holderIdentity` matching Node name — for node leases in `kube-node-lease` namespace)
- [ ] **I-12** Add `"Lease"` to `ResourceTopologyKinds` + switch + frontend list

#### Event ← Read-only enrichment
**Current:** ❌ Not supported

- [ ] **I-13** Add `"Event"` as enrichment data: when viewing any resource's topology, annotate nodes with recent related Events (not as separate nodes — as metadata on existing nodes)

---

### 3.7 Configuration (4 kinds)

#### ConfigMap
**Current:** ✅ Supported | **Gap:** projected volumes, init containers

- [ ] **C-01** ConfigMap consumer detection: cover `spec.volumes[].projected.sources[].configMap`, `spec.initContainers`, `spec.ephemeralContainers` (use `podSpecExtractConfigMaps(spec)`)

#### Secret
**Current:** ✅ Supported | **Gap:** same as ConfigMap gaps + TLS cert secrets from Ingresses

- [ ] **C-02** Secret ← Ingress (TLS secrets via `spec.tls[].secretName`) — reverse edge shown in Secret subgraph

#### MutatingWebhookConfiguration ← NEW
**Current:** ❌ Not supported

- [ ] **C-03** Add `buildMutatingWebhookConfigurationSubgraph` using dynamic client: MutatingWebhookConfiguration → Service (via `webhooks[].clientConfig.service.name`)
- [ ] **C-04** Add to `ResourceTopologyKinds` + switch + frontend list
- [ ] **C-05** Node color: warm gray/slate family

#### ValidatingWebhookConfiguration ← NEW
**Current:** ❌ Not supported

- [ ] **C-06** Add `buildValidatingWebhookConfigurationSubgraph`: same pattern as MutatingWebhookConfiguration
- [ ] **C-07** Add to `ResourceTopologyKinds` + switch + frontend list

---

### 3.8 Policy & Admission (4 kinds)

#### PodDisruptionBudget ← NEW (see W-27 through W-30)

#### ValidatingAdmissionPolicy ← NEW
**Current:** ❌ Not supported (GA in K8s 1.30+)

- [ ] **P-01** Add `buildValidatingAdmissionPolicySubgraph`: VAP ← ValidatingAdmissionPolicyBinding (that references this policy)
- [ ] **P-02** Guard with `isAPIAvailable("admissionregistration.k8s.io", "v1", "validatingadmissionpolicies")`

#### ValidatingAdmissionPolicyBinding ← NEW
**Current:** ❌ Not supported

- [ ] **P-03** Add `buildValidatingAdmissionPolicyBindingSubgraph`: Binding → ValidatingAdmissionPolicy (via `spec.policyName`), Binding → target MatchResources
- [ ] **P-04** Guard same as P-02

#### ResourceClaim ← NEW (DRA)
**Current:** ResourceSlice exists as leaf only | **Gap:** DRA chain

- [ ] **P-05** ResourceSlice → DeviceClass (via `spec.devices[].basic.attributes`) — full DRA relationship chain
- [ ] **P-06** DeviceClass ← ResourceClaim (where claim requests this class)

---

### 3.9 Flow Control (2 kinds)

#### FlowSchema ← NEW
**Current:** ❌ Not supported

- [ ] **F-01** Add `buildFlowSchemaSubgraph`: FlowSchema → PriorityLevelConfiguration (via `spec.priorityLevelConfiguration.name`)
- [ ] **F-02** Add `"FlowSchema"` to kind lists

#### PriorityLevelConfiguration ← NEW
**Current:** ❌ Not supported

- [ ] **F-03** Add `buildPriorityLevelConfigurationSubgraph`: PriorityLevelConfiguration ← FlowSchemas referencing it
- [ ] **F-04** Add `"PriorityLevelConfiguration"` to kind lists

---

### 3.10 Helper Functions (Shared Infrastructure)

- [ ] **H-01** `podSpecExtractConfigMaps(spec *corev1.PodSpec) []string` — all ConfigMap refs from volumes + env + envFrom + initContainers + ephemeralContainers + projected
- [ ] **H-02** `podSpecExtractSecrets(spec *corev1.PodSpec) []string` — all Secret refs (same coverage as H-01 + imagePullSecrets)
- [ ] **H-03** `podSpecExtractPVCs(spec *corev1.PodSpec) []string` — all PVC volume claims
- [ ] **H-04** `isAPIAvailable(group, version, resource string) bool` — check K8s API server supports given GVR (use discovery client, cached)
- [ ] **H-05** `matchSelector(selector map[string]string, target map[string]string) bool` — safe label selector matching with nil guards
- [ ] **H-06** `statefulSetPVCNames(sts *appsv1.StatefulSet, pvcList []corev1.PersistentVolumeClaim) []string` — match volumeClaimTemplate pattern `{template}-{sts}-{index}`
- [ ] **H-07** `listRoleBindingsForSubject(namespace, saName string) ([]rbacv1.RoleBinding, []rbacv1.ClusterRoleBinding, error)` — centralized RBAC subject lookup
- [ ] **H-08** Parallel fetch utility: `func fetchAll(ctx, fns ...func() error) error` using `errgroup`

---

## 4. Frontend UI Enhancement Tasks

### 4.1 Visual Design System Upgrade

#### Color Palette Refinement (Apple-grade gradients)

- [ ] **UI-01** Replace flat `bg` colors with CSS linear-gradient pairs in `NODE_COLORS`:
  ```ts
  type NodeColor = {
    gradientFrom: string   // light end
    gradientTo: string     // dark end (135deg direction)
    border: string
    glow: string           // rgba with 0.35 alpha
    text: 'white' | '#1a1a1a'
    shadowColor: string    // rgba for drop-shadow
  }
  ```

- [ ] **UI-02** Assign color families by semantic group:
  ```
  Workloads    → blue-gray family    (#3B82F6→#1D4ED8, #6366F1→#4338CA, …)
  Storage      → cyan-blue family    (#0EA5E9→#0369A1, #06B6D4→#0E7490, …)
  Networking   → teal-green family   (#10B981→#047857, #14B8A6→#0F766E, …)
  RBAC         → purple-violet family (#8B5CF6→#6D28D9, #A78BFA→#7C3AED, …)
  Infra/Nodes  → amber-orange family (#F59E0B→#B45309, #FB923C→#C2410C, …)
  System       → slate-gray family   (#64748B→#334155, #94A3B8→#475569, …)
  Errors       → red accent only     (#EF4444 border/glow — never fill)
  ```

- [ ] **UI-03** Add new kind colors to `NODE_COLORS` for all newly supported kinds:
  - PodDisruptionBudget: `#EC4899→#BE185D` (pink)
  - Role: `#A855F7→#7E22CE`
  - ClusterRole: `#9333EA→#6B21A8`
  - RoleBinding: `#C084FC→#A855F7`
  - ClusterRoleBinding: `#D946EF→#A21CAF`
  - RuntimeClass: `#78716C→#57534E` (warm stone)
  - Lease: `#94A3B8→#64748B` (slate)
  - VolumeSnapshot: `#38BDF8→#0284C7`
  - CSIDriver: `#2DD4BF→#0D9488`
  - CSINode: `#34D399→#059669`
  - Gateway: `#4ADE80→#16A34A`
  - HTTPRoute: `#86EFAC→#15803D`
  - FlowSchema: `#FCD34D→#D97706`
  - PriorityLevelConfiguration: `#FDE68A→#F59E0B`
  - ValidatingAdmissionPolicy: `#FDA4AF→#E11D48`
  - MutatingWebhookConfiguration: `#F9A8D4→#DB2777`

#### Node Shape System

- [ ] **UI-04** Add shape variants by resource category (Cytoscape + D3):
  ```
  Workloads          → circle (current)
  Networking         → rounded-rectangle (diamond border Cytoscape shorthand)
  Storage            → hexagon (6-sided)
  RBAC               → shield (pentagon)
  Infrastructure     → square with rounded corners
  CRD / Unknown      → octagon
  ```

- [ ] **UI-05** Add resource category icons inside nodes (SVG path, 16px, centered):
  - Use `lucide-react` icon paths: Box=Pod, Layers=Deployment, Network=Service, Shield=Role, Database=PVC, Server=Node, Globe=Ingress, Key=Secret, Settings=ConfigMap, Zap=HPA

#### Edge Visual System

- [ ] **UI-06** Implement edge style matrix:
  ```
  ownership (Owns/Manages)     → solid 2.5px, filled triangle arrowhead
  selection (Selects/Exposes)  → dashed 1.5px, open arrowhead
  storage (Mounts/Claims)      → dotted 2px, double arrowhead
  RBAC (Grants/Permits)        → purple dashed 2px, lock icon label
  network flow (Routes to)     → teal gradient, animated strokeDashoffset
  config (Configures/Uses)     → amber dotted 1.5px, square arrowhead
  scheduling (Scheduled on)    → orange solid 1.5px, circle arrowhead
  scales (Scales)              → blue double-headed arrow
  ```

- [ ] **UI-07** Animated edge flow for "active" connections (Service→Pod, Ingress→Service): `strokeDashoffset` CSS animation, 1.5s linear infinite, only when `graph.liveMode` is true

- [ ] **UI-08** Edge label background: `rgba(255,255,255,0.85)` pill with 4px border-radius, never overlapping node bodies

#### Node Rendering Enhancements

- [ ] **UI-09** D3 SVG gradient definitions — add `<linearGradient>` for each `NODE_COLORS` entry, referenced via `fill="url(#gradient-{kind)"`

- [ ] **UI-10** Node status ring: replace single status dot with status ring (colored outer ring, 3px wide, inside the glow circle) — green=healthy, amber=warning, red=critical, gray=unknown

- [ ] **UI-11** Node size hierarchy (radius in px for D3, width for Cytoscape):
  ```
  Namespace     → 34px radius (largest — container concept)
  Node (Infra)  → 30px
  Deployment/SS → 26px
  Service/Ing   → 24px
  Pod/Job/CM    → 22px
  Endpoints/SA  → 18px
  leaf nodes    → 16px
  ```

- [ ] **UI-12** Collapsed namespace group: single large circle showing count badge (e.g. "12 resources"), click to expand inline

#### Dark Mode

- [ ] **UI-13** Dark mode node gradients: reduce saturation 15%, increase lightness 10% vs. light mode
- [ ] **UI-14** Dark mode edge colors: `rgba(255,255,255,0.6)` base, colored by type
- [ ] **UI-15** Dark mode canvas: `hsl(222, 47%, 7%)` with subtle grid pattern `rgba(255,255,255,0.03)` 24px grid

#### TopologyNodePanel Enhancements

- [ ] **UI-16** Add "Related Resources" section in panel: list edges with direction arrows (→ / ←) and count badge per edge type
- [ ] **UI-17** Add "RBAC Chain" expandable section for ServiceAccount nodes: SA → RoleBinding → Role chain rendered inline
- [ ] **UI-18** Add node kind icon (lucide) in panel header beside the kind badge
- [ ] **UI-19** Add "Navigate Graph" button: clicking highlights all edges of selected node in graph without closing panel
- [ ] **UI-20** Panel keyboard: `Tab` cycles through edge targets, `Enter` navigates, `Esc` closes

---

### 4.2 Graph Controls

- [ ] **UI-21** Add filter bar above topology canvas: toggle buttons per resource category (Workloads, Networking, Storage, RBAC, Infra, Config) — toggling hides/shows those node categories
- [ ] **UI-22** Add depth slider (1–6): controls BFS expansion depth from seed node
- [ ] **UI-23** Add "Focus Mode": double-click a node → re-render graph centered on that node as new seed (push to browser history)
- [ ] **UI-24** Add edge type legend panel (bottom-left): shows edge style → relationship type mapping, toggleable
- [ ] **UI-25** Add minimap (bottom-right corner, 120×80px) for large graphs — D3 scale-to-fit overview
- [ ] **UI-26** Add search overlay: `Cmd+K` opens node search, type to filter by name/kind, click result to jump-to and highlight
- [ ] **UI-27** Add "Expand All" / "Collapse All" buttons for namespace grouping

---

### 4.3 Performance (Frontend)

- [ ] **UI-28** Virtual rendering for large graphs (>500 nodes): only render visible viewport nodes in D3, use `IntersectionObserver` or spatial index
- [ ] **UI-29** WebWorker for force simulation: move D3 force layout computation off main thread
- [ ] **UI-30** Progressive disclosure: start at L1 (namespace-grouped) abstraction level, user expands to L2/L3
- [ ] **UI-31** Request deduplication: if same `(kind, namespace, name)` topology is requested twice within 5s, return cached response
- [ ] **UI-32** Streaming response support: stream nodes/edges as they arrive (chunked JSON), render incrementally

---

## 5. Performance Tasks (Backend)

- [ ] **PERF-01** Parallel namespace fetch: use `errgroup` to fetch all 20 resource types concurrently per namespace (reduces latency from 20× sequential to ~1× parallel)
- [ ] **PERF-02** 30s TTL namespace snapshot cache per `(clusterID, namespace)` — invalidated by watch events if watch is active
- [ ] **PERF-03** 60s TTL subgraph cache per `(clusterID, kind, namespace, name)` — keyed with content hash
- [ ] **PERF-04** Label selector inverted index: pre-compute `label → []podID` on namespace snapshot load for O(1) selector matching vs. O(n) pod scan
- [ ] **PERF-05** Node cap enforcement: hard cap 500 nodes per subgraph, prioritize direct neighbors first (BFS)
- [ ] **PERF-06** Truncation signal: when cap reached, add `"_truncated"` node with edge `"… N more nodes not shown"` as visual indicator
- [ ] **PERF-07** Timeout per subgraph: 10s hard timeout (currently 30s) — fail fast, return partial graph with `partial: true` flag
- [ ] **PERF-08** API availability cache: cache `isAPIAvailable()` results for 5 minutes (discovery API is expensive)
- [ ] **PERF-09** Goroutine pool: limit concurrent K8s API calls to 20 per cluster client to avoid API server throttling
- [ ] **PERF-10** Metrics: instrument subgraph build latency per kind with Prometheus histogram `topology_build_duration_seconds{kind}`

---

## 6. CRD / Dynamic Resource Tasks

- [ ] **CRD-01** Add `GetDynamicResourceTopology(gvr, namespace, name)` — generic CRD subgraph using `ownerReferences` only (works for any CRD)
- [ ] **CRD-02** CRD discovery: on cluster connect, list all CRDs and register them in `ResourceTopologyKinds` dynamically
- [ ] **CRD-03** Helm Release CRD support: detect `helm.sh/release.v1` Secrets, show Helm release → all owned resources topology
- [ ] **CRD-04** Operator Framework: detect `operators.coreos.com` CRDs (Subscription → InstallPlan → CSV) and build chain
- [ ] **CRD-05** Argo CD Application CRD: Application → all managed resources (via `app.kubernetes.io/managed-by` label)
- [ ] **CRD-06** Flux2 Kustomization CRD: Kustomization → all managed resources
- [ ] **CRD-07** Multi-cluster: detect `multicluster.x-k8s.io` ServiceExport/ServiceImport CRDs

---

## 7. Resource Coverage Summary Table

| # | Kind | Group | Supported | Gaps |
|---|------|-------|-----------|------|
| 1 | Pod | core | ✅ | PriorityClass, RuntimeClass edges |
| 2 | Deployment | apps | ✅ | ConfigMap/Secret/SA/PDB edges |
| 3 | ReplicaSet | apps | ✅ | pod template refs |
| 4 | StatefulSet | apps | ✅ | volumeClaimTemplates, pod template refs |
| 5 | DaemonSet | apps | ✅ | pod template refs, PDB |
| 6 | Job | batch | ✅ | pod template refs |
| 7 | CronJob | batch | ✅ | job template refs |
| 8 | ReplicationController | core | ✅ | pod template refs |
| 9 | PodDisruptionBudget | policy | ❌ | NEW — full |
| 10 | PodTemplate | core | ❌ | NEW — low priority |
| 11 | HorizontalPodAutoscaler | autoscaling | ✅ | metrics sources |
| 12 | VerticalPodAutoscaler | autoscaling.k8s.io | ❌ | NEW — CRD |
| 13 | KEDA ScaledObject | keda.sh | ❌ | NEW — CRD |
| 14 | KEDA ScaledJob | keda.sh | ❌ | NEW — CRD |
| 15 | Service | core | ✅ | ExternalName node |
| 16 | Endpoints | core | ✅ | — |
| 17 | EndpointSlice | discovery.k8s.io | ✅ | — |
| 18 | Ingress | networking.k8s.io | ✅ | TLS secrets, IngressClass edge |
| 19 | IngressClass | networking.k8s.io | ✅ | reverse Ingress lookup |
| 20 | NetworkPolicy | networking.k8s.io | ✅ | egress rules, namespaceSelector |
| 21 | Gateway | gateway.networking.k8s.io | ❌ | NEW — CRD |
| 22 | HTTPRoute | gateway.networking.k8s.io | ❌ | NEW — CRD |
| 23 | GRPCRoute | gateway.networking.k8s.io | ❌ | NEW — CRD |
| 24 | GatewayClass | gateway.networking.k8s.io | ❌ | NEW — CRD |
| 25 | PersistentVolumeClaim | core | ✅ | VolumeSnapshot ref |
| 26 | PersistentVolume | core | ✅ | CSIDriver, Node affinity |
| 27 | StorageClass | storage.k8s.io | ✅ | CSIDriver mapping |
| 28 | VolumeAttachment | storage.k8s.io | ✅ | PV + Node edges |
| 29 | VolumeSnapshot | snapshot.storage.k8s.io | ❌ | NEW — CRD |
| 30 | VolumeSnapshotClass | snapshot.storage.k8s.io | ❌ | NEW — CRD |
| 31 | VolumeSnapshotContent | snapshot.storage.k8s.io | ❌ | NEW — CRD |
| 32 | CSIDriver | storage.k8s.io | ❌ | NEW — full |
| 33 | CSINode | storage.k8s.io | ❌ | NEW — full |
| 34 | CSIStorageCapacity | storage.k8s.io | ❌ | NEW — full |
| 35 | ConfigMap | core | ✅ | projected volumes, init containers |
| 36 | Secret | core | ✅ | Ingress TLS reverse, SA reverse |
| 37 | MutatingWebhookConfiguration | admissionregistration | ❌ | NEW — full |
| 38 | ValidatingWebhookConfiguration | admissionregistration | ❌ | NEW — full |
| 39 | ValidatingAdmissionPolicy | admissionregistration | ❌ | NEW — GA 1.30+ |
| 40 | ValidatingAdmissionPolicyBinding | admissionregistration | ❌ | NEW |
| 41 | Role | rbac.authorization.k8s.io | ❌ | NEW — needs builder |
| 42 | ClusterRole | rbac.authorization.k8s.io | ❌ | NEW — needs builder |
| 43 | RoleBinding | rbac.authorization.k8s.io | ❌ | NEW — needs builder |
| 44 | ClusterRoleBinding | rbac.authorization.k8s.io | ❌ | NEW — needs builder |
| 45 | ServiceAccount | core | ✅ | RBAC chain missing |
| 46 | Node | core | ✅ | VolumeAttachment, Lease, CSINode |
| 47 | Namespace | core | ✅ | — |
| 48 | LimitRange | core | ✅ | Pod reverse sample |
| 49 | ResourceQuota | core | ✅ | usage annotation |
| 50 | PriorityClass | scheduling.k8s.io | ⚠️ | leaf only — needs Pod reverse |
| 51 | RuntimeClass | node.k8s.io | ❌ | NEW — full |
| 52 | Lease | coordination.k8s.io | ❌ | NEW — full |
| 53 | PodDisruptionBudget | policy | ❌ | NEW — full |
| 54 | FlowSchema | flowcontrol.apiserver.k8s.io | ❌ | NEW — full |
| 55 | PriorityLevelConfiguration | flowcontrol.apiserver.k8s.io | ❌ | NEW — full |
| 56 | ResourceSlice | resource.k8s.io | ⚠️ | leaf only — DRA chain missing |
| 57 | DeviceClass | resource.k8s.io | ⚠️ | leaf only — DRA chain missing |
| 58 | ResourceClaim | resource.k8s.io | ❌ | NEW — DRA |
| 59 | Helm Release | core Secret (type=helm) | ❌ | CRD-03 |
| 60 | Argo CD Application | argoproj.io | ❌ | CRD-05 |
| 61 | Flux Kustomization | kustomize.toolkit.fluxcd.io | ❌ | CRD-06 |
| 62 | Event | core (read-only) | ❌ | enrichment only |

---

## 8. Implementation Priority Order

### Phase 1 — Core Completeness (Week 1–2)
> Zero-gap on native K8s resources

1. `H-01` through `H-08` — shared helper functions
2. `R-01` through `R-12` — RBAC builders (Role, ClusterRole, RoleBinding, ClusterRoleBinding)
3. `W-27` through `W-30` — PodDisruptionBudget
4. `W-01` through `W-26` — workload pod template refs (ConfigMap/Secret/SA/PriorityClass/RuntimeClass)
5. `S-02` through `S-06` — storage chain completion (PV→CSIDriver, VolumeAttachment→Node)
6. `N-04` through `N-08` — networking completion (Ingress TLS, IngressClass, NetworkPolicy egress)

### Phase 2 — New Native Kinds (Week 3)
> Complete the 62-kind coverage

7. `I-09` through `I-12` — RuntimeClass + Lease
8. `S-12` through `S-16` — CSIDriver, CSINode, CSIStorageCapacity
9. `C-03` through `C-07` — Webhook configurations
10. `F-01` through `F-04` — FlowSchema, PriorityLevelConfiguration
11. `P-01` through `P-06` — Admission + DRA

### Phase 3 — CRD Ecosystem (Week 4)
> Gateway API, VPA, KEDA, snapshots

12. `N-09` through `N-15` — Gateway API
13. `A-02` through `A-09` — VPA, KEDA
14. `S-07` through `S-11` — VolumeSnapshot chain
15. `CRD-01` through `CRD-07` — Dynamic CRD support

### Phase 4 — Visual Upgrade (Week 5)
> Apple-grade design system

16. `UI-01` through `UI-12` — gradient nodes, shapes, edge styles
17. `UI-13` through `UI-15` — dark mode
18. `UI-16` through `UI-20` — panel enhancements
19. `UI-21` through `UI-27` — graph controls
20. `UI-28` through `UI-32` — frontend performance

### Phase 5 — Backend Performance (Week 6)
21. `PERF-01` through `PERF-10` — caching, parallel fetch, metrics
22. `B-01` through `B-10` — engine refactor to rule-registry pattern

---

## 9. Definition of Done

A topology implementation is **complete** when:

- [ ] All listed resource kinds render in the topology tab without "not available" message
- [ ] All reference types (ownerRef, selector, claimRef, fieldRef, roleRef, subjects, volumeMount, envRef, imagePullSecret, ingressClassName, storageClassName, scaleTargetRef, webhookService, gatewayRef) produce edges
- [ ] Every edge has a label and a visual style matching its `RefType`
- [ ] Both directions are navigable: from any resource, you can see "what I depend on" AND "what depends on me"
- [ ] CRD-based resources gracefully show "not installed" message instead of error
- [ ] Subgraph builds in < 3s for clusters with < 1000 resources per namespace
- [ ] Graph stays readable at 50+ nodes (abstraction levels work correctly)
- [ ] Dark mode renders correctly
- [ ] `go build ./cmd/server` passes with zero errors
- [ ] `npm run build` passes with zero TypeScript errors

---

*Generated: 2026-02-27 · Kubilitics v2.0 Topology Intelligence Engine*
