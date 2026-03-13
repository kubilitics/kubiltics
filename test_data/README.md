# Kubilitics Demo Data

Full-cluster population scripts that create **120+ Kubernetes resources** across **5 namespaces** to showcase every feature in Kubilitics. Designed for investor demos, contributor onboarding, and development testing.

## Quick Start

```bash
cd test_data && ./apply.sh
```

## Namespaces

| Namespace | Team | Purpose |
|-----------|------|---------|
| `kubilitics-demo` | Platform | Core platform services (gateway, API, auth, notifications) |
| `ecommerce-prod` | Ecommerce | Full e-commerce stack (catalog, cart, checkout) |
| `analytics-staging` | Data | Analytics pipeline (Kafka, collectors, dashboard) |
| `ml-pipeline` | ML Engineering | Model training and serving |
| `payments-prod` | Fintech | Payment processing (PCI-isolated) |

## Resource Inventory

| Category | Resource | Count | Files |
|----------|----------|-------|-------|
| **Workloads** | Deployments | 10 | `workloads/deployments.yaml` |
| | StatefulSets | 5 | `workloads/statefulsets.yaml` |
| | DaemonSets | 3 | `workloads/daemonsets.yaml` |
| | Jobs | 8 | `workloads/jobs.yaml` |
| | CronJobs | 6 | `workloads/cronjobs.yaml` |
| | *Pods (auto)* | *~40-50* | *Created by controllers* |
| | *ReplicaSets (auto)* | *~10* | *Created by Deployments* |
| **Networking** | Services | 10 (+5 headless) | `networking/services.yaml` |
| | Ingresses | 6 | `networking/ingresses.yaml` |
| | IngressClasses | 3 | `networking/ingressclasses.yaml` |
| | NetworkPolicies | 5 | `networking/networkpolicies.yaml` |
| | *Endpoints (auto)* | *~15* | *Created by Services* |
| | *EndpointSlices (auto)* | *~15* | *Created by Services* |
| **Storage** | ConfigMaps | 6 | `storage/configmaps.yaml` |
| | Secrets | 5 | `storage/secrets.yaml` |
| | StorageClasses | 3 | `storage/storage.yaml` |
| | PersistentVolumes | 4 | `storage/storage.yaml` |
| | PersistentVolumeClaims | 5 | `storage/storage.yaml` |
| **RBAC** | ServiceAccounts | 6 | `rbac/rbac.yaml` |
| | Roles | 4 | `rbac/rbac.yaml` |
| | RoleBindings | 4 | `rbac/rbac.yaml` |
| | ClusterRoles | 2 | `rbac/rbac.yaml` |
| | ClusterRoleBindings | 2 | `rbac/rbac.yaml` |
| **Scaling** | HPAs | 4 | `scaling/scaling.yaml` |
| | PodDisruptionBudgets | 4 | `scaling/scaling.yaml` |
| | ResourceQuotas | 4 | `scaling/scaling.yaml` |
| | LimitRanges | 3 | `scaling/scaling.yaml` |
| **CRDs & CRs** | CustomResourceDefinitions | 3 | `crd/crd-definitions.yaml` |
| | Custom Resources | 9 | `crd/custom-resources.yaml` |
| **Admission** | MutatingWebhookConfigurations | 3 | `webhooks/mutating-webhooks.yaml` |
| | ValidatingWebhookConfigurations | 3 | `webhooks/validating-webhooks.yaml` |
| **Runtime** | RuntimeClasses | 3 | `runtime/runtime.yaml` |
| **Snapshots** | VolumeSnapshotClasses | 3 | `snapshots/volume-snapshot-classes.yaml` |
| | VolumeSnapshots | 4 | `snapshots/volume-snapshots.yaml` |
| | VolumeSnapshotContents | 3 | `snapshots/volume-snapshot-contents.yaml` |
| **Attachments & Misc** | VolumeAttachments | 3 | `attachments/volume-attachments.yaml` |
| | PriorityClasses | 3 | `misc/misc-resources.yaml` |
| | Leases | 3 | `misc/misc-resources.yaml` |
| | PodTemplates | 3 | `misc/misc-resources.yaml` |
| **Total** | | **~150+ explicit + ~80 auto-created** | |

## Layout

```
test_data/
  README.md
  namespace.yaml          # 5 namespaces
  apply.sh                # One-command full setup
  workloads/
    deployments.yaml      # 10 deployments
    statefulsets.yaml      # 5 statefulsets + headless services
    daemonsets.yaml        # 3 daemonsets
    jobs.yaml             # 8 jobs
    cronjobs.yaml         # 6 cronjobs
  networking/
    services.yaml         # 10 services
    ingressclasses.yaml   # 3 ingress classes
    ingresses.yaml        # 6 ingresses
    networkpolicies.yaml  # 5 network policies
  storage/
    configmaps.yaml       # 6 configmaps
    secrets.yaml          # 5 secrets
    storage.yaml          # 3 StorageClasses + 4 PVs + 5 PVCs
  rbac/
    rbac.yaml             # 6 SAs + 4 Roles + 4 RBs + 2 CRs + 2 CRBs
  scaling/
    scaling.yaml          # 4 HPAs + 4 PDBs + 4 RQs + 3 LRs
  crd/
    crd-definitions.yaml  # 3 CRDs
    custom-resources.yaml # 9 custom resources (3 per CRD)
  webhooks/
    mutating-webhooks.yaml   # 3 MutatingWebhookConfigurations
    validating-webhooks.yaml # 3 ValidatingWebhookConfigurations
  runtime/
    runtime.yaml          # 3 RuntimeClasses
  snapshots/
    volume-snapshot-classes.yaml  # 3 VolumeSnapshotClasses
    volume-snapshots.yaml         # 4 VolumeSnapshots
    volume-snapshot-contents.yaml # 3 VolumeSnapshotContents
  attachments/
    volume-attachments.yaml       # 3 VolumeAttachments
  misc/
    misc-resources.yaml    # 3 PriorityClasses + 3 Leases + 3 PodTemplates
```

## Cleanup

```bash
kubectl delete namespace kubilitics-demo ecommerce-prod analytics-staging ml-pipeline payments-prod
kubectl delete ingressclass nginx-external nginx-internal traefik-mesh
kubectl delete storageclasses fast-ssd standard-hdd replicated-nvme
kubectl delete pv pv-postgres-data-01 pv-redis-data-01 pv-logs-archive-01 pv-ml-models-01
kubectl delete clusterrole kubilitics-demo-cluster-viewer kubilitics-demo-namespace-admin
kubectl delete clusterrolebinding kubilitics-demo-viewer-binding kubilitics-demo-admin-binding
```
