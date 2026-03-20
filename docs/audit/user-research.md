# Kubilitics OS — User Research & Persona Analysis

**Version:** 1.0
**Date:** 2026-03-16
**Scope:** Target personas, user journeys, pain points, competitive switching analysis

---

## Executive Summary

Kubilitics targets three primary personas: **Platform Engineers**, **Application Developers**, and **SRE/DevOps Engineers**. Each has distinct needs, workflows, and tool expectations. This document maps user journeys, identifies friction points, and proposes experience optimizations for each persona.

---

## 1. Target Personas

### 1.1 Persona A: Platform Engineer (Primary Target)

**Profile:**
- Title: Platform Engineer / Infrastructure Engineer
- Experience: 5-10 years, Kubernetes expert
- Manages: 5-50 clusters across environments
- Daily tools: kubectl, Terraform, ArgoCD, Prometheus/Grafana, Slack
- Pain: Tool sprawl (10+ tools daily), no unified view, CRD management tedious

**Needs:**
| Need | Priority | Kubilitics Coverage | Gap |
|------|----------|-------------------|-----|
| Multi-cluster overview | P0 | Home page + Dashboard | No fleet-level health score |
| Topology visualization | P0 | Topology page (5 views) | No cross-cluster topology |
| Add-on lifecycle | P0 | Full Helm lifecycle | No GitOps sync status |
| RBAC management | P1 | RBAC pages + topology view | No policy audit reports |
| Cost attribution | P1 | Placeholder in backend | Not implemented |
| Compliance dashboards | P2 | Not implemented | Critical for regulated industries |

**Current Journey:**

```
Morning check → kubectl get pods → switch contexts → repeat × 5 clusters
Incident → Slack alert → kubectl describe → kubectl logs → Google error
Add-on install → helm repo add → helm install → kubectl get pods → troubleshoot
```

**Desired Journey (with Kubilitics):**

```
Morning check → Dashboard (all clusters at glance) → AI insights highlight issues
Incident → Topology shows affected resources → AI explains root cause → One-click fix
Add-on install → Catalog browse → Preflight → One-click install with progress
```

**Friction Points in Current Kubilitics:**
1. No fleet-level dashboard across all clusters
2. No GitOps integration (ArgoCD/Flux sync status)
3. Cost attribution not implemented
4. AI not discoverable enough for daily workflow
5. No custom dashboard layouts

---

### 1.2 Persona B: Application Developer

**Profile:**
- Title: Software Engineer / Full-Stack Developer
- Experience: 2-5 years, Kubernetes beginner-to-intermediate
- Manages: 1-3 applications across dev/staging/prod namespaces
- Daily tools: IDE, git, Docker, kubectl (reluctantly), CI/CD pipeline
- Pain: kubectl is intimidating, can't visualize what's deployed, debugging is hard

**Needs:**
| Need | Priority | Kubilitics Coverage | Gap |
|------|----------|-------------------|-----|
| See my deployments | P0 | Deployment list + detail | No "my apps" filter |
| View pod logs | P0 | Pod logs page | No multi-container log merge |
| Understand relationships | P0 | Topology page | Not surfaced in resource pages |
| Scale/restart | P0 | Scale + restart actions | No inline table actions |
| Debug errors | P1 | Events, logs, metrics | No AI-guided debugging |
| Deploy updates | P2 | Apply manifest | No CI/CD integration |

**Current Journey:**

```
Deploy → git push → CI builds → kubectl apply → kubectl get pods → wait → kubectl logs
Debug → kubectl describe pod → kubectl logs → scroll through output → ask SRE for help
Scale → kubectl scale deployment → kubectl get pods → wait for rollout
```

**Desired Journey (with Kubilitics):**

```
Deploy → See deployment status in Dashboard → Topology shows new pods appearing
Debug → Click failed pod → See events + logs + metrics → AI explains the issue
Scale → Click deployment → Scale slider → Watch pods scale in real-time
```

**Friction Points in Current Kubilitics:**
1. Onboarding too complex — developer doesn't know what "Desktop Engine" means
2. No "My Applications" view — sees all cluster resources, overwhelming
3. Relationships not visible on resource detail pages
4. No guided debugging flow (step-by-step investigation)
5. AI setup requires API key knowledge (developers may not have)

---

### 1.3 Persona C: SRE / DevOps Engineer

**Profile:**
- Title: SRE / DevOps Engineer / Reliability Engineer
- Experience: 3-8 years, strong Kubernetes knowledge
- Manages: 3-20 clusters, on-call rotation
- Daily tools: PagerDuty, Grafana, Prometheus, kubectl, runbooks
- Pain: MTTR too long, context switching between tools during incidents, alert fatigue

**Needs:**
| Need | Priority | Kubilitics Coverage | Gap |
|------|----------|-------------------|-----|
| Incident response | P0 | Events, logs, topology | No incident timeline view |
| Alert management | P0 | AlertsStrip (basic) | No PagerDuty/Slack integration |
| Resource metrics | P0 | metrics-server | No Prometheus integration |
| Historical analysis | P0 | Not implemented | Critical for post-mortems |
| Runbook integration | P1 | Not implemented | Link actions to runbooks |
| SLO tracking | P1 | Not implemented | SRE core practice |

**Current Journey (Incident):**

```
PagerDuty alert → Open Grafana → Identify affected service → kubectl describe
→ kubectl logs → Identify root cause → kubectl apply fix → Monitor recovery
→ Write post-mortem → Update runbook
```

**Desired Journey (with Kubilitics):**

```
Alert notification → Open Kubilitics → AI shows incident summary with affected resources
→ Topology highlights impact radius → Click to see logs + events + metrics
→ AI proposes fix → Approve action → Monitor recovery in real-time
→ Export incident timeline for post-mortem
```

**Friction Points in Current Kubilitics:**
1. No alert integration (PagerDuty, OpsGenie, Slack)
2. No Prometheus integration (metrics-server only)
3. No historical data for post-mortems
4. No incident timeline view (what happened in what order)
5. AI safety model not fully implemented (trust issue for production actions)

---

## 2. User Journey Analysis

### 2.1 First-Time User Journey

```
Step 1: Download/Install
├── Desktop: Download from website → Install DMG/MSI/DEB
├── CLI (kcli): brew install kubilitics/tap/kcli
└── In-Cluster: helm install kubilitics kubilitics/kubilitics

Step 2: First Launch
├── See ModeSelection page [FRICTION: confusing labels]
├── Choose Desktop Engine [FRICTION: no auto-detect]
└── Wait for app to load

Step 3: Connect Cluster
├── See ClusterConnect page [FRICTION: overwhelming options]
├── Select kubeconfig file (or auto-detect) [FRICTION: 4-6 clicks]
├── Choose context [FRICTION: multiple contexts confusing for beginners]
└── Click Connect

Step 4: First Value
├── See Home page with cluster overview [GOOD: immediate value]
├── Click Topology [EXCELLENT: unique differentiator]
├── Explore resources [GOOD: comprehensive]
└── Try AI assistant [FRICTION: hidden, needs API key setup]

Step 5: Adopt or Abandon
├── If value clear in <5 min → Continue using
├── If confused or slow → Close app, go back to kubectl
└── If impressed by topology → Share with team
```

**Time-to-Value Analysis:**
| Step | Current Time | Target Time | Gap |
|------|-------------|-------------|-----|
| Install | 2 min | 2 min | None |
| First Launch → Mode | 30 sec | 0 sec (auto-detect) | 30 sec |
| Mode → Connect | 60 sec | 10 sec (auto-connect) | 50 sec |
| Connect → See Data | 30 sec | 5 sec | 25 sec |
| **Total** | **~4 min** | **<60 sec** | **~3 min** |

### 2.2 Daily User Journey (Platform Engineer)

```
Morning:
1. Open Kubilitics [1 sec → app cached]
2. Check Dashboard [2 sec → see cluster health]
3. Review AI insights [not available → must manually check]
4. Switch between clusters [3 clicks → sidebar → cluster selector → choose]

Incident Response:
1. Notice alert [AlertsStrip at bottom → easy to miss]
2. Navigate to affected resource [3-5 clicks depending on depth]
3. View related resources [must go to Topology → separate navigation]
4. Check logs and events [tabs on detail page → good]
5. Take action (scale/restart) [must find correct button → could be faster]

Add-on Management:
1. Browse catalog [good → dedicated page]
2. Review preflight [good → 7-check pipeline]
3. Install with progress [good → real-time feedback]
4. Monitor health [good → health monitoring]
```

### 2.3 On-Call Journey (SRE)

```
Alert Received (2 AM):
1. Open phone/laptop [10 sec]
2. Open Kubilitics [5 sec]
3. Find affected cluster [variable → no deep-link from alert]
4. Identify failing resource [manual → no incident summary]
5. Check logs and events [3-5 clicks]
6. Identify root cause [manual → AI not triggered automatically]
7. Apply fix [varies by issue]
8. Verify recovery [must watch manually]
9. Total MTTR: 15-45 min [target: 5-15 min with AI]
```

---

## 3. Competitive Switching Analysis

### 3.1 Users Switching from Lens

**Why They Left Lens:**
- License change (proprietary since Mirantis acquisition)
- Performance degradation (Electron memory usage)
- Privacy concerns (telemetry)
- Stagnant feature development

**What They Expect from Kubilitics:**
| Expectation | Met? | Notes |
|-------------|------|-------|
| Open source (truly) | Y | Apache 2.0 |
| Lightweight | Y | Tauri 2.0 (5-10x smaller) |
| Dark mode | Partial | Incomplete implementation |
| Extension ecosystem | N | No extension/plugin API |
| Cluster connection speed | Partial | Auto-detect exists but flow is complex |
| Helm management | Y | Better than Lens (full lifecycle) |
| Metrics visualization | Partial | metrics-server only (Lens uses Prometheus via extension) |

**Switching Friction:**
- Lens users expect one-click cluster connection (kubeconfig auto-detect)
- Lens users expect keyboard shortcuts they already know
- Lens has a mature extension ecosystem (Kubilitics has none)

### 3.2 Users Switching from K9s

**Why They Consider Kubilitics:**
- Need visual topology (K9s is terminal only)
- Need AI assistance
- Need team sharing capabilities
- Need add-on management

**What They Expect:**
| Expectation | Met? | Notes |
|-------------|------|-------|
| Speed | Partial | GUI inherently slower than TUI |
| Keyboard-first | Y | Topology shortcuts, but not universal |
| Minimal UI | N | 130 pages is not minimal |
| Resource browsing speed | Partial | Table + detail, but no inline actions |
| Zero config | Y | kcli is zero-config CLI |

**Switching Friction:**
- K9s users are keyboard-only; GUI feels slow
- K9s users value speed over features
- kcli bridges this gap effectively as a CLI complement

### 3.3 Users Switching from Rancher

**Why They Consider Kubilitics:**
- Rancher requires cluster-level deployment (heavy)
- Need offline/desktop experience
- Want AI integration
- Want better topology visualization

**What They Expect:**
| Expectation | Met? | Notes |
|-------------|------|-------|
| Multi-cluster management | Y | Core feature |
| RBAC management | Y | Pages + topology view |
| Catalog/marketplace | Y | Add-on platform |
| Fleet management | Partial | No fleet-level dashboard |
| Monitoring integration | N | No Prometheus native |
| GitOps integration | N | No ArgoCD/Flux |

---

## 4. Pain Point Priority Matrix

| Pain Point | Persona | Severity | Frequency | Kubilitics Addressable? |
|-----------|---------|----------|-----------|------------------------|
| Tool sprawl (10+ tools) | A, C | High | Daily | Partially (need Prometheus, alerts) |
| kubectl UX | B | High | Daily | Yes (kcli + GUI) |
| No relationship visibility | A, B, C | High | Daily | Yes (topology — needs more surfacing) |
| Incident MTTR | C | Critical | Weekly | Partially (need AI safety, alerts) |
| CRD management | A | Medium | Weekly | Yes (generic CRD viewer) |
| Cost visibility | A | High | Monthly | No (placeholder only) |
| Onboarding complexity | B | High | One-time | Fixable (auto-connect, guided flow) |
| Alert integration | C | Critical | Daily | No (notifications addon-only) |
| Historical data | A, C | High | Daily | No (real-time only) |
| Dark mode | B, C | Medium | Daily | Partial (incomplete) |

---

## 5. Feature Priority by Persona Impact

### Tier 1: Impacts All Personas (Build First)

| Feature | Persona A | Persona B | Persona C | Effort |
|---------|-----------|-----------|-----------|--------|
| Auto-connect (skip mode selection) | High | Critical | High | Small |
| AI visibility (dashboard card, contextual) | High | High | Critical | Medium |
| Relationship tabs on detail pages | High | Critical | High | Medium |
| Dark mode completion | Medium | High | High | Medium |
| Time-range metrics | High | Medium | Critical | Large |

### Tier 2: Primary Persona (Platform Engineer)

| Feature | Impact | Effort |
|---------|--------|--------|
| Fleet-level dashboard | Critical | Large |
| Cost attribution | High | Large |
| GitOps integration (ArgoCD/Flux status) | High | Large |
| Custom dashboard layouts | Medium | Medium |
| Compliance dashboard | Medium | Large |

### Tier 3: SRE-Specific

| Feature | Impact | Effort |
|---------|--------|--------|
| Prometheus integration | Critical | Large |
| Alert webhook (PagerDuty/Slack) | Critical | Medium |
| Incident timeline view | High | Medium |
| SLO/SLI tracking | High | Large |
| Post-mortem export | Medium | Medium |

### Tier 4: Developer-Specific

| Feature | Impact | Effort |
|---------|--------|--------|
| "My Applications" filter | High | Small |
| Guided debugging flow | High | Medium |
| AI-powered log analysis | High | Medium |
| CI/CD pipeline integration | Medium | Large |
| Resource comparison (staging vs prod) | Medium | Medium |

---

## 6. User Research Methodology (Proposed)

### 6.1 Quantitative Research

**Analytics to Implement:**
- Feature usage heatmap (which pages/features are most used)
- Navigation path analysis (how users flow through the app)
- Time-on-page for topology vs resource pages
- Cluster connection success rate
- AI assistant engagement rate
- Add-on installation completion rate

**Key Metrics:**
| Metric | Current | Target (6 months) |
|--------|---------|-------------------|
| Time-to-first-value | ~4 min | <60 sec |
| Weekly active users | Unknown | 25% of installs |
| AI assistant usage rate | Unknown | 40% of sessions |
| Add-on install success | Unknown | >90% |
| Topology page visits | Unknown | 60% of sessions |
| NPS score | Unknown | 40+ |

### 6.2 Qualitative Research Plan

**User Interviews (Monthly):**
- 3-5 users per persona per month
- Focus on: workflow integration, pain points, feature requests
- Record and share key insights with team

**Usability Testing (Bi-weekly):**
- 3-5 participants per session
- Task-based testing: "Find and scale a deployment", "Install cert-manager", "Investigate a failing pod"
- Measure: task completion rate, time-on-task, error rate, satisfaction

**Beta Program:**
- Invite 50 power users to private beta
- Weekly feedback surveys
- Feature voting board
- Direct Slack channel with engineering team

---

## 7. Persona-Specific UX Recommendations

### For Platform Engineers (Persona A):
1. Add fleet health dashboard (all clusters at a glance with health scores)
2. Surface cost data alongside resource views
3. Add GitOps sync status badges (ArgoCD/Flux) on deployments
4. Custom dashboard widget arrangement
5. Bulk operations across clusters

### For Application Developers (Persona B):
1. Auto-connect on first launch (skip mode selection)
2. Add "My Applications" view filtered by namespace/label
3. Surface relationships on every resource detail page
4. One-click AI debugging: "Why is this pod failing?"
5. Simplified add-on discovery: "Install monitoring for my app"

### For SRE/DevOps Engineers (Persona C):
1. Prometheus integration for real metrics
2. Alert webhook configuration (PagerDuty, Slack, OpsGenie)
3. Incident timeline view: "What happened in the last hour?"
4. AI-powered root cause analysis with confidence scores
5. Post-mortem export with topology snapshot + event timeline

---

*End of User Research & Persona Analysis — Kubilitics OS v1.0*
