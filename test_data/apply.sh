#!/usr/bin/env bash
# ============================================================================
# Kubilitics Demo Data — Full Cluster Population Script
# Applies ALL resource categories for a complete investor-demo-grade cluster.
# Idempotent: safe to run multiple times (kubectl apply -f).
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

section() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
ok()      { echo -e "${GREEN}  ✓ $1${NC}"; }
skip()    { echo -e "${YELLOW}  ⊘ $1 (skipped)${NC}"; }

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          KUBILITICS DEMO DATA — FULL CLUSTER SETUP          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Namespaces ──────────────────────────────────────────────────
section "Namespaces (5)"
kubectl apply -f namespace.yaml
ok "5 namespaces created/updated"

# ── 2. Workloads ───────────────────────────────────────────────────
section "Workloads"
kubectl apply -f workloads/deployments.yaml   && ok "10 Deployments"
kubectl apply -f workloads/bluegreen.yaml     && ok "2 Blue/Green demo Deployments + HPA + PDB"
kubectl apply -f workloads/statefulsets.yaml   && ok "5 StatefulSets + headless Services"
kubectl apply -f workloads/daemonsets.yaml     && ok "3 DaemonSets"
kubectl apply -f workloads/jobs.yaml           && ok "8 Jobs"
kubectl apply -f workloads/cronjobs.yaml       && ok "6 CronJobs"

# ── 3. Storage & Config ───────────────────────────────────────────
section "Storage & Configuration"
kubectl apply -f storage/configmaps.yaml       && ok "6 ConfigMaps"
kubectl apply -f storage/secrets.yaml          && ok "5 Secrets"
kubectl apply -f storage/storage.yaml          && ok "3 StorageClasses + 4 PVs + 5 PVCs"

# ── 4. Networking ──────────────────────────────────────────────────
section "Networking"
kubectl apply -f networking/services.yaml        && ok "10 Services"
kubectl apply -f networking/ingressclasses.yaml  && ok "3 IngressClasses"
kubectl apply -f networking/ingresses.yaml       && ok "6 Ingresses"
kubectl apply -f networking/bluegreen.yaml       && ok "Blue/Green demo Services + Ingress"
kubectl apply -f networking/networkpolicies.yaml && ok "5 NetworkPolicies"

# ── 5. RBAC ────────────────────────────────────────────────────────
section "RBAC"
kubectl apply -f rbac/rbac.yaml && ok "6 ServiceAccounts + 4 Roles + 4 RoleBindings + 2 ClusterRoles + 2 ClusterRoleBindings"

# ── 6. Scaling & Resource Management ──────────────────────────────
section "Scaling & Resource Management"
kubectl apply -f scaling/scaling.yaml && ok "4 HPAs + 4 PDBs + 4 ResourceQuotas + 3 LimitRanges"

# ── 7. CRDs & Custom Resources ────────────────────────────────────
section "CRDs & Custom Resources"
kubectl apply -f crd/crd-definitions.yaml   && ok "3 CRDs"
kubectl apply -f crd/custom-resources.yaml  && ok "9 Custom Resources"

# ── 8. Admission Webhooks ─────────────────────────────────────────
section "Admission Webhooks"
kubectl apply -f webhooks/mutating-webhooks.yaml   && ok "3 MutatingWebhookConfigurations"
kubectl apply -f webhooks/validating-webhooks.yaml && ok "3 ValidatingWebhookConfigurations"

# ── 9. Runtime & Snapshots ────────────────────────────────────────
section "Runtime & Snapshots"
kubectl apply -f runtime/runtime.yaml                              && ok "3 RuntimeClasses"
kubectl apply -f snapshots/volume-snapshot-classes.yaml            && ok "3 VolumeSnapshotClasses"
kubectl apply -f snapshots/volume-snapshots.yaml                   && ok "4 VolumeSnapshots"
kubectl apply -f snapshots/volume-snapshot-contents.yaml           && ok "3 VolumeSnapshotContents"

# ── 10. Attachments & Misc ────────────────────────────────────────
section "Attachments & Misc"
kubectl apply -f attachments/volume-attachments.yaml               && ok "3 VolumeAttachments"
kubectl apply -f misc/misc-resources.yaml                          && ok "3 PriorityClasses + 3 Leases + 3 PodTemplates"

# ── Summary ────────────────────────────────────────────────────────
echo -e "\n${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    ✓ ALL RESOURCES APPLIED                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Namespaces ............ 5                                  ║"
echo "║  Deployments ........... 10     Services ........... 10     ║"
echo "║  StatefulSets .......... 5      Ingresses .......... 6      ║"
echo "║  DaemonSets ............ 3      IngressClasses ..... 3      ║"
echo "║  Jobs .................. 8      NetworkPolicies .... 5      ║"
echo "║  CronJobs .............. 6      ConfigMaps ......... 6      ║"
echo "║  Secrets ............... 5      StorageClasses ..... 3      ║"
echo "║  PVs ................... 4      PVCs ............... 5      ║"
echo "║  ServiceAccounts ....... 6      HPAs ............... 4      ║"
echo "║  Roles ................. 4      PDBs ............... 4      ║"
echo "║  RoleBindings .......... 4      ResourceQuotas ..... 4      ║"
echo "║  ClusterRoles .......... 2      LimitRanges ........ 3      ║"
echo "║  ClusterRoleBindings ... 2      CRDs ............... 3      ║"
echo "║  CR Instances .......... 9      MutatingHooks ...... 3      ║"
echo "║  ValidatingHooks ....... 3      RuntimeClasses ..... 3      ║"
echo "║  VolSnapClasses ........ 3      VolSnapshots ....... 4      ║"
echo "║  VolSnapContents ....... 3      VolAttachments ..... 3      ║"
echo "║  PriorityClasses ....... 3      Leases ............. 3      ║"
echo "║  PodTemplates .......... 3                                  ║"
echo "║────────────────────────────────────────────────────────────  ║"
echo "║  TOTAL: ~120+ Kubernetes resources across 5 namespaces      ║"
echo "║  Pods will be ~40-50 (created by Deployments/StatefulSets)  ║"
echo "║  ReplicaSets auto-created by Deployments (~10)              ║"
echo "║  Endpoints/EndpointSlices auto-created by Services (~15)    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
