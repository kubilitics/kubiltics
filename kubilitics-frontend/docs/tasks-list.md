# Kubilitics Frontend — Completion Task List

**Document Version:** 1.0  
**Generated:** February 2026  
**Status:** EXECUTION PLAN — Single Source of Truth  
**Baseline:** Pod & Deployment implementations are the GOLD STANDARD  

---

## Executive Summary

This document represents the exhaustive task list for completing the Kubilitics frontend to 100% PRD compliance. All tasks are derived from comparing the PRD specifications against the current implementation.

**Key Constraints:**
- Kubilitics is NOT a SaaS (no auth/login/signup)
- Delivered as: Desktop App (Tauri) or In-Cluster (Helm)
- 50+ Kubernetes resources must have full feature parity with Pod
- Zero incomplete screens, no empty tabs, no stub content

---

## 1. Global Application Tasks

### 1.1 Application Shell & Layout

- [ ] **SHELL-001**: Implement collapsible sidebar with 256px expanded / 64px collapsed states per PRD
- [ ] **SHELL-002**: Add sidebar collapse toggle button with keyboard shortcut
- [ ] **SHELL-003**: Implement detail panel slide-in (400px width) for resource previews
- [ ] **SHELL-004**: Add mobile bottom navigation component for mobile viewport
- [ ] **SHELL-005**: Implement mobile bottom sheet for detail panels
- [ ] **SHELL-006**: Add breadcrumb navigation to AppLayout header
- [ ] **SHELL-007**: Implement theme toggle (light/dark/system) in header

### 1.2 Cluster Connection

- [ ] **CLUSTER-001**: Enhance ClusterConnect page with kubeconfig auto-detection from 10+ locations
- [ ] **CLUSTER-002**: Add QR code scanning for mobile cluster pairing
- [ ] **CLUSTER-003**: Implement cluster discovery from cloud CLI configs (AWS, GCP, Azure)
- [ ] **CLUSTER-004**: Add cluster health ping visualization on connection screen
- [ ] **CLUSTER-005**: Implement offline mode with cached state support
- [ ] **CLUSTER-006**: Add connection error recovery with retry mechanisms

### 1.3 Universal Search (Cmd+K)

- [ ] **SEARCH-001**: Implement CommandPalette with full search capabilities per PRD
- [ ] **SEARCH-002**: Add resource type filtering in search results
- [ ] **SEARCH-003**: Implement search result grouping by resource type
- [ ] **SEARCH-004**: Add action suggestions in search (Scale, View Logs, Restart, Exec)
- [ ] **SEARCH-005**: Implement recent searches history
- [ ] **SEARCH-006**: Add keyboard navigation for search results
- [ ] **SEARCH-007**: Implement "why is X slow?" natural language query (AI tier)

### 1.4 Navigation System

- [ ] **NAV-001**: Implement 9 core navigation groups per PRD: Workloads, Networking, Storage, Configuration, Security, Cluster, Scaling & Policies, Custom Resources, Admission Control
- [ ] **NAV-002**: Add notification badges for warnings/errors per navigation section
- [ ] **NAV-003**: Implement keyboard shortcuts for navigation (Cmd+1 through Cmd+8)
- [ ] **NAV-004**: Add active state indicators matching PRD design

### 1.5 Internationalization (i18n)

- [ ] **I18N-001**: Set up i18next infrastructure with locale files structure
- [ ] **I18N-002**: Create English base locale files (common, resources, topology, errors)
- [ ] **I18N-003**: Add language selector in Settings
- [ ] **I18N-004**: Implement RTL layout support for Arabic/Hebrew
- [ ] **I18N-005**: Add date/time/number formatting per locale

### 1.6 Settings Page

- [ ] **SETTINGS-001**: Implement Appearance section (theme, density, animations)
- [ ] **SETTINGS-002**: Implement Clusters section (manage connected clusters)
- [ ] **SETTINGS-003**: Implement Keyboard Shortcuts section with customization
- [ ] **SETTINGS-004**: Implement Language section
- [ ] **SETTINGS-005**: Implement About section with version info
- [ ] **SETTINGS-006**: Add telemetry opt-out setting

---

## 2. Resource Parity Tasks (CRITICAL)

> **MANDATE**: Every resource must match Pod/Deployment feature completeness.

### 2.1 Workloads

#### Resource: Pod ✓ (GOLD STANDARD - Complete)

- [x] List page: filters, bulk actions, status parity
- [x] Detail page: header, summary, metadata, conditions
- [x] Tabs: Overview, Containers, Events, Logs, Topology, YAML, Security, Performance
- [x] Create flow (YAML-first with ResourceCreator)
- [x] Edit flow (inline YAML editing)
- [x] Bulk actions: delete, restart, export
- [x] Topology: resource-level relationships
- [x] Port-forward dialog
- [x] Comparison view

#### Resource: Deployment ✓ (GOLD STANDARD - Complete)

- [x] List page: filters, bulk actions, replica counts
- [x] Detail page: header, rollout status, replica management
- [x] Tabs: Overview, ReplicaSets, Events, YAML, Topology, Actions
- [x] Create flow (ResourceCreator)
- [x] Scale dialog
- [x] Rollout actions (restart, rollback)

#### Resource: ReplicaSet

- [x] List page: basic implementation
- [x] Create flow added
- [x] **RS-001**: Replica count status indicators (implemented with ready/desired display)
- [x] **RS-002**: Owner deployment link in list view (implemented)
- [x] **RS-003**: Detail page: Pod template section (implemented)
- [x] **RS-004**: Scale dialog integration (implemented)
- [ ] **RS-005**: Implement revision history comparison
- [x] **RS-006**: Bulk selection and actions (implemented)
- [x] **RS-007**: Topology tab with Deployment/Pod relationships (implemented)

#### Resource: StatefulSet

- [x] List page with create flow
- [x] **SS-001**: Ordinal index visualization in list (ready count shows ordered status)
- [x] **SS-002**: Detail page: volumeClaimTemplates section (implemented)
- [x] **SS-003**: Ordered pod status visualization (implemented)
- [x] **SS-004**: Partition-based rollout controls (implemented)
- [x] **SS-005**: PVC relationship in Topology tab (implemented)
- [x] **SS-006**: Bulk actions (delete, restart) (implemented)
- [x] **SS-007**: Performance tab with per-pod metrics (implemented)

#### Resource: DaemonSet

- [x] List page with create flow
- [x] **DS-001**: Node coverage visualization (scheduled/desired) (implemented)
- [x] **DS-002**: Detail page: node selector section (implemented)
- [x] **DS-003**: Tolerations display (implemented)
- [x] **DS-004**: Update strategy visualization (implemented)
- [x] **DS-005**: Topology tab showing node distribution (implemented)
- [x] **DS-006**: Bulk actions (implemented)

#### Resource: Job

- [x] List page with create flow
- [x] **JOB-001**: Completion status (succeeded/failed counts) (implemented)
- [x] **JOB-002**: Detail page: parallelism/completions info (implemented)
- [x] **JOB-003**: Backoff limit and active deadline display (implemented)
- [x] **JOB-004**: Pod logs aggregation view (implemented)
- [x] **JOB-005**: Topology tab (implemented)
- [x] **JOB-006**: Bulk actions (implemented)

#### Resource: CronJob

- [x] List page with create flow
- [x] **CJ-001**: Next scheduled run time in list (implemented)
- [x] **CJ-002**: Last successful/failed job status (implemented)
- [x] **CJ-003**: Detail page: schedule visualization (implemented)
- [x] **CJ-004**: Suspend/resume toggle (implemented)
- [x] **CJ-005**: Triggered Jobs list (implemented)
- [x] **CJ-006**: Topology tab (implemented)
- [x] **CJ-007**: Manual trigger action (implemented)

#### Resource: ReplicationController

- [x] List page with create flow
- [x] **RC-001**: Add status indicators (ready/desired) - COMPLETED
- [x] **RC-002**: Add scale dialog - COMPLETED
- [x] **RC-003**: Detail page: full implementation - COMPLETED
- [x] **RC-004**: Add Topology tab - COMPLETED
- [x] **RC-005**: Add deprecation warning banner - COMPLETED

### 2.2 Networking

#### Resource: Service

- [x] List page
- [x] **SVC-001**: Create flow with ResourceCreator (implemented)
- [x] **SVC-002**: Type indicator (ClusterIP/NodePort/LoadBalancer/ExternalName) (implemented)
- [x] **SVC-003**: External endpoints display (implemented)
- [x] **SVC-004**: Detail page: endpoints section (implemented)
- [x] **SVC-005**: Port mapping visualization (implemented)
- [x] **SVC-006**: Topology tab showing Pod relationships (implemented)
- [x] **SVC-007**: Bulk actions (implemented)
- [ ] **SVC-008**: Add Performance tab (traffic metrics)

#### Resource: Endpoints

- [x] List page with create flow
- [x] **EP-001**: Address count in list (implemented)
- [x] **EP-002**: Detail page: addresses table with ready/not-ready status (implemented)
- [x] **EP-003**: Service relationship (implemented)
- [x] **EP-004**: Topology tab (implemented)
- [ ] **EP-005**: Add subsets visualization

#### Resource: EndpointSlice

- [x] List page with create flow
- [x] **EPS-001**: AddressType indicator (implemented)
- [x] **EPS-002**: Detail page: endpoints table (implemented)
- [x] **EPS-003**: Port definitions display (implemented)
- [x] **EPS-004**: Topology tab (implemented)
- [ ] **EPS-005**: Add discovery hints visualization

#### Resource: Ingress

- [x] List page with create flow
- [x] **ING-001**: Hosts/paths summary in list (implemented)
- [x] **ING-002**: TLS status indicator (implemented)
- [x] **ING-003**: Detail page: rules visualization (implemented)
- [x] **ING-004**: Backend services table (implemented)
- [x] **ING-005**: Topology tab (Ingress → Service → Pod) (implemented)
- [x] **ING-006**: Bulk actions (implemented)

#### Resource: IngressClass

- [x] List page with create flow
- [x] **IC-001**: Default class indicator (implemented)
- [x] **IC-002**: Controller name display (implemented)
- [x] **IC-003**: Detail page: parameters section (implemented)
- [ ] **IC-004**: Add associated Ingresses list
- [x] **IC-005**: Topology tab (implemented)

#### Resource: NetworkPolicy

- [x] List page with create flow
- [x] **NP-001**: Pod selector summary in list (implemented)
- [x] **NP-002**: Ingress/egress rule counts (implemented)
- [ ] **NP-003**: Detail page: add visual rule builder/viewer
- [x] **NP-004**: Affected Pods list (implemented)
- [x] **NP-005**: Topology tab showing policy scope (implemented)
- [x] **NP-006**: Bulk actions (implemented)

### 2.3 Storage

#### Resource: PersistentVolume

- [x] List page with create flow
- [x] **PV-001**: Capacity and access modes in list (implemented)
- [x] **PV-002**: Phase status (Available/Bound/Released/Failed) (implemented)
- [x] **PV-003**: Reclaim policy indicator (implemented)
- [x] **PV-004**: Detail page: claim reference (implemented)
- [x] **PV-005**: Storage class relationship (implemented)
- [x] **PV-006**: Topology tab (PV → PVC → Pod) (implemented)
- [ ] **PV-007**: Add bulk actions

#### Resource: PersistentVolumeClaim

- [x] List page with create flow
- [x] **PVC-001**: Storage request/capacity in list (implemented)
- [x] **PVC-002**: Phase status (Pending/Bound/Lost) (implemented)
- [x] **PVC-003**: Bound PV reference (implemented)
- [x] **PVC-004**: Detail page: storage class details (implemented)
- [ ] **PVC-005**: Add using Pods list
- [x] **PVC-006**: Topology tab (implemented)
- [ ] **PVC-007**: Add expand volume action
- [ ] **PVC-008**: Add bulk actions

#### Resource: StorageClass

- [x] List page with create flow
- [x] **SC-001**: Provisioner name in list (implemented)
- [x] **SC-002**: Default class indicator (implemented)
- [x] **SC-003**: Reclaim policy display (implemented)
- [x] **SC-004**: Volume binding mode (implemented)
- [x] **SC-005**: Detail page: parameters table (implemented)
- [ ] **SC-006**: Add associated PVCs list
- [x] **SC-007**: Topology tab (implemented)

#### Resource: VolumeAttachment

- [x] List page with create flow
- [x] **VA-001**: Attached status in list (implemented)
- [x] **VA-002**: Node and PV references (implemented)
- [x] **VA-003**: Detail page: attachment error display (implemented)
- [x] **VA-004**: Topology tab (implemented)

#### Resource: ConfigMap

- [x] List page with create flow
- [x] **CM-001**: Data key count in list (implemented)
- [x] **CM-002**: Binary data indicator (implemented)
- [x] **CM-003**: Detail page: data viewer with syntax highlighting (implemented)
- [ ] **CM-004**: Add using Pods/Deployments list
- [x] **CM-005**: Topology tab (implemented)
- [ ] **CM-006**: Add bulk actions
- [x] **CM-007**: Inline data editing (implemented via editable YAML)

#### Resource: Secret

- [x] List page with create flow
- [x] **SEC-001**: Type indicator in list (Opaque/TLS/docker-registry) (implemented)
- [x] **SEC-002**: Data key count (implemented)
- [x] **SEC-003**: Detail page: data viewer with show/hide toggle (implemented)
- [ ] **SEC-004**: Add using Pods list
- [x] **SEC-005**: Topology tab (implemented)
- [ ] **SEC-006**: Add bulk actions
- [ ] **SEC-007**: Add age-based expiry warnings for TLS secrets

### 2.4 Cluster

#### Resource: Node

- [x] List page
- [x] **NODE-001**: Create not applicable (read-only resource) - DOCUMENTED
- [x] **NODE-002**: Add CPU/Memory usage bars in list - COMPLETED
- [x] **NODE-003**: Add pod count (running/capacity) - COMPLETED
- [x] **NODE-004**: Add conditions summary - COMPLETED
- [x] **NODE-005**: Detail page: add taints section - COMPLETED
- [x] **NODE-006**: Add allocatable resources visualization - COMPLETED
- [x] **NODE-007**: Add running Pods list - COMPLETED
- [x] **NODE-008**: Add Topology tab (Node → Pods) - COMPLETED
- [x] **NODE-009**: Add cordon/uncordon actions - COMPLETED
- [x] **NODE-010**: Add drain action with confirmation - COMPLETED
- [x] **NODE-011**: Add Performance tab with node metrics - COMPLETED

#### Resource: Namespace

- [x] List page with create flow
- [x] **NS-001**: Add phase status (Active/Terminating) - COMPLETED
- [x] **NS-002**: Add resource counts (pods, services, etc.) - COMPLETED
- [x] **NS-003**: Detail page: add ResourceQuota summary - COMPLETED
- [x] **NS-004**: Add LimitRange summary - COMPLETED
- [x] **NS-005**: Add all resources in namespace list - COMPLETED
- [x] **NS-006**: Add Topology tab (namespace scope view) - COMPLETED
- [ ] **NS-007**: Add bulk actions

#### Resource: Event

- [x] List page (read-only)
- [x] **EVT-001**: Add type filter (Normal/Warning) - COMPLETED
- [x] **EVT-002**: Add involved object link - COMPLETED
- [x] **EVT-003**: Add count and last occurrence time - COMPLETED
- [x] **EVT-004**: Add real-time streaming updates - COMPLETED
- [x] **EVT-005**: Add time range filter - COMPLETED
- [x] **EVT-006**: Add source component filter - COMPLETED

#### Resource: Lease

- [x] List page with create flow
- [x] **LEASE-001**: Add holder identity in list - COMPLETED
- [x] **LEASE-002**: Add lease duration display - COMPLETED
- [x] **LEASE-003**: Add renew time - COMPLETED
- [x] **LEASE-004**: Detail page: full implementation - COMPLETED
- [x] **LEASE-005**: Add Topology tab - COMPLETED

#### Resource: APIService

- [x] List page (read-only)
- [ ] **API-001**: Add availability status in list
- [ ] **API-002**: Add service reference for external APIs
- [ ] **API-003**: Detail page: add conditions
- [ ] **API-004**: Add group/version display

#### Resource: ComponentStatus (deprecated)

- [x] List page
- [ ] **CS-001**: Add deprecation banner
- [ ] **CS-002**: Add health check status

#### Resource: RuntimeClass

- [x] List page with create flow
- [x] **RTC-001**: Add handler name in list - COMPLETED
- [x] **RTC-002**: Add overhead specifications - COMPLETED
- [x] **RTC-003**: Add scheduling rules - COMPLETED
- [x] **RTC-004**: Detail page: full implementation with Topology - COMPLETED

### 2.5 Security & RBAC

#### Resource: ServiceAccount

- [x] List page with create flow
- [x] **SA-001**: Secrets count in list (implemented)
- [x] **SA-002**: AutomountServiceAccountToken status (implemented)
- [x] **SA-003**: Detail page: secrets section (implemented)
- [x] **SA-004**: ImagePullSecrets display (implemented)
- [ ] **SA-005**: Add using Pods list
- [x] **SA-006**: Topology tab (SA → Pods, SA → Secrets) (implemented)
- [ ] **SA-007**: Add bulk actions

#### Resource: Role

- [x] List page with create flow
- [x] **ROLE-001**: Rules count in list (implemented)
- [x] **ROLE-002**: Detail page: rules table with verbs/resources (implemented)
- [ ] **ROLE-003**: Add RoleBindings using this Role
- [x] **ROLE-004**: Topology tab (Role → RoleBinding → Subject) (implemented)
- [ ] **ROLE-005**: Add bulk actions

#### Resource: ClusterRole

- [x] List page with create flow
- [x] **CR-001**: Rules count in list (implemented)
- [x] **CR-002**: Aggregation labels indicator (implemented)
- [x] **CR-003**: Detail page: rules table (implemented)
- [ ] **CR-004**: Add ClusterRoleBindings using this role
- [x] **CR-005**: Topology tab (implemented)
- [ ] **CR-006**: Add bulk actions

#### Resource: RoleBinding

- [x] List page with create flow
- [x] **RB-001**: Role reference in list (implemented)
- [x] **RB-002**: Subjects summary (implemented)
- [x] **RB-003**: Detail page: subjects table (implemented)
- [x] **RB-004**: Referenced Role details (implemented)
- [x] **RB-005**: Topology tab (implemented)
- [ ] **RB-006**: Add bulk actions

#### Resource: ClusterRoleBinding

- [x] List page with create flow
- [x] **CRB-001**: Role reference in list (implemented)
- [x] **CRB-002**: Subjects summary (implemented)
- [x] **CRB-003**: Detail page: subjects table (implemented)
- [x] **CRB-004**: Referenced ClusterRole details (implemented)
- [x] **CRB-005**: Topology tab (implemented)
- [ ] **CRB-006**: Add bulk actions

#### Resource: PodSecurityPolicy (deprecated)

- [x] List page with create flow
- [ ] **PSP-001**: Add deprecation banner
- [ ] **PSP-002**: Add privileged/volumes summary
- [ ] **PSP-003**: Detail page: add full spec visualization

### 2.6 Scaling & Policies

#### Resource: HorizontalPodAutoscaler

- [x] List page with create flow
- [x] **HPA-001**: Current/min/max replicas in list (implemented)
- [x] **HPA-002**: Target metrics summary (implemented)
- [x] **HPA-003**: Detail page: metrics visualization (implemented)
- [x] **HPA-004**: Scale history graph (implemented)
- [x] **HPA-005**: Target resource link (implemented)
- [x] **HPA-006**: Topology tab (implemented)
- [ ] **HPA-007**: Add bulk actions

#### Resource: VerticalPodAutoscaler

- [x] List page with create flow
- [x] **VPA-001**: Update mode in list (implemented)
- [x] **VPA-002**: Recommendation summary (implemented)
- [x] **VPA-003**: Detail page: container recommendations table (implemented)
- [x] **VPA-004**: Target resource link (implemented)
- [x] **VPA-005**: Topology tab (implemented)
- [ ] **VPA-006**: Add bulk actions

#### Resource: PodDisruptionBudget

- [x] List page with create flow
- [x] **PDB-001**: Allowed disruptions count in list (implemented)
- [x] **PDB-002**: MinAvailable/maxUnavailable display (implemented)
- [x] **PDB-003**: Detail page: disrupted pods list (implemented)
- [x] **PDB-004**: Affected pods summary (implemented)
- [x] **PDB-005**: Topology tab (implemented)
- [ ] **PDB-006**: Add bulk actions

#### Resource: ResourceQuota

- [x] List page with create flow
- [x] **RQ-001**: Hard/used summary in list (implemented)
- [x] **RQ-002**: Scope selector display (implemented)
- [x] **RQ-003**: Detail page: resource usage bars (implemented)
- [x] **RQ-004**: Exceeded quotas warnings (implemented)
- [x] **RQ-005**: Topology tab (quota scope) (implemented)
- [ ] **RQ-006**: Add bulk actions

#### Resource: LimitRange

- [x] List page with create flow
- [x] **LR-001**: Limit types summary in list (implemented)
- [x] **LR-002**: Detail page: limits table per type (Container/Pod/PVC) (implemented)
- [x] **LR-003**: Default/min/max visualization (implemented)
- [x] **LR-004**: Topology tab (implemented)
- [ ] **LR-005**: Add bulk actions

#### Resource: PriorityClass

- [x] List page with create flow
- [x] **PC-001**: Value in list (sortable) (implemented)
- [x] **PC-002**: GlobalDefault indicator (implemented)
- [x] **PC-003**: PreemptionPolicy display (implemented)
- [x] **PC-004**: Detail page: full implementation (implemented)
- [ ] **PC-005**: Add using Pods list

### 2.7 Custom Resources & Extensibility

#### Resource: CustomResourceDefinition

- [x] List page with create flow
- [x] **CRD-001**: Add group/version/kind in list - COMPLETED
- [x] **CRD-002**: Add scope (Namespaced/Cluster) - COMPLETED
- [x] **CRD-003**: Add served versions - COMPLETED
- [x] **CRD-004**: Detail page: add schema viewer - COMPLETED
- [x] **CRD-005**: Add printer columns configuration - COMPLETED
- [x] **CRD-006**: Add custom resource instances list - COMPLETED
- [x] **CRD-007**: Add Topology tab - COMPLETED

#### Resource: Custom Resource Instances

- [ ] **CR-001**: Implement dynamic list page based on CRD schema
- [ ] **CR-002**: Implement dynamic detail page
- [ ] **CR-003**: Add create flow with schema-driven form
- [ ] **CR-004**: Add YAML-based creation
- [ ] **CR-005**: Add Topology tab based on ownerReferences

#### Resource: MutatingWebhookConfiguration

- [x] List page with create flow
- [ ] **MWH-001**: Add webhooks count in list
- [ ] **MWH-002**: Add failure policy summary
- [ ] **MWH-003**: Detail page: add webhooks table with rules
- [ ] **MWH-004**: Add match conditions display
- [ ] **MWH-005**: Add Topology tab (showing affected resources)

#### Resource: ValidatingWebhookConfiguration

- [x] List page with create flow
- [ ] **VWH-001**: Add webhooks count in list
- [ ] **VWH-002**: Add failure policy summary
- [ ] **VWH-003**: Detail page: add webhooks table with rules
- [ ] **VWH-004**: Add match conditions display
- [ ] **VWH-005**: Add Topology tab

---

## 3. Topology Tasks

### 3.1 Global Topology Engine

- [ ] **TOPO-001**: Implement Cytoscape.js deterministic layout per PRD
- [ ] **TOPO-002**: Add seeded random layout using seedrandom library
- [ ] **TOPO-003**: Implement dagre layout for hierarchical views
- [ ] **TOPO-004**: Implement cola layout for force-directed views
- [ ] **TOPO-005**: Add layout direction toggle (TB/LR)
- [ ] **TOPO-006**: Validate layout determinism in development mode

### 3.2 Topology Interactions

- [ ] **TOPO-007**: Implement blast radius visualization on hover
- [ ] **TOPO-008**: Add node selection with detail panel slide-in
- [ ] **TOPO-009**: Implement multi-select with Shift+drag
- [ ] **TOPO-010**: Add context menu on right-click (actions, logs, exec, delete)
- [ ] **TOPO-011**: Add zoom controls (10% - 500% range)
- [ ] **TOPO-012**: Implement pan with drag
- [ ] **TOPO-013**: Add space bar to pause/resume updates
- [ ] **TOPO-014**: Add minimap for large graphs

### 3.3 Topology Filtering

- [ ] **TOPO-015**: Implement namespace filter (dim, not remove)
- [ ] **TOPO-016**: Implement kind filter (16+ resource types)
- [ ] **TOPO-017**: Implement status filter (healthy/warning/critical)
- [ ] **TOPO-018**: Implement label filter
- [ ] **TOPO-019**: Add search highlighting in topology

### 3.4 Topology Styling

- [ ] **TOPO-020**: Implement 30+ resource type node styles per PRD
- [ ] **TOPO-021**: Add edge styles for relationship types (owns, selects, mounts, etc.)
- [ ] **TOPO-022**: Add animated edges for network flow
- [ ] **TOPO-023**: Add node status colors (healthy=green, warning=amber, critical=rose)
- [ ] **TOPO-024**: Add selection glow effect
- [ ] **TOPO-025**: Add faded state for filtered nodes

### 3.5 Topology Export

- [ ] **TOPO-026**: Implement PNG export (2x scale, white background)
- [ ] **TOPO-027**: Implement SVG export
- [ ] **TOPO-028**: Implement PDF export with WYSIWYG parity
- [ ] **TOPO-029**: Validate export matches UI rendering exactly

### 3.6 Resource-Level Topology

- [ ] **TOPO-030**: Add Topology tab to ALL resource detail pages
- [ ] **TOPO-031**: Implement resource-centered graph view
- [ ] **TOPO-032**: Show 2-hop relationships from selected resource
- [ ] **TOPO-033**: Add "Show in Full Topology" action

---

## 4. YAML & Editor Consistency Tasks

### 4.1 Global YAML Tab Cleanup

- [x] **YAML-001**: Remove duplicate Copy/Download buttons from Pod detail YAML tab
- [x] **YAML-002**: Remove duplicate buttons from Deployment detail YAML tab
- [x] **YAML-003**: Remove duplicate buttons from ReplicaSet detail YAML tab
- [x] **YAML-004**: Remove duplicate buttons from StatefulSet detail YAML tab
- [x] **YAML-005**: Remove duplicate buttons from DaemonSet detail YAML tab
- [x] **YAML-006**: Remove duplicate buttons from Job detail YAML tab
- [x] **YAML-007**: Remove duplicate buttons from CronJob detail YAML tab
- [x] **YAML-008**: Audit and cleanup ALL remaining resource YAML tabs (verified - 41 detail pages use consistent YamlViewer)
- [x] **YAML-009**: Ensure consistent YamlViewer header actions across all resources (implemented)

### 4.2 CodeMirror Editor

- [x] **YAML-010**: Ensure consistent CodeMirror theme (Kubilitics dark theme) (implemented)
- [x] **YAML-011**: Add line numbers on all YAML editors (implemented)
- [x] **YAML-012**: Add code folding on all YAML editors (implemented)
- [x] **YAML-013**: Add active line highlighting (implemented)
- [x] **YAML-014**: Implement dynamic font sizing (implemented)
- [x] **YAML-015**: Add YAML syntax validation (implemented in ResourceCreator)
- [x] **YAML-016**: Add Kubernetes manifest validation (apiVersion, kind, metadata) (implemented)

### 4.3 YAML Comparison

- [ ] **YAML-017**: Implement YamlCompareViewer for all resources
- [ ] **YAML-018**: Add version selector dropdown
- [ ] **YAML-019**: Add side-by-side diff view
- [ ] **YAML-020**: Add inline diff highlighting
- [ ] **YAML-021**: Add "Revert to Version" action

---

## 5. Create / Edit / Bulk Action Tasks

### 5.1 Missing Create Flows

- [x] **CREATE-001**: Service - ResourceCreator already integrated
- [x] **CREATE-002**: Endpoints - create flow added
- [x] **CREATE-003**: EndpointSlices - create flow added
- [x] **CREATE-004**: NetworkPolicies - create flow added
- [x] **CREATE-005**: IngressClasses - create flow added
- [x] **CREATE-006**: PersistentVolumeClaims - create flow added
- [x] **CREATE-007**: StorageClasses - create flow added
- [x] **CREATE-008**: VolumeAttachments - create flow added
- [x] **CREATE-009**: Leases - create flow added
- [x] **CREATE-010**: ClusterRoleBindings - create flow added
- [x] **CREATE-011**: VerticalPodAutoscalers - create flow added
- [x] **CREATE-012**: PodDisruptionBudgets - create flow added
- [x] **CREATE-013**: ReplicaSets - create flow added

### 5.2 Edit Flow Enhancements

- [ ] **EDIT-001**: Implement diff preview before save on all resources
- [ ] **EDIT-002**: Add validation errors display before save
- [ ] **EDIT-003**: Add rollback confirmation dialog
- [ ] **EDIT-004**: Implement dry-run validation for edits
- [ ] **EDIT-005**: Add "Apply" vs "Apply & Close" options

### 5.3 Bulk Actions Parity

For each resource type, implement bulk actions matching Pod:

- [ ] **BULK-001**: Add bulk selection checkbox column to ALL list pages
- [ ] **BULK-002**: Add "Select All" functionality to ALL list pages
- [ ] **BULK-003**: Add bulk delete action to ALL resources
- [ ] **BULK-004**: Add bulk restart action to applicable workloads
- [ ] **BULK-005**: Add bulk export YAML action to ALL resources
- [ ] **BULK-006**: Add bulk label/annotate action to ALL resources
- [ ] **BULK-007**: Add bulk action bar (appears when items selected)

### 5.4 Validation & Error Handling

- [ ] **VAL-001**: Add client-side YAML validation on create/edit
- [ ] **VAL-002**: Display server-side validation errors clearly
- [ ] **VAL-003**: Add field-level validation in form-based creation
- [ ] **VAL-004**: Add confirmation dialogs for destructive actions
- [ ] **VAL-005**: Add success/error toasts with action context

---

## 6. Backend Integration Tasks

### 6.1 API Client Layer

- [ ] **API-001**: Implement REST client with axios configuration
- [ ] **API-002**: Add request/response interceptors for auth headers
- [ ] **API-003**: Implement request retry with exponential backoff
- [ ] **API-004**: Add request cancellation on component unmount
- [ ] **API-005**: Implement request deduplication

### 6.2 Real-Time Updates (WebSocket)

- [ ] **WS-001**: Implement WebSocket client for real-time updates
- [ ] **WS-002**: Add watch endpoint subscriptions per resource type
- [ ] **WS-003**: Implement delta updates for topology
- [ ] **WS-004**: Add connection status indicator
- [ ] **WS-005**: Implement reconnection with backoff

### 6.3 Data Loading States

For each resource type:
- [ ] **LOAD-001**: Implement loading skeletons for list pages
- [ ] **LOAD-002**: Implement loading skeletons for detail pages
- [ ] **LOAD-003**: Add empty states with appropriate messaging
- [ ] **LOAD-004**: Add error states with retry actions
- [ ] **LOAD-005**: Implement pull-to-refresh on mobile

### 6.4 API Endpoint Coverage

Ensure hooks exist for all 50+ resource types:

- [ ] **HOOK-001**: Audit useK8sResourceList for all resources
- [ ] **HOOK-002**: Audit useResourceDetail for all resources
- [ ] **HOOK-003**: Add useDeleteK8sResource for all resources
- [ ] **HOOK-004**: Add useUpdateK8sResource for all resources
- [ ] **HOOK-005**: Add useCreateK8sResource for all resources
- [ ] **HOOK-006**: Add useK8sEvents for all applicable resources

---

## 7. Device & Resolution Tasks

### 7.1 Mobile (< 768px)

- [ ] **MOBILE-001**: Implement bottom navigation bar
- [ ] **MOBILE-002**: Convert sidebar to bottom sheet
- [ ] **MOBILE-003**: Implement swipe gestures for navigation
- [ ] **MOBILE-004**: Add pull-to-refresh on all list pages
- [ ] **MOBILE-005**: Convert detail panel to bottom sheet
- [ ] **MOBILE-006**: Optimize table layouts for mobile (horizontal scroll or card view)
- [ ] **MOBILE-007**: Add touch-friendly tap targets (48px minimum)
- [ ] **MOBILE-008**: Implement pinch-to-zoom for topology

### 7.2 Tablet (768px - 1024px)

- [ ] **TABLET-001**: Implement adaptive sidebar (auto-collapse)
- [ ] **TABLET-002**: Optimize 2-column grid layouts
- [ ] **TABLET-003**: Test detail panel overlay behavior
- [ ] **TABLET-004**: Verify topology interaction with touch

### 7.3 Laptop (1024px - 1440px)

- [ ] **LAPTOP-001**: Default sidebar expanded
- [ ] **LAPTOP-002**: Verify 3-column grid layouts
- [ ] **LAPTOP-003**: Test detail panel slide-in

### 7.4 Large Monitor (1440px - 2560px)

- [ ] **LARGE-001**: Implement increased information density option
- [ ] **LARGE-002**: Add 4-column grid option for list pages
- [ ] **LARGE-003**: Optimize topology canvas utilization
- [ ] **LARGE-004**: Test side-by-side layout (list + detail)

### 7.5 Ultra-Wide (> 2560px)

- [ ] **ULTRA-001**: Add max-width container option
- [ ] **ULTRA-002**: Implement multi-panel layout option
- [ ] **ULTRA-003**: Test horizontal scroll prevention

---

## 8. Final Hardening Tasks

### 8.1 Accessibility (WCAG 2.1 AA)

- [ ] **A11Y-001**: Add skip navigation link
- [ ] **A11Y-002**: Ensure all interactive elements are keyboard accessible
- [ ] **A11Y-003**: Add ARIA labels to all icons and buttons
- [ ] **A11Y-004**: Implement focus management for modals
- [ ] **A11Y-005**: Add screen reader announcements for dynamic content
- [ ] **A11Y-006**: Ensure color contrast ratios meet AA standards
- [ ] **A11Y-007**: Add reduced motion support
- [ ] **A11Y-008**: Test with screen readers (VoiceOver, NVDA)

### 8.2 Performance

- [ ] **PERF-001**: Implement virtualized lists for 1000+ items
- [ ] **PERF-002**: Add lazy loading for route components
- [ ] **PERF-003**: Implement code splitting per feature module
- [ ] **PERF-004**: Add skeleton loading for perceived performance
- [ ] **PERF-005**: Optimize bundle size (target < 500KB gzipped)
- [ ] **PERF-006**: Implement topology canvas performance mode (> 500 nodes)
- [ ] **PERF-007**: Add Web Worker for topology layout calculations

### 8.3 State Consistency

- [ ] **STATE-001**: Implement optimistic updates for mutations
- [ ] **STATE-002**: Add undo/redo for critical actions
- [ ] **STATE-003**: Persist UI preferences to localStorage
- [ ] **STATE-004**: Implement stale-while-revalidate caching
- [ ] **STATE-005**: Add conflict resolution for concurrent edits

### 8.4 Error Handling

- [ ] **ERR-001**: Add global error boundary
- [ ] **ERR-002**: Implement error logging service integration
- [ ] **ERR-003**: Add user-friendly error messages
- [ ] **ERR-004**: Implement retry mechanisms for transient failures
- [ ] **ERR-005**: Add offline mode detection and messaging

### 8.5 Testing

- [ ] **TEST-001**: Add unit tests for utility functions
- [ ] **TEST-002**: Add component tests for UI components
- [ ] **TEST-003**: Add integration tests for resource flows
- [ ] **TEST-004**: Add E2E tests for critical user journeys
- [ ] **TEST-005**: Add visual regression tests for topology

---

## 9. Priority Matrix

### P0 - Critical (Must have for MVP)

1. All 50+ resources have list pages with search/filter/sort
2. All 50+ resources have detail pages with Overview/YAML/Events tabs
3. Create flow for all writable resources
4. Topology tab on all detail pages
5. YAML tab consistency across all resources
6. Mobile responsive layout

### P1 - High (Required for production)

1. Bulk actions on all list pages
2. Full topology engine with Cytoscape
3. Real-time WebSocket updates
4. All 8 tabs on Pod-like resources
5. Accessibility compliance

### P2 - Medium (Enhanced experience)

1. Advanced topology features (blast radius, X-ray)
2. YAML comparison/diff views
3. Performance metrics tabs
4. Internationalization
5. Keyboard shortcuts

### P3 - Low (Nice to have)

1. Collaboration features
2. AI integration hooks
3. Gamification elements
4. Time machine feature

---

## Appendix: Resource Checklist Matrix

| Resource | List | Detail | Create | Bulk | Topology | YAML Clean |
|----------|------|--------|--------|------|----------|------------|
| Pod | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Deployment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ReplicaSet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| StatefulSet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| DaemonSet | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Job | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| CronJob | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Service | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Ingress | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| ConfigMap | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| Secret | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| Node | ✅ | ✅ | N/A | ⚠️ | ✅ | ⚠️ |
| Namespace | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| PV | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| PVC | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| StorageClass | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| ServiceAccount | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| Role | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| ClusterRole | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| RoleBinding | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| ClusterRoleBinding | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| HPA | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| VPA | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| PDB | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ |
| NetworkPolicy | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| CRD | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| MutatingWebhook | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |
| ValidatingWebhook | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ |

**Legend:** ✅ Complete | ⚠️ Partial | ❌ Missing | N/A Not Applicable

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Feb 2026 | Kubilitics Team | Initial comprehensive task list |

**This document is the FINAL EXECUTION PLAN. Nothing outside it will be built.**
