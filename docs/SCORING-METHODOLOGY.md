# Kubilitics Scoring Methodology

**How We Score Kubernetes Cluster Resilience: A Transparent Methodology**

---

## 1. Introduction

Kubilitics provides two complementary scoring systems for Kubernetes operational intelligence:

1. **Structural Health Score** (0-100) — measures how resilient a namespace or cluster is against failures
2. **Blast Radius Score** (0-100) — measures the operational impact of a specific resource failure

Both scores are deterministic, reproducible, and grounded in established SRE principles. This document explains every weight, every formula, and every design decision.

There is no industry standard for Kubernetes resilience scoring. No CNCF specification, no academic benchmark, and no vendor publishes their methodology. We publish ours because transparency builds trust, invites community validation, and makes the scores defensible.

---

## 2. Structural Health Score

### 2.1 Purpose

The health score answers: **"How structurally resilient is this namespace/cluster against failures right now?"**

A score of 100 means every workload has redundancy, disruption protection, autoscaling, and minimal dependency complexity. A score below 25 means critical structural weaknesses exist.

### 2.2 Components and Weights

| Component | Weight | Formula | Range |
|-----------|--------|---------|-------|
| SPOF Density | 25% | `1 - (spofCount / totalWorkloads)` | 0-1 |
| PDB Coverage | 20% | `workloadsWithPDB / totalWorkloads` | 0-1 |
| Redundancy Ratio | 20% | `avg(replicas / max(specReplicas, 2))` capped at 1.0 | 0-1 |
| HPA Coverage | 15% | `workloadsWithHPA / scalableWorkloads` | 0-1 |
| Dependency Depth | 10% | `1 - (maxBFSDepth / 10)` capped at 0-1 | 0-1 |
| Cross-NS Risk | 10% | `1 - (crossNSDeps / totalDeps)` | 0-1 |

**Final Score** = `(sum of component × weight) × 100`

### 2.3 Weight Justification

**SPOF Density (25%)** — Highest weight. Single points of failure are the #1 cause of Kubernetes outages. A SPOF is defined as: `replicas <= 1 AND no HPA AND has downstream dependents`. This aligns with Google SRE Book Chapter 8 (Release Engineering) which emphasizes redundancy as the primary reliability mechanism, and CIS Kubernetes Benchmark control 5.7.3 (no single points of failure).

**PDB Coverage (20%)** — PodDisruptionBudgets are the Kubernetes-native mechanism for protecting workloads during voluntary disruptions (node drains, cluster upgrades, spot instance evictions). Without PDBs, a routine node drain can take down all replicas simultaneously. CIS Kubernetes Benchmark control 5.2.1 requires PDB configuration for multi-replica workloads. Weight reflects that PDBs prevent a class of outages that redundancy alone cannot.

**Redundancy Ratio (20%)** — Direct measure of fault tolerance. A Deployment with 1 replica has zero tolerance for failure. With 3 replicas, one pod crash leaves 67% capacity. The formula `replicas / max(specReplicas, 2)` uses 2 as the minimum safe replica count, meaning a single-replica workload scores 0.5 (50% of minimum safe state). This follows the principle from Google SRE Book Chapter 3 (Embracing Risk): redundancy is the fundamental mechanism for availability.

**HPA Coverage (15%)** — Horizontal Pod Autoscalers enable automatic recovery from load spikes and partial failures. Without HPA, a traffic surge during a pod crash (N-1 replicas serving N-replica load) can cascade into a full outage. Lower weight than PDB because HPA addresses a narrower failure mode (load-induced). Recommended by Kubernetes best practices documentation.

**Dependency Depth (10%)** — Longer dependency chains mean more failure propagation paths. A service at depth 5 (depends on 4 layers of intermediate services) is harder to reason about and more likely to experience cascading failures. Measured via BFS from the dependency graph, capped at depth 10. Lower weight because deep dependencies are a complexity indicator, not a direct vulnerability.

**Cross-Namespace Risk (10%)** — Cross-namespace dependencies are harder to reason about, harder to test, and harder to isolate during incidents. A namespace with 80% of its dependencies crossing namespace boundaries has higher operational risk than one with all dependencies local. Lower weight because cross-namespace dependencies are not inherently dangerous — they're an operational complexity multiplier.

### 2.4 Aggregation

- **Per-namespace score**: Weighted sum of all 6 components × 100
- **Per-cluster score**: Weighted average of namespace scores, weighted by workload count (namespaces with more workloads contribute more to the cluster score)
- **Per-fleet score**: Weighted average of cluster scores

### 2.5 Level Thresholds

| Level | Score Range | Meaning |
|-------|------------|---------|
| Healthy | 80-100 | Strong structural resilience. Minor improvements possible. |
| Warning | 50-79 | Moderate gaps. Some workloads lack redundancy or protection. |
| Degraded | 25-49 | Significant weaknesses. Multiple SPOFs or missing protections. |
| Critical | 0-24 | Severe structural risk. Immediate remediation required. |

---

## 3. Blast Radius Score

### 3.1 Purpose

The blast radius score answers: **"If this specific resource fails, how much operational impact will it cause?"**

### 3.2 Base Score Calculation (0-100)

| Factor | Max Points | Formula | Justification |
|--------|-----------|---------|---------------|
| PageRank Centrality | 30 | `min(pageRank × 30, 30)` | Graph centrality measures structural importance — resources depended on by many others are more impactful when they fail. PageRank (damping 0.85, 50 iterations) is the industry-standard algorithm for this, originally developed by Google and widely used in network analysis. |
| Fan-in (Dependents) | 20 | `min(fanIn × 3, 20)` | Direct dependent count. A ConfigMap mounted by 7 workloads affects 7 workloads when deleted. Simple, interpretable, operationally meaningful. |
| Cross-Namespace Impact | 10 | `min(crossNS × 2.5, 10)` if > 1 NS | Failures crossing namespace boundaries are harder to contain and often involve different teams. The multiplier activates only when 2+ namespaces are affected. |
| Data Store Bonus | 15 | Flat if StatefulSet or PVC owner | Data stores (databases, caches, message queues) are harder to recover than stateless workloads. A failed StatefulSet may require data recovery procedures. The 15-point bonus reflects the recovery complexity, not just the dependency impact. |
| Ingress Exposure | 10 | Flat if routed through Ingress | User-facing services have higher business impact. A backend service crash may be invisible to users; an Ingress-routed service crash causes user-visible errors immediately. |
| SPOF Status | 10 | Flat if `replicas ≤ 1 AND !HPA AND fanIn > 0` | A single-replica workload with dependents has maximum vulnerability. No redundancy means the failure IS the outage, not just a degradation. |
| No HPA Penalty | 5 | Flat if missing HPA | Without autoscaling, the system cannot self-heal from load-induced cascading failures. Minor factor because HPA helps with recovery, not prevention. |
| No PDB Penalty | 5 | Flat if missing PDB | Without a PodDisruptionBudget, voluntary disruptions (node drain, upgrade) can cause simultaneous failure of all replicas. Minor factor because PDB protects against voluntary disruptions only. |

**Base Score** = sum of all applicable factors, capped at 100.

### 3.3 Failure Mode Attenuation

The same resource has different impact depending on HOW it fails:

| Failure Mode | Attenuation | Rationale |
|-------------|-------------|-----------|
| Pod Crash | `baseScore × (1 / replicas)` | A single pod crash in a 3-replica Deployment leaves 67% capacity. Impact scales inversely with redundancy. |
| Workload Deletion | `baseScore × 1.0` | Entire Deployment/StatefulSet removed. Full impact regardless of replica count. |
| Namespace Deletion | `sum(workload-deletion scores)` capped at 100 | Catastrophic event. All workloads in namespace affected. |

**Example**: A Deployment with `baseScore = 46` and 3 replicas:
- Pod crash: `46 × (1/3) = 15.3` → **LOW** (correct — 2 surviving replicas handle the load)
- Workload deletion: `46 × 1.0 = 46` → **HIGH** (correct — entire workload removed)

### 3.4 Level Thresholds

| Level | Score Range | Operational Meaning |
|-------|------------|---------------------|
| LOW | 0-19 | Minimal impact. Self-healing or redundancy absorbs the failure. |
| MEDIUM | 20-44 | Moderate impact. Some dependent services may degrade. |
| HIGH | 45-69 | Significant impact. Multiple services affected, manual intervention likely needed. |
| CRITICAL | 70-100 | Severe impact. Wide blast radius, potential user-facing outage, immediate response required. |

### 3.5 Blast Percentage

`blastPercent = affectedResources / reachableSubgraphSize × 100`

The denominator uses the **reachable subgraph** (resources connected to the target via dependency edges), not total cluster workloads. This answers "what percentage of RELATED resources are impacted" — a more meaningful metric than "what percentage of the entire cluster."

---

## 4. Compliance Mapping

Kubilitics maps structural findings to compliance frameworks:

### CIS Kubernetes Benchmark v1.8

| Control | Title | Kubilitics Check |
|---------|-------|-----------------|
| CIS-5.1.1 | Resource quotas configured | Namespace has ResourceQuota |
| CIS-5.2.1 | PDB configured | Multi-replica workloads have PDB |
| CIS-5.2.5 | No privileged containers | No pods run privileged |
| CIS-5.3.2 | NetworkPolicy configured | Namespace has NetworkPolicy |
| CIS-5.4.1 | Resource limits set | All containers have CPU/memory limits |
| CIS-5.7.1 | Replica count meets availability | Production workloads have ≥ 2 replicas |
| CIS-5.7.2 | HPA configured | Scalable workloads have HPA |
| CIS-5.7.3 | No single points of failure | No SPOF detected |

### SOC2 Type II

| Control | Title | Mapping |
|---------|-------|---------|
| SOC2-CC7.2 | System availability | Maps to CIS-5.7.1 (replica count) |
| SOC2-A1.2 | Recovery mechanisms | Maps to CIS-5.2.1 (PDB coverage) |

---

## 5. References

1. **Google SRE Book** — Chapter 3: Embracing Risk (redundancy as availability mechanism), Chapter 8: Release Engineering (blast radius containment). Available at sre.google/sre-book/.
2. **CIS Kubernetes Benchmark v1.8** — Center for Internet Security. Controls 5.1-5.7 (policies, pod security, network, resource management).
3. **PageRank Algorithm** — Brin, S. and Page, L. (1998). "The Anatomy of a Large-Scale Hypertextual Web Search Engine." Used for graph centrality measurement in the blast radius scorer.
4. **Kubernetes Pod Disruption Budgets** — kubernetes.io/docs/concepts/workloads/pods/disruptions/. PDB as voluntary disruption protection.
5. **Gremlin Resilience Framework** — Gremlin's categories of failure (infrastructure, application, network, state) informed the failure mode modeling (pod-crash vs workload-deletion vs namespace-deletion).

---

## 6. Configurability

Enterprise teams can tune health score weights to match their risk profile. The default weights represent a general-purpose Kubernetes environment. Teams with specific requirements (e.g., data-heavy workloads, strict compliance requirements, edge deployments) can adjust component weights while maintaining the constraint that weights sum to 1.0.

---

*Published by the Kubilitics team. Last updated: April 2026.*
