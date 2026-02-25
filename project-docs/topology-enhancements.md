# Kubilitics Topology Enhancement Specification
## Kubernetes Relationship Intelligence Engine — v2.0

**Status:** Engineering Design
**Branch:** `claude/k8s-relationship-intelligence-fjyoQ`
**Scope:** Backend (`kubilitics-backend/internal/topology/`) + Frontend (`kubilitics-frontend/src/topology-engine/`)
**Target clusters:** kind · docker-desktop · minikube · k3s · k3d · RKE · RKE2 · OpenShift · EKS · AKS · GKE · OKE · Harvester · bare-metal on-prem — any cluster that issues a kubeconfig

---

## 0. Executive Summary

The current topology is workload-first: it shows who owns what (Deployment → ReplicaSet → Pod) and who connects to what (Service → Pod). That is 30 % of the picture.

Production incidents live in the other 70 %: the storage chain, the node-level mounts, the provisioner health, the cross-region confusion. Engineers run `kubectl describe pvc`, `kubectl describe pv`, `kubectl get storageclass`, `kubectl get node` one at a time to reconstruct a picture that Kubilitics should show in zero keystrokes.

This document specifies a **Relationship Intelligence Engine** that makes every infrastructure dependency visible, interactive, and risk-colored — for every class of Kubernetes cluster, from a developer's laptop (`kind`) to a multi-region enterprise EKS fleet.

---

## 1. Design Principles

| Principle | Meaning |
|---|---|
| **Relationship-first** | Every node renders its upstream dependencies AND downstream dependents simultaneously. No resource is an island. |
| **Cluster-agnostic** | Behavior degrades gracefully when APIs are absent (e.g. no CSI on bare-metal, no topology labels on kind). Never crash, always show partial truth. |
| **Lazy enrichment** | Core graph builds in < 500 ms. Storage chain details, NFS probes, and node mount status stream in asynchronously via WebSocket. |
| **Risk-colored by default** | Every unhealthy relationship is colored Red / Yellow / Orange at render time without any user action. |
| **RCA-mode on demand** | One click on any resource explodes the full dependency chain without reloading the page. |
| **No kubectl describe needed** | A senior SRE should be able to diagnose a PVC-Pending incident entirely inside the Kubilitics topology canvas. |

---

## 2. Cluster Type Matrix

The engine must adapt its enrichment strategy based on cluster flavor. Flavor is detected from the kubeconfig `server` field, node labels, and StorageClass provisioner names.

```
cluster flavor → detected by → enrichment strategy
─────────────────────────────────────────────────────────────────────────────────────────────────────
kind / docker-desktop / minikube / k3s     → node label kubernetes.io/hostname prefix or
                                              StorageClass provisioner = rancher.io/local-path
                                            → No region labels. Show "local" storage tier.
                                              NFS probe skipped. Node mount check is best-effort.

k3d / RKE / RKE2                           → rancher.io annotations on nodes
                                            → Check longhorn.io CRDs. If present, enrich
                                              Longhorn volumes as a first-class node type.

OpenShift (OCP)                            → node label node.openshift.io/os_id
                                            → Enrich with Route objects alongside Ingress.
                                              Recognize rook-ceph provisioner.

EKS                                        → node label eks.amazonaws.com/nodegroup
                                            → Region from topology.kubernetes.io/region.
                                              StorageClass provisioner = ebs.csi.aws.com or
                                              efs.csi.aws.com. Enrich EFS access points.

AKS                                        → node label kubernetes.azure.com/agentpool
                                            → Region from topology.kubernetes.io/region.
                                              Provisioner = disk.csi.azure.com or
                                              file.csi.azure.com.

GKE                                        → node label cloud.google.com/gke-nodepool
                                            → Region from topology.kubernetes.io/region.
                                              Provisioner = pd.csi.storage.gke.io.

OKE (Oracle)                               → node label oke.oraclecloud.com/node.info.
                                            → Provisioner = blockvolume.csi.oraclecloud.com.

Bare-metal / on-prem (kubeadm, kubespray)  → No cloud labels detected.
                                            → NFS inference from PV.spec.nfs.server.
                                              Active NFS probe via TCP port 2049.
                                              Show "NFS Server" as a first-class node.
```

All detection is heuristic and non-blocking. Unknown cluster types fall back to "generic" enrichment.

---

## 3. Data Model Extensions

### 3.1 Backend — `internal/models/topology.go`

Extend `TopologyNode` with a `StorageDetail` payload and a `RiskLevel` field. These fields are omitted when zero so the schema stays backward-compatible.

```go
// StorageBackendType classifies the physical storage layer.
type StorageBackendType string

const (
    StorageBackendNFS       StorageBackendType = "nfs"
    StorageBackendEBS       StorageBackendType = "ebs"
    StorageBackendEFS       StorageBackendType = "efs"
    StorageBackendAzureDisk StorageBackendType = "azure-disk"
    StorageBackendAzureFile StorageBackendType = "azure-file"
    StorageBackendGCEPD     StorageBackendType = "gce-pd"
    StorageBackendLonghorn  StorageBackendType = "longhorn"
    StorageBackendRookCeph  StorageBackendType = "rook-ceph"
    StorageBackendLocal     StorageBackendType = "local"
    StorageBackendHostPath  StorageBackendType = "hostpath"
    StorageBackendCSI       StorageBackendType = "csi"
    StorageBackendUnknown   StorageBackendType = "unknown"
)

// NFSDetail holds NFS-specific enrichment. Only populated when BackendType == "nfs".
type NFSDetail struct {
    Server    string `json:"server"`              // e.g. "192.168.1.100"
    Path      string `json:"path"`                // e.g. "/exports/k8s/pv-abc"
    Reachable *bool  `json:"reachable,omitempty"` // nil = not yet probed
    LatencyMs *int64 `json:"latencyMs,omitempty"` // TCP connect latency
}

// CSIDetail holds CSI-specific enrichment (AWS EBS, Azure Disk, GCE PD, etc.).
type CSIDetail struct {
    Driver     string            `json:"driver"`               // e.g. "ebs.csi.aws.com"
    VolumeID   string            `json:"volumeId,omitempty"`   // Cloud provider volume ID
    FSType     string            `json:"fsType,omitempty"`
    Parameters map[string]string `json:"parameters,omitempty"` // StorageClass parameters
    Region     string            `json:"region,omitempty"`
    Zone       string            `json:"zone,omitempty"`
}

// StorageDetail is embedded on PVC, PV, and StorageClass nodes.
type StorageDetail struct {
    BackendType    StorageBackendType `json:"backendType"`
    Provisioner    string             `json:"provisioner,omitempty"`  // e.g. "nfs.csi.k8s.io"
    ReclaimPolicy  string             `json:"reclaimPolicy,omitempty"` // Retain | Delete | Recycle
    AccessModes    []string           `json:"accessModes,omitempty"`
    StorageGB      *int64             `json:"storageGb,omitempty"`
    VolumeMode     string             `json:"volumeMode,omitempty"`   // Filesystem | Block
    MountPath      string             `json:"mountPath,omitempty"`    // Node-level mount path (from /proc/mounts)
    NFS            *NFSDetail         `json:"nfs,omitempty"`
    CSI            *CSIDetail         `json:"csi,omitempty"`
    NodeName       string             `json:"nodeName,omitempty"`     // Node where PV is mounted
    ConsumingPods  []string           `json:"consumingPods,omitempty"` // Pod names using this PVC
}

// NodeMountDetail is embedded on Node nodes.
type NodeMountDetail struct {
    MountedPVs    []string `json:"mountedPVs"`    // PV names mounted on this node
    NFSEndpoints  []string `json:"nfsEndpoints"`  // NFS server IPs observed
    MountFailures []string `json:"mountFailures"` // PVs with mount errors from node events
}

// RiskLevel classifies the actionable risk of a topology node.
type RiskLevel string

const (
    RiskNone     RiskLevel = ""
    RiskInfo     RiskLevel = "info"
    RiskWarning  RiskLevel = "warning"
    RiskCritical RiskLevel = "critical"
)

// RiskAnnotation is an individual risk finding attached to a node.
type RiskAnnotation struct {
    Code        string    `json:"code"`
    Description string    `json:"description"`
    Level       RiskLevel `json:"level"`
    Resolution  string    `json:"resolution,omitempty"`
}

// Extend TopologyNode (add these fields):
//
//   StorageDetail  *StorageDetail   `json:"storageDetail,omitempty"`
//   NodeMount      *NodeMountDetail `json:"nodeMount,omitempty"`
//   Risk           RiskLevel        `json:"risk,omitempty"`
//   RiskAnnotations []RiskAnnotation `json:"riskAnnotations,omitempty"`
//   Region         string           `json:"region,omitempty"`
//   Zone           string           `json:"zone,omitempty"`
//   ClusterFlavor  string           `json:"clusterFlavor,omitempty"` // eks|aks|gke|rke|kind|generic
```

### 3.2 Backend — Edge Extensions

Extend `TopologyEdge` with a `StorageEdge` flag and `RiskLevel` so the canvas can color edges.

```go
// Extend TopologyEdge:
//
//   IsStoragePath bool      `json:"isStoragePath,omitempty"` // Highlights the PVC→PV→SC chain
//   Risk          RiskLevel `json:"risk,omitempty"`
```

### 3.3 New Relationship Types

Add to the existing `RelationshipType` union in `topology.types.ts`:

```typescript
// Add to RelationshipType in kubilitics-frontend/src/topology-engine/types/topology.types.ts
type RelationshipType =
  // ... existing ...
  | 'provisioned_by'    // PV → StorageClass provisioner
  | 'backed_by_nfs'     // PV → NFS Server node (virtual)
  | 'backed_by_ebs'     // PV → AWS EBS volume (virtual annotation)
  | 'mounted_on'        // PVC/PV → Node (physical mount)
  | 'template_for'      // StatefulSet → PVC (per volumeClaimTemplate replica)
  | 'replica_of'        // PVC-0 ↔ PVC-1 (StatefulSet replicas)
  | 'resides_in'        // Node → Region/Zone (virtual grouping)
  | 'nfs_client_of'     // Node → NFS Server
  | 'csi_driver'        // StorageClass → CSI Driver node (virtual)
  | 'rca_dependency';   // Dynamic: computed during RCA traversal
```

---

## 4. Backend Relationship Inference Extensions

All new inferencing plugs into the existing `InferAllRelationships` method in `relationships.go`. Add these after step 7 (storage) and step 8 (nodes).

### 4.1 Deep Storage Chain (`inferDeepStorageChain`)

Replaces and supersedes the existing `inferStorageRelationships`. The existing method only maps PVC→PV and PVC→StorageClass. This extends it to the full chain.

```go
// inferDeepStorageChain builds the complete storage dependency chain:
//   Pod → PVC → PV → StorageClass → Provisioner (virtual node) → Backend (NFS/EBS/…)
//
// It also annotates PVC and PV nodes with StorageDetail and RiskAnnotations.
func (ri *RelationshipInferencer) inferDeepStorageChain(ctx context.Context) error {
    pvcs := ri.graph.GetNodesByType("PersistentVolumeClaim")
    pvs  := ri.graph.GetNodesByType("PersistentVolume")
    scs  := ri.graph.GetNodesByType("StorageClass")

    // Build PV name → PV node fast lookup
    pvByName := map[string]*models.TopologyNode{}
    for i := range pvs {
        pvByName[pvs[i].Name] = &pvs[i]
    }

    for _, pvc := range pvcs {
        k8sPVC, err := ri.engine.client.Clientset.CoreV1().
            PersistentVolumeClaims(pvc.Namespace).Get(ctx, pvc.Name, metav1.GetOptions{})
        if err != nil { continue }

        detail := &models.StorageDetail{}
        risk   := []models.RiskAnnotation{}

        // ── Risk: PVC Pending ────────────────────────────────────────────
        if k8sPVC.Status.Phase == corev1.ClaimPending {
            risk = append(risk, models.RiskAnnotation{
                Code:        "PVC_PENDING",
                Description: fmt.Sprintf("PVC %s/%s is Pending — no suitable PV or provisioner found", pvc.Namespace, pvc.Name),
                Level:       models.RiskCritical,
                Resolution:  "Check StorageClass availability and provisioner logs; ensure NFS server is reachable or cloud quota is not exhausted.",
            })
        }

        // ── PVC → PV ─────────────────────────────────────────────────────
        if k8sPVC.Spec.VolumeName != "" {
            pvNode := pvByName[k8sPVC.Spec.VolumeName]
            if pvNode != nil {
                ri.graph.AddEdge(models.TopologyEdge{
                    ID:               fmt.Sprintf("%s-%s-pvc-pv", pvc.ID, pvNode.ID),
                    Source:           pvc.ID,
                    Target:           pvNode.ID,
                    RelationshipType: "stores",
                    Label:            "bound to",
                    IsStoragePath:    true,
                    Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.volumeName"},
                })

                // Enrich PV with backend type and NFS/CSI details
                k8sPV, err := ri.engine.client.Clientset.CoreV1().
                    PersistentVolumes().Get(ctx, pvNode.Name, metav1.GetOptions{})
                if err == nil {
                    pvDetail := ri.enrichPVDetail(ctx, k8sPV)
                    detail.BackendType = pvDetail.BackendType
                    detail.NFS         = pvDetail.NFS
                    detail.CSI         = pvDetail.CSI
                    detail.ReclaimPolicy = string(k8sPV.Spec.PersistentVolumeReclaimPolicy)

                    // ── Risk: Delete reclaim in production namespaces ──────
                    if k8sPV.Spec.PersistentVolumeReclaimPolicy == corev1.PersistentVolumeReclaimDelete {
                        if ri.isProductionNamespace(pvc.Namespace) {
                            risk = append(risk, models.RiskAnnotation{
                                Code:        "RECLAIM_DELETE_PROD",
                                Description: fmt.Sprintf("PV %s uses reclaimPolicy=Delete in namespace %s — deleting the PVC will permanently destroy data", pvNode.Name, pvc.Namespace),
                                Level:       models.RiskWarning,
                                Resolution:  "Change reclaimPolicy to Retain for production volumes, or confirm that this volume is expendable.",
                            })
                        }
                    }

                    // ── Risk: PV Released (not bound) ─────────────────────
                    if k8sPV.Status.Phase == corev1.VolumeReleased {
                        risk = append(risk, models.RiskAnnotation{
                            Code:        "PV_RELEASED",
                            Description: fmt.Sprintf("PV %s is Released — it was previously bound but the PVC was deleted", pvNode.Name),
                            Level:       models.RiskWarning,
                            Resolution:  "Manually patch claimRef to rebind, or delete and reprovision.",
                        })
                    }

                    // ── NFS virtual node + edge ────────────────────────────
                    if pvDetail.NFS != nil {
                        nfsNodeID := fmt.Sprintf("nfs-server-%s", sanitize(pvDetail.NFS.Server))
                        ri.graph.AddNode(models.TopologyNode{
                            ID:        nfsNodeID,
                            Kind:      "NFSServer",
                            Name:      pvDetail.NFS.Server,
                            Namespace: "",
                            Status:    ri.nfsStatus(pvDetail.NFS),
                        })
                        ri.graph.AddEdge(models.TopologyEdge{
                            ID:               fmt.Sprintf("%s-%s-nfs", pvNode.ID, nfsNodeID),
                            Source:           pvNode.ID,
                            Target:           nfsNodeID,
                            RelationshipType: "backed_by_nfs",
                            Label:            fmt.Sprintf("NFS path %s", pvDetail.NFS.Path),
                            IsStoragePath:    true,
                            Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.nfs"},
                        })
                    }

                    // ── CSI virtual node + edge ────────────────────────────
                    if pvDetail.CSI != nil {
                        csiNodeID := fmt.Sprintf("csi-driver-%s", sanitize(pvDetail.CSI.Driver))
                        ri.graph.AddNode(models.TopologyNode{
                            ID:        csiNodeID,
                            Kind:      "CSIDriver",
                            Name:      pvDetail.CSI.Driver,
                            Namespace: "",
                        })
                        ri.graph.AddEdge(models.TopologyEdge{
                            ID:               fmt.Sprintf("%s-%s-csi", pvNode.ID, csiNodeID),
                            Source:           pvNode.ID,
                            Target:           csiNodeID,
                            RelationshipType: "provisioned_by",
                            Label:            fmt.Sprintf("CSI driver: %s", pvDetail.CSI.Driver),
                            IsStoragePath:    true,
                            Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.csi.driver"},
                        })
                    }
                }
            }
        }

        // ── PVC → StorageClass ────────────────────────────────────────────
        if k8sPVC.Spec.StorageClassName != nil && *k8sPVC.Spec.StorageClassName != "" {
            for _, sc := range scs {
                if sc.Name == *k8sPVC.Spec.StorageClassName {
                    ri.graph.AddEdge(models.TopologyEdge{
                        ID:               fmt.Sprintf("%s-%s-pvc-sc", pvc.ID, sc.ID),
                        Source:           pvc.ID,
                        Target:           sc.ID,
                        RelationshipType: "stores",
                        Label:            "uses",
                        IsStoragePath:    true,
                        Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.storageClassName"},
                    })
                }
            }
        }

        // Attach enrichment to node (via extra map — rendered by frontend)
        ri.graph.SetNodeExtra(pvc.ID, map[string]interface{}{
            "storageDetail":   detail,
            "riskAnnotations": risk,
            "risk":            ri.highestRisk(risk),
        })
    }
    return nil
}
```

### 4.2 StatefulSet Volume Claim Templates (`inferStatefulSetStorage`)

StatefulSets generate one PVC per replica. The current inferencer misses this entirely because volumeClaimTemplates are not reflected as owner references.

```go
// inferStatefulSetStorage maps:
//   StatefulSet → volumeClaimTemplate-N → PVC-<name>-<ordinal> → PV → backend
//
// Relationship type "template_for" on StatefulSet→PVC edges signals the canvas
// to render ordinal grouping (PVC-0, PVC-1, PVC-2 as a fan-out).
func (ri *RelationshipInferencer) inferStatefulSetStorage(ctx context.Context) error {
    statefulSets := ri.graph.GetNodesByType("StatefulSet")

    for _, sts := range statefulSets {
        k8sSTS, err := ri.engine.client.Clientset.AppsV1().
            StatefulSets(sts.Namespace).Get(ctx, sts.Name, metav1.GetOptions{})
        if err != nil { continue }

        replicas := int32(1)
        if k8sSTS.Spec.Replicas != nil {
            replicas = *k8sSTS.Spec.Replicas
        }

        for _, vct := range k8sSTS.Spec.VolumeClaimTemplates {
            for ordinal := int32(0); ordinal < replicas; ordinal++ {
                pvcName := fmt.Sprintf("%s-%s-%d", vct.Name, k8sSTS.Name, ordinal)
                pvcs := ri.graph.GetNodesByType("PersistentVolumeClaim")
                for _, pvc := range pvcs {
                    if pvc.Namespace == sts.Namespace && pvc.Name == pvcName {
                        ri.graph.AddEdge(models.TopologyEdge{
                            ID:               fmt.Sprintf("%s-%s-sts-vct", sts.ID, pvc.ID),
                            Source:           sts.ID,
                            Target:           pvc.ID,
                            RelationshipType: "template_for",
                            Label:            fmt.Sprintf("replica %d / %s", ordinal, vct.Name),
                            IsStoragePath:    true,
                            Metadata:         models.EdgeMetadata{
                                Derivation:  "volumeClaimTemplate",
                                Confidence:  1,
                                SourceField: "spec.volumeClaimTemplates",
                            },
                        })
                    }
                }
            }
        }
    }
    return nil
}
```

### 4.3 Node Mount Awareness (`inferNodeMounts`)

Map every Node to the PVs it physically mounts, and detect NFS connectivity issues via node Events.

```go
// inferNodeMounts enriches Node nodes with mount awareness:
//   Node → mounted PVs (via Pod scheduling chain)
//   Node → NFS endpoints (inferred from PV.spec.nfs.server on pods scheduled here)
//
// Failure signals come from Node Events with reason "FailedMount".
func (ri *RelationshipInferencer) inferNodeMounts(ctx context.Context) error {
    nodes := ri.graph.GetNodesByType("Node")

    for _, node := range nodes {
        mountDetail := &models.NodeMountDetail{}

        // Find pods scheduled on this node
        pods := ri.graph.GetNodesByType("Pod")
        for _, pod := range pods {
            k8sPod, err := ri.engine.client.Clientset.CoreV1().
                Pods(pod.Namespace).Get(ctx, pod.Name, metav1.GetOptions{})
            if err != nil || k8sPod.Spec.NodeName != node.Name { continue }

            for _, vol := range k8sPod.Spec.Volumes {
                if vol.PersistentVolumeClaim == nil { continue }
                pvcName := vol.PersistentVolumeClaim.ClaimName
                k8sPVC, err := ri.engine.client.Clientset.CoreV1().
                    PersistentVolumeClaims(pod.Namespace).Get(ctx, pvcName, metav1.GetOptions{})
                if err != nil { continue }

                pvName := k8sPVC.Spec.VolumeName
                if pvName == "" { continue }

                k8sPV, err := ri.engine.client.Clientset.CoreV1().
                    PersistentVolumes().Get(ctx, pvName, metav1.GetOptions{})
                if err != nil { continue }

                mountDetail.MountedPVs = append(mountDetail.MountedPVs, pvName)
                if k8sPV.Spec.NFS != nil {
                    mountDetail.NFSEndpoints = appendUnique(mountDetail.NFSEndpoints, k8sPV.Spec.NFS.Server)
                }

                // Add Node → PV "mounted_on" edge
                pvNodes := ri.graph.GetNodesByType("PersistentVolume")
                for _, pvNode := range pvNodes {
                    if pvNode.Name == pvName {
                        ri.graph.AddEdge(models.TopologyEdge{
                            ID:               fmt.Sprintf("%s-%s-mount", node.ID, pvNode.ID),
                            Source:           pvNode.ID,
                            Target:           node.ID,
                            RelationshipType: "mounted_on",
                            Label:            "mounted on",
                            IsStoragePath:    true,
                            Metadata:         models.EdgeMetadata{Derivation: "podScheduling", Confidence: 0.9, SourceField: "spec.nodeName"},
                        })
                    }
                }
            }
        }

        // Detect FailedMount events on this node
        events, err := ri.engine.client.Clientset.CoreV1().Events("").List(ctx, metav1.ListOptions{
            FieldSelector: fmt.Sprintf("involvedObject.kind=Node,involvedObject.name=%s,reason=FailedMount", node.Name),
        })
        if err == nil {
            for _, evt := range events.Items {
                mountDetail.MountFailures = append(mountDetail.MountFailures, evt.Message)
            }
        }

        extra := ri.graph.GetNodeExtra(node.ID)
        if extra == nil { extra = map[string]interface{}{} }
        extra["nodeMount"] = mountDetail
        if len(mountDetail.MountFailures) > 0 {
            extra["risk"] = string(models.RiskCritical)
            extra["riskAnnotations"] = []models.RiskAnnotation{{
                Code:        "NODE_MOUNT_FAILURE",
                Description: fmt.Sprintf("Node %s has mount failures: %s", node.Name, mountDetail.MountFailures[0]),
                Level:       models.RiskCritical,
                Resolution:  "Check kubelet logs and NFS server reachability from this node.",
            }}
        }
        ri.graph.SetNodeExtra(node.ID, extra)
    }
    return nil
}
```

### 4.4 Region / Zone Awareness (`inferRegionTopology`)

Inject synthetic Region and Zone grouping nodes when cluster nodes carry topology labels. This is a no-op on clusters without these labels (kind, docker-desktop).

```go
// Standard topology labels used by all major cloud providers and kubeadm.
const (
    LabelRegion = "topology.kubernetes.io/region" // replaces failure-domain.beta.kubernetes.io/region
    LabelZone   = "topology.kubernetes.io/zone"
    // Fallbacks for older clusters
    LabelRegionLegacy = "failure-domain.beta.kubernetes.io/region"
    LabelZoneLegacy   = "failure-domain.beta.kubernetes.io/zone"
)

// Cloud-provider-specific pool labels used for cluster flavor detection.
var clusterFlavorLabels = map[string]string{
    "eks.amazonaws.com/nodegroup":      "eks",
    "kubernetes.azure.com/agentpool":   "aks",
    "cloud.google.com/gke-nodepool":    "gke",
    "oke.oraclecloud.com/node.info":    "oke",
    "node.openshift.io/os_id":          "openshift",
    "node.rke2.io/hostname":            "rke2",
}

func (ri *RelationshipInferencer) inferRegionTopology(ctx context.Context) error {
    k8sNodes, err := ri.engine.client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
    if err != nil { return nil } // non-fatal

    regions := map[string]string{} // regionName → nodeID

    for _, k8sNode := range k8sNodes.Items {
        region := firstLabel(k8sNode.Labels, LabelRegion, LabelRegionLegacy)
        zone   := firstLabel(k8sNode.Labels, LabelZone, LabelZoneLegacy)
        flavor := detectFlavor(k8sNode.Labels)

        // Attach region/zone/flavor to the Node graph node
        nodeID := fmt.Sprintf("node-%s", k8sNode.Name)
        extra  := ri.graph.GetNodeExtra(nodeID)
        if extra == nil { extra = map[string]interface{}{} }
        if region != "" { extra["region"] = region }
        if zone   != "" { extra["zone"]   = zone }
        if flavor != "" { extra["clusterFlavor"] = flavor }
        ri.graph.SetNodeExtra(nodeID, extra)

        if region == "" { continue } // Skip synthetic grouping for label-less nodes

        // Create a synthetic Region node (idempotent)
        regionNodeID := fmt.Sprintf("region-%s", sanitize(region))
        if _, seen := regions[region]; !seen {
            regions[region] = regionNodeID
            ri.graph.AddNode(models.TopologyNode{
                ID:   regionNodeID,
                Kind: "Region",
                Name: region,
            })
        }

        // Node → Region edge
        nodeGraphNode := ri.graph.GetNode(nodeID)
        if nodeGraphNode != nil {
            ri.graph.AddEdge(models.TopologyEdge{
                ID:               fmt.Sprintf("%s-%s-region", nodeID, regionNodeID),
                Source:           nodeID,
                Target:           regionNodeID,
                RelationshipType: "resides_in",
                Label:            "in region",
                Metadata:         models.EdgeMetadata{Derivation: "nodeLabel", Confidence: 1, SourceField: LabelRegion},
            })
        }

        // Zone node (child of Region)
        if zone != "" {
            zoneNodeID := fmt.Sprintf("zone-%s", sanitize(zone))
            ri.graph.AddNode(models.TopologyNode{
                ID:   zoneNodeID,
                Kind: "Zone",
                Name: zone,
            })
            ri.graph.AddEdge(models.TopologyEdge{
                ID:               fmt.Sprintf("%s-%s-zone", nodeID, zoneNodeID),
                Source:           nodeID,
                Target:           zoneNodeID,
                RelationshipType: "resides_in",
                Label:            "in zone",
                Metadata:         models.EdgeMetadata{Derivation: "nodeLabel", Confidence: 1, SourceField: LabelZone},
            })
        }
    }
    return nil
}
```

### 4.5 NFS Reachability Probe (Async Enrichment)

Run after the main graph is built and streamed to the client. Results are pushed via WebSocket as partial graph updates.

```go
// File: internal/topology/nfs_probe.go

// NFSProbeResult is sent over WebSocket as a partial topology patch.
type NFSProbeResult struct {
    NodeID    string `json:"nodeId"`    // NFSServer virtual node ID
    Server    string `json:"server"`
    Reachable bool   `json:"reachable"`
    LatencyMs int64  `json:"latencyMs"`
}

// ProbeNFSServers probes all NFSServer virtual nodes in the graph (TCP port 2049).
// Results are dispatched via the patchCh channel and consumed by the WebSocket handler.
// Context cancellation (e.g. user navigates away) stops probes cleanly.
//
// Probe timeout: 3 seconds per host.
// Concurrency: up to 20 goroutines (semaphore-limited).
func ProbeNFSServers(ctx context.Context, graph *models.TopologyGraph, patchCh chan<- NFSProbeResult) {
    sem := make(chan struct{}, 20)
    for _, node := range graph.Nodes {
        if node.Kind != "NFSServer" { continue }
        sem <- struct{}{}
        go func(n models.TopologyNode) {
            defer func() { <-sem }()
            start := time.Now()
            conn, err := net.DialTimeout("tcp", net.JoinHostPort(n.Name, "2049"), 3*time.Second)
            latency := time.Since(start).Milliseconds()
            reachable := err == nil
            if conn != nil { conn.Close() }
            select {
            case patchCh <- NFSProbeResult{
                NodeID: n.ID, Server: n.Name,
                Reachable: reachable, LatencyMs: latency,
            }:
            case <-ctx.Done():
            }
        }(node)
    }
}
```

### 4.6 Risk Classification Engine (`internal/topology/risk.go`)

Centralise all risk annotations in one pass after relationship inference. Runs at the end of `InferAllRelationships`.

```go
// RiskRule defines a single risk check evaluated against a TopologyNode
// and its graph context (edges, adjacent nodes).
type RiskRule struct {
    Code       string
    Level      models.RiskLevel
    Message    func(node models.TopologyNode, ctx RiskContext) string
    Resolution string
    Applies    func(node models.TopologyNode, ctx RiskContext) bool
}

// Built-in rules — all cluster types:
var BuiltInRiskRules = []RiskRule{
    {
        Code:  "PVC_PENDING",
        Level: models.RiskCritical,
        Applies: func(n models.TopologyNode, _ RiskContext) bool {
            return n.Kind == "PersistentVolumeClaim" && n.Status == "Pending"
        },
        Message: func(n models.TopologyNode, _ RiskContext) string {
            return fmt.Sprintf("PVC %s/%s is Pending", n.Namespace, n.Name)
        },
        Resolution: "Verify StorageClass provisioner is running; check quota; confirm NFS/cloud storage is reachable.",
    },
    {
        Code:  "PV_NOT_BOUND",
        Level: models.RiskWarning,
        Applies: func(n models.TopologyNode, _ RiskContext) bool {
            return n.Kind == "PersistentVolume" && (n.Status == "Released" || n.Status == "Available")
        },
        Message: func(n models.TopologyNode, _ RiskContext) string {
            return fmt.Sprintf("PV %s is %s — not currently bound to any PVC", n.Name, n.Status)
        },
        Resolution: "Delete the PV if unused, or patch its claimRef to rebind.",
    },
    {
        Code:  "NFS_UNREACHABLE",
        Level: models.RiskCritical,
        Applies: func(n models.TopologyNode, _ RiskContext) bool {
            return n.Kind == "NFSServer" && n.Status == "Unreachable"
        },
        Message: func(n models.TopologyNode, _ RiskContext) string {
            return fmt.Sprintf("NFS server %s is unreachable on TCP/2049", n.Name)
        },
        Resolution: "Check NFS server health, firewall rules, and node network connectivity.",
    },
    {
        Code:  "RECLAIM_DELETE_PROD",
        Level: models.RiskWarning,
        Applies: func(n models.TopologyNode, ctx RiskContext) bool {
            if n.Kind != "PersistentVolume" { return false }
            extra := ctx.Graph.GetNodeExtra(n.ID)
            if extra == nil { return false }
            sd, _ := extra["storageDetail"].(*models.StorageDetail)
            return sd != nil && sd.ReclaimPolicy == "Delete" && ctx.IsProduction(n.Namespace)
        },
        Message: func(n models.TopologyNode, _ RiskContext) string {
            return fmt.Sprintf("PV %s uses reclaimPolicy=Delete — data will be destroyed when PVC is deleted", n.Name)
        },
        Resolution: "Change to reclaimPolicy=Retain for production volumes.",
    },
    {
        Code:  "STATEFULSET_PVC_MISMATCH",
        Level: models.RiskWarning,
        Applies: func(n models.TopologyNode, ctx RiskContext) bool {
            if n.Kind != "StatefulSet" { return false }
            return ctx.StatefulSetPVCCountMismatch(n)
        },
        Message: func(n models.TopologyNode, ctx RiskContext) string {
            return fmt.Sprintf("StatefulSet %s/%s: expected PVCs not all bound", n.Namespace, n.Name)
        },
        Resolution: "Check PVC status for each replica; a provisioning failure may be blocking pod scheduling.",
    },
    {
        Code:  "NODE_MOUNT_FAILURE",
        Level: models.RiskCritical,
        Applies: func(n models.TopologyNode, ctx RiskContext) bool {
            if n.Kind != "Node" { return false }
            extra := ctx.Graph.GetNodeExtra(n.ID)
            if extra == nil { return false }
            nm, _ := extra["nodeMount"].(*models.NodeMountDetail)
            return nm != nil && len(nm.MountFailures) > 0
        },
        Message: func(n models.TopologyNode, _ RiskContext) string {
            return fmt.Sprintf("Node %s has volume mount failures in recent events", n.Name)
        },
        Resolution: "Check kubelet logs: journalctl -u kubelet | grep 'MountVolume'. Verify NFS server and CSI driver health.",
    },
}
```

### 4.7 RCA Dependency Traversal API

New endpoint: `GET /clusters/:id/topology/rca?root=<nodeId>&depth=<n>`

Returns the minimal subgraph centred on the queried resource — every upstream and downstream dependency, labelled by traversal hop and risk level.

```go
// GetRCATopology returns a focused subgraph for root cause analysis.
// It traverses the full graph bidirectionally from the root node up to `depth` hops.
// Nodes outside the traversal are excluded; edges are annotated with hop distance.
func (s *topologyService) GetRCATopology(ctx context.Context, clusterID, nodeID string, depth int) (*models.TopologyGraph, error) {
    full, err := s.GetTopology(ctx, clusterID, models.TopologyFilters{}, 0, false)
    if err != nil { return nil, err }

    // BFS both directions from root
    visited := map[string]int{nodeID: 0} // nodeID → hop distance
    queue   := []string{nodeID}

    for len(queue) > 0 && depth > 0 {
        next := []string{}
        for _, id := range queue {
            hop := visited[id]
            if hop >= depth { continue }
            for _, edge := range full.Edges {
                var neighbor string
                if edge.Source == id      { neighbor = edge.Target }
                if edge.Target == id      { neighbor = edge.Source }
                if neighbor == ""         { continue }
                if _, seen := visited[neighbor]; !seen {
                    visited[neighbor] = hop + 1
                    next = append(next, neighbor)
                }
            }
        }
        queue = next
        depth--
    }

    // Build subgraph
    sub := &models.TopologyGraph{SchemaVersion: "1.0"}
    nodeSet := map[string]bool{}
    for _, n := range full.Nodes {
        if _, ok := visited[n.ID]; ok {
            sub.Nodes = append(sub.Nodes, n)
            nodeSet[n.ID] = true
        }
    }
    for _, e := range full.Edges {
        if nodeSet[e.Source] && nodeSet[e.Target] {
            e.RelationshipType = "rca_dependency"
            sub.Edges = append(sub.Edges, e)
        }
    }
    sub.Metadata = full.Metadata
    return sub, nil
}
```

---

## 5. Frontend Enhancements

### 5.1 New Node Kinds — Visual Registry

Extend `kubilitics-frontend/src/topology-engine/renderer/styles.ts` with new node types.

```typescript
// New kinds to add to the Cytoscape stylesheet
const NEW_KIND_STYLES: Record<string, CytoscapeNodeStyle> = {
  NFSServer: {
    shape: 'barrel',
    backgroundColor: '#1e3a5f',
    borderColor: '#3b82f6',
    icon: 'database',          // lucide-react Database icon rendered as SVG data URI
    label: 'NFS Server',
  },
  CSIDriver: {
    shape: 'round-rectangle',
    backgroundColor: '#1a2e1a',
    borderColor: '#22c55e',
    icon: 'plug',
    label: 'CSI Driver',
  },
  Region: {
    shape: 'round-rectangle',
    backgroundColor: 'transparent',
    borderColor: '#6366f1',
    borderStyle: 'dashed',
    fontSize: 16,
    isGroupNode: true,          // Rendered as a parent compound node
    label: 'Region',
  },
  Zone: {
    shape: 'round-rectangle',
    backgroundColor: 'transparent',
    borderColor: '#8b5cf6',
    borderStyle: 'dotted',
    isGroupNode: true,
    label: 'Zone',
  },
  StorageClass: {
    shape: 'hexagon',
    backgroundColor: '#1c1c2e',
    borderColor: '#7c3aed',
    icon: 'layers',
    label: 'StorageClass',
  },
};

// Risk color overrides (applied as Cytoscape classes)
const RISK_CLASSES = {
  critical: { borderColor: '#ef4444', borderWidth: 3, backgroundColor: '#3f1515' },
  warning:  { borderColor: '#f59e0b', borderWidth: 2, backgroundColor: '#3f2d0a' },
  info:     { borderColor: '#3b82f6', borderWidth: 1, backgroundColor: '#0f1f3f' },
};
```

### 5.2 New Overlay — Storage Intelligence Overlay

New file: `kubilitics-frontend/src/topology-engine/overlays/StorageOverlay.ts`

```typescript
// StorageOverlay — colors nodes by storage risk and annotates edges with backend type.
//
// Color mapping:
//   PVC Pending      → critical  (red)
//   PVC Bound        → healthy   (green)
//   PV Released      → warning   (yellow)
//   NFS Unreachable  → critical  (red)
//   NFS Reachable    → healthy   (green)
//   CSI Driver       → info      (blue)
//   StorageClass     → neutral   (purple)
//   RECLAIM_DELETE   → warning   (orange)

export function useStorageOverlay(graph: TopologyGraph): OverlayData {
  return useMemo(() => {
    const nodeValues = new Map<string, number>(); // 0=healthy, 0.5=warning, 1=critical
    const edgeValues = new Map<string, number>();
    const tooltips   = new Map<string, string>();

    graph.nodes.forEach(node => {
      const risk = (node as any).risk as string | undefined;
      const annotations: RiskAnnotation[] = (node as any).riskAnnotations ?? [];

      const value = risk === 'critical' ? 1 : risk === 'warning' ? 0.5 : 0;
      nodeValues.set(node.id, value);

      if (annotations.length > 0) {
        tooltips.set(node.id, annotations.map(a => `[${a.code}] ${a.description}`).join('\n'));
      }
    });

    // Highlight storage path edges
    graph.edges.forEach(edge => {
      if ((edge as any).isStoragePath) {
        edgeValues.set(edge.id, 0.8); // Prominent weight for storage path edges
      }
    });

    return {
      type: 'storage',
      nodeValues,
      edgeValues,
      colorScale: {
        0:   '#22c55e', // healthy
        0.5: '#f59e0b', // warning
        1:   '#ef4444', // critical
      },
      tooltips,
    };
  }, [graph]);
}
```

### 5.3 RCA Mode Panel

New file: `kubilitics-frontend/src/topology-engine/overlays/RCAPanel.tsx`

When RCA mode is active (toggled via toolbar), clicking any node:
1. Calls `GET /clusters/:id/topology/rca?root=<nodeId>&depth=5`
2. Replaces the full graph render with the focused RCA subgraph
3. Shows a side panel with the ordered dependency chain and risk annotations
4. Provides one-click "kubectl describe" equivalent text

```typescript
// RCAPanel renders the full dependency chain for a selected resource.
// Used in RCA mode (toolbar toggle).
//
// Props:
//   rootNodeId: string       — the resource being investigated
//   graph: TopologyGraph     — the full RCA subgraph (focused, already fetched)
//   onClose: () => void
//
// Renders:
//   1. Breadcrumb chain: Pod → PVC → PV → StorageClass → NFS Server → Node
//   2. Each step shows: status, risk annotations, provisioner, region/zone
//   3. Risk summary: count of critical/warning/info findings
//   4. "Copy as kubectl" button — generates describe commands for each resource
//   5. "Export RCA report" — PDF with full chain + risk annotations

interface RCAChainStep {
  nodeId:       string;
  kind:         string;
  name:         string;
  namespace:    string;
  status:       string;
  risk:         'critical' | 'warning' | 'info' | 'healthy';
  annotations:  RiskAnnotation[];
  hopDistance:  number; // 0 = root, 1 = direct dep, etc.
  direction:    'upstream' | 'downstream' | 'root';
}
```

### 5.4 Abstraction Level Extension (L4 — Storage)

Extend the existing `ABSTRACTION_LEVELS` in `topology.types.ts` with a new level dedicated to storage infrastructure.

```typescript
// Add L4 to ABSTRACTION_LEVELS
const ABSTRACTION_LEVELS = {
  // ...existing L0-L3...
  L4: {
    label: 'Storage & Infrastructure',
    description: 'Full storage chain: StatefulSet → PVC → PV → StorageClass → NFS/CSI/Cloud backend + Node mounts + Region grouping',
    hiddenKinds: new Set([
      // Hide workload noise — focus on infrastructure only
      'ReplicaSet', 'Endpoints', 'EndpointSlice',
      'ConfigMap', 'Secret',
      'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
      'HorizontalPodAutoscaler', 'LimitRange', 'ResourceQuota',
    ]),
    // L4-specific layout: hierarchical left-to-right (infrastructure flows left → right)
    preferredLayout: 'dagre-LR',
  },
};
```

### 5.5 Node Detail Drawer — Storage Section

Extend the existing node detail drawer (wherever `selectedNodeId` is handled) with a storage-specific section that renders only for storage kinds.

```typescript
// StorageChainDetail — rendered inside node detail drawer for PVC, PV, StorageClass, NFSServer
//
// Shows:
//   PVC view:
//     Status badge (Bound/Pending/Lost)
//     → Bound PV name (clickable → focus PV)
//     → StorageClass (clickable)
//     → Backend type (NFS / EBS / Azure Disk / GCE PD / Local)
//     → NFS server + path (if NFS)
//     → CSI volume ID (if CSI)
//     → Consuming pods (list, clickable)
//     → Node mount location
//     → ReclaimPolicy warning badge
//     → Storage size
//     → Access modes
//
//   PV view:
//     Status badge (Bound/Available/Released/Failed)
//     → Bound to PVC (clickable)
//     → StorageClass
//     → Reclaim policy (with warning if Delete in prod)
//     → Backend detail (NFS path, EBS volume ID, etc.)
//     → Node where mounted
//
//   NFSServer view:
//     Reachability status (Live/Unreachable) with latency badge
//     → All PVs backed by this server (list)
//     → All nodes that mount from this server
//     → Path breakdown (each PV's path)
//
//   Node view (storage section):
//     Mounted PV count
//     NFS endpoints connected
//     Mount failures (if any) — highlighted red
```

### 5.6 StorageClass → Provisioner Topology (Virtual Nodes)

The canvas must render virtual nodes for provisioner types that are not Kubernetes resources but are logical infrastructure actors.

```typescript
// Virtual node kinds rendered in the topology (not fetched from K8s API directly):
//   NFSServer      — inferred from PV.spec.nfs.server
//   CSIDriver      — inferred from PV.spec.csi.driver (same as CSIDriver K8s resource if CRD exists)
//   Region         — inferred from node topology labels
//   Zone           — inferred from node topology labels
//
// These are distinguished from real K8s resources by:
//   node.apiVersion === 'virtual/v1'
//   node.kind in ['NFSServer', 'CSIDriver', 'Region', 'Zone']
//
// They render with a dashed border and a "virtual" badge in the detail drawer.
// Clicking them shows aggregated info (all PVs backed by this NFS server, etc.)
```

---

## 6. Storage Topology View — Scenario Walkthroughs

These scenarios demonstrate the value of the enhancements in concrete production situations.

### 6.1 Scenario: PVC Pending — Dynamic NFS Provisioning Failure

**What the engineer sees today (without Kubilitics):**
```
kubectl get pvc -n production
# NAME           STATUS    VOLUME   CAPACITY   ...
# data-0         Pending   ...

kubectl describe pvc data-0 -n production
# Events: ProvisioningFailed: nfs: failed to dial NFS server 10.0.1.50:2049

kubectl get storageclass nfs-client
# Provisioner: nfs.csi.k8s.io

kubectl get pods -n kube-system | grep nfs
# ... hunt for provisioner pod
```
5+ commands, 3+ minutes.

**What they see in Kubilitics (with L4 + RCA mode):**

```
StatefulSet/cassandra
  └── PVC data-0  ■ CRITICAL: PVC_PENDING
        └── StorageClass/nfs-client
              └── NFSServer/10.0.1.50  ■ CRITICAL: NFS_UNREACHABLE (latency timeout)
```

Click PVC data-0 → RCA panel opens showing:
- Hop 0: PVC data-0 — Pending — 0 bound PVs
- Hop 1: StorageClass nfs-client — provisioner nfs.csi.k8s.io
- Hop 2: NFSServer 10.0.1.50 — Unreachable — TCP/2049 timeout 3001ms
- Risk summary: 2 critical findings
- Resolution: "NFS server 10.0.1.50 is unreachable from cluster nodes. Check firewall rules on port 2049 and NFS server health."
- Copy kubectl: `kubectl describe pvc data-0 -n production && kubectl describe sc nfs-client`

**Time to insight: 0 kubectl commands. 10 seconds.**

---

### 6.2 Scenario: StatefulSet Storage Misbinding

**Symptom:** cassandra-1 is scheduled on node-3, but its PVC data-cassandra-1 was originally bound to a PV on node-1 (local storage).

**Topology renders:**
```
StatefulSet/cassandra
  ├── PVC data-cassandra-0 → PV pvc-abc → Node/node-1 (local)  ✓ healthy
  ├── PVC data-cassandra-1 → PV pvc-def → Node/node-1 (local)  ■ WARN: pod on node-3
  └── PVC data-cassandra-2 → PV pvc-ghi → Node/node-2 (local)  ✓ healthy
```

Risk annotation on cassandra-1: `POD_PVC_NODE_MISMATCH — Pod is scheduled on node-3 but PVC is bound to a PV local to node-1. Pod will fail to mount.`

---

### 6.3 Scenario: Multi-Region Storage Confusion (EKS)

**Topology renders at Region level:**
```
Region/us-east-1
  ├── Zone/us-east-1a
  │     ├── Node/ip-10-0-1-5
  │     │     └── PV/pvc-abc (EBS gp3, 100 GiB)
  │     └── Pod/api-server-0 → PVC/data-0 ✓
  └── Zone/us-east-1b
        ├── Node/ip-10-0-2-9
        └── Pod/api-server-1 → PVC/data-1 → PV (us-east-1a)  ■ WARN: cross-AZ PV binding
```

Risk: `CROSS_AZ_PV_BINDING — Pod api-server-1 is in us-east-1b but its EBS PV pvc-xyz is in us-east-1a. EBS volumes are not cross-AZ portable. Pod will fail to mount on node restart.`

---

### 6.4 Scenario: Node-Level Mount Failure

**Topology:** Node/worker-7 has a red border (RiskCritical).

Hovering shows: "1 mount failure: MountVolume.SetUp failed for volume 'pvc-123' : mount failed: exit status 32"

Click Node/worker-7 → Storage section of detail drawer:
- Mounted PVs: [pvc-123 (NFS, FAILED), pvc-456 (EBS, OK)]
- NFS endpoints: 10.0.1.50
- Mount failures: 1

Click pvc-123 → focus shifts to PVC → NFS server node shows red → hover shows latency 0ms (timeout).

---

## 7. API Specification Extensions

### 7.1 Enhanced Topology Endpoint

`GET /clusters/:id/topology`

Existing endpoint. Add new query parameters:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `storage_depth` | int | `1` | `1` = PVC→PV→SC only, `2` = include NFS/CSI nodes, `3` = include Region/Zone grouping |
| `rca_mode` | bool | `false` | When true, returns a focused subgraph (requires `rca_root`) |
| `rca_root` | string | — | Node ID for RCA subgraph root |
| `rca_depth` | int | `5` | Max hop depth for RCA traversal |
| `include_virtual_nodes` | bool | `true` | Include NFSServer, CSIDriver, Region, Zone virtual nodes |

### 7.2 New: Topology Patch WebSocket

`WS /clusters/:id/topology/stream`

Streams partial graph patches after the initial HTTP graph is delivered.

```json
// Patch message format
{
  "type": "topology_patch",
  "operation": "update_node",
  "nodeId": "nfs-server-10-0-1-50",
  "patch": {
    "status": "Unreachable",
    "risk": "critical",
    "riskAnnotations": [{
      "code": "NFS_UNREACHABLE",
      "description": "NFS server 10.0.1.50 is unreachable on TCP/2049",
      "level": "critical",
      "resolution": "Check NFS server health and firewall rules."
    }],
    "storageDetail": {
      "backendType": "nfs",
      "nfs": {
        "server": "10.0.1.50",
        "path": "/exports/k8s",
        "reachable": false,
        "latencyMs": 3001
      }
    }
  }
}
```

### 7.3 New: RCA Report Export

`POST /clusters/:id/topology/rca/export`

```json
// Request
{
  "rootNodeId": "pvc-production-data-0",
  "depth": 5,
  "format": "pdf"   // pdf | json | markdown
}

// Response: PDF or JSON report with:
//   - Resource inventory (all nodes in RCA subgraph)
//   - Risk findings ranked by severity
//   - Dependency chain diagram (SVG embedded in PDF)
//   - Recommended kubectl commands for each finding
//   - Cluster flavor and version metadata
```

---

## 8. Implementation Phases

### Phase 1 — Core Storage Chain (2 weeks)

| Task | File | Priority |
|---|---|---|
| Extend `TopologyNode` model with `StorageDetail`, `RiskAnnotation`, `RiskLevel` | `models/topology.go` | P0 |
| Implement `inferDeepStorageChain` | `topology/relationships.go` | P0 |
| Implement `inferStatefulSetStorage` | `topology/relationships.go` | P0 |
| Implement `RiskClassificationEngine` with built-in rules | `topology/risk.go` | P0 |
| Register new inference steps in `InferAllRelationships` | `topology/relationships.go` | P0 |
| Add `NFSServer`, `CSIDriver`, `StorageClass` to Cytoscape stylesheet | `topology-engine/renderer/styles.ts` | P0 |
| Add `StorageOverlay` | `topology-engine/overlays/StorageOverlay.ts` | P0 |
| Add L4 abstraction level | `topology-engine/types/topology.types.ts` | P0 |
| Extend `KubernetesKind` with new virtual kinds | `topology-engine/types/topology.types.ts` | P0 |
| Add storage section to node detail drawer | existing detail component | P0 |

### Phase 2 — Node Mounts + Region (1 week)

| Task | File | Priority |
|---|---|---|
| Implement `inferNodeMounts` | `topology/relationships.go` | P1 |
| Implement `inferRegionTopology` | `topology/relationships.go` | P1 |
| Add `Region`, `Zone` compound node rendering | `topology-engine/renderer/styles.ts` | P1 |
| Cluster flavor detection | `topology/relationships.go` | P1 |
| Add `resides_in`, `mounted_on`, `nfs_client_of` relationship types | `topology-engine/types/topology.types.ts` | P1 |
| Node detail drawer — storage section (mount failures, NFS endpoints) | existing detail component | P1 |

### Phase 3 — RCA Mode (1 week)

| Task | File | Priority |
|---|---|---|
| Implement `GetRCATopology` service method | `service/topology_service.go` | P1 |
| Add `GET /topology/rca` endpoint | API handler | P1 |
| Implement `RCAPanel` component | `topology-engine/overlays/RCAPanel.tsx` | P1 |
| RCA toolbar toggle in `TopologyViewer` | `topology-engine/TopologyViewer.tsx` | P1 |
| "Copy kubectl" command generator | `RCAPanel.tsx` | P1 |
| RCA PDF export endpoint | `service/topology_service.go` | P2 |

### Phase 4 — Async NFS Probing + WebSocket Patches (1 week)

| Task | File | Priority |
|---|---|---|
| `NFSProbeResult` type and `ProbeNFSServers` func | `topology/nfs_probe.go` | P1 |
| WebSocket patch handler integration | WS handler | P1 |
| Frontend WebSocket patch consumer — apply `update_node` patches to live graph | `topology-engine` hooks | P1 |
| Throttle NFS probes for large clusters (>100 NFS servers) | `topology/nfs_probe.go` | P2 |

### Phase 5 — Enterprise Hardening (ongoing)

| Task | Details |
|---|---|
| Longhorn CRD enrichment | Parse `longhorn.io/v1beta2` Volume/Replica CRDs and add as first-class nodes |
| Rook-Ceph enrichment | Parse `ceph.rook.io` CephBlockPool/CephFilesystem CRDs |
| EFS access point nodes | AWS EFS: render AccessPoint as child of EFS FileSystem virtual node |
| Azure File Share nodes | Azure File: render FileShare as child of StorageAccount virtual node |
| GCE PD topology | Show zone affinity constraint warnings for GCE PD across AZ |
| Cross-namespace PVC detection | Flag PVCs accessed cross-namespace via StorageClass `volumeBindingMode` |
| Storage capacity planning overlay | Overlay showing % used per PV (via metrics-server or VolumeSnapshot) |
| Historical PVC binding changes | Track PVC spec.volumeName changes over time via snapshot diffing |

---

## 9. Non-Goals (Out of Scope for this Enhancement)

- Workload mapping improvements (Deployment heat maps, service mesh traffic) — covered by existing overlays
- CRD-level custom resource topology (separate feature: Custom Resource Mapper)
- Automatic remediation actions (separate feature: AutoHeal)
- Cost allocation per PV/PVC (covered by existing CostOverlay)
- Real-time I/O metrics per PV (separate feature: Storage Performance)

---

## 10. Success Metrics

| Metric | Target |
|---|---|
| Time to diagnose PVC-Pending from Kubilitics UI | < 30 seconds (vs 5+ minutes with kubectl) |
| Storage chain completeness | PVC → PV → StorageClass → Provisioner → Backend visible for 100% of PVCs |
| NFS unreachability detection rate | 100% of unreachable NFS servers flagged within 10s of graph load |
| StatefulSet PVC mapping accuracy | All volumeClaimTemplate PVCs mapped for replicas 0..N |
| Risk false-positive rate | < 5% (validated against production cluster known-good state) |
| Graph build time with storage chain at depth 2 | < 1.5s for clusters with < 500 PVCs |
| NFS probe latency (200 endpoints) | < 10s (20-goroutine concurrency) |
| Cross-cluster support | Validated on: kind, minikube, k3s, EKS, AKS, GKE, bare-metal kubeadm |

---

## 11. Dependency Map to Existing Code

| Enhancement | Depends on existing code |
|---|---|
| `inferDeepStorageChain` | `inferStorageRelationships` (supersedes), `graph.AddNode`, `graph.AddEdge`, `graph.SetNodeExtra` |
| `inferStatefulSetStorage` | `graph.GetNodesByType("StatefulSet")`, K8s `AppsV1().StatefulSets()` |
| `inferNodeMounts` | `inferNodeRelationships` (runs after), `graph.GetNodesByType("Node")`, K8s Events API |
| `inferRegionTopology` | `graph.GetNodesByType("Node")`, K8s Nodes API, `graph.AddNode` (idempotent) |
| `RiskClassificationEngine` | `graph.GetNodeExtra`, `graph.SetNodeExtra` |
| `GetRCATopology` | `TopologyService.GetTopology`, `graph.Edges` bidirectional BFS |
| `StorageOverlay` | Existing `OverlayData` interface, `useStorageOverlay` pattern from `HealthOverlay` |
| L4 abstraction level | Existing `ABSTRACTION_LEVELS` map in `topology.types.ts` |
| `RCAPanel` | Existing `selectedNodeId` state, `TopologyViewer` props, existing `BlastRadiusResult` pattern |
| NFS probes | New `nfs_probe.go`, existing WebSocket handler |

---

*This document is the authoritative specification for the Kubilitics Relationship Intelligence Engine (KRIE) v2.0. All implementation must reference the section numbers above in commit messages for traceability.*
