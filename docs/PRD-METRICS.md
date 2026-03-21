# Kubilitics Metrics Intelligence Engine — Product Requirements Document

**Version:** 1.0
**Date:** March 21, 2026
**Author:** Kubilitics Core Team
**Status:** Draft for Review

---

## 1. Vision

Kubilitics Metrics is not a dashboard. It is an **intelligence engine** that transforms raw Kubernetes resource data into instant understanding — the kind that today costs enterprises $50K–$500K/year in Datadog, New Relic, or Dynatrace licenses, plus months of PromQL/Grafana configuration expertise.

**The fundamental insight:** Every existing observability tool shows you data and expects you to figure out what it means. Kubilitics tells you what matters, why it matters, and what to do about it — in the time it takes to glance at a screen.

**Design philosophy:** We don't build charts. We build comprehension.

---

## 2. Problem Statement

### What exists today (the $100B observability market)

| Tool | Cost | Setup Time | Insight Quality |
|------|------|-----------|----------------|
| Datadog | $23/host/month + $0.10/metric | Days | Raw metrics, manual alerting |
| New Relic | $0.30/GiB ingested | Days | Good APM, weak K8s native |
| Grafana + Prometheus | Free (OSS) + infra cost | Weeks | Requires PromQL expertise |
| Lens | Free | Minutes | Basic, no intelligence |

### What's wrong with all of them

1. **You need to know what to look for.** PromQL is a programming language. Datadog's query builder requires expertise. Users spend more time building dashboards than understanding their systems.

2. **They show data, not insights.** "CPU is 45.3m" means nothing to 90% of engineers. Is that good? Bad? About to crash? Nobody knows without context.

3. **They're disconnected from action.** You see a problem in Grafana, then switch to kubectl to investigate, then switch to your IDE to fix. Three tools, three contexts, zero flow.

4. **They cost a fortune at scale.** A 200-node cluster on Datadog costs $55K/year just for infrastructure monitoring. Add APM and logs, and you're at $200K+.

### What Kubilitics does differently

Kubilitics is free, runs locally, requires zero infrastructure, and provides intelligence that makes Datadog look like a spreadsheet.

---

## 3. Core Principles

### 3.1 — Zero-Query Intelligence
No PromQL. No query builders. No dashboard configuration. Open the resource, see everything instantly. The system knows what matters for each resource type and shows it without being asked.

### 3.2 — Context Over Data
Never show a number without context. "128Mi" is data. "128Mi / 256Mi limit (50%) — stable, healthy" is context. Every metric includes: current value, what it means, how it compares to its limit/request, and whether you should care.

### 3.3 — Anomaly-First Design
Green silence, red signal. When everything is healthy, the metrics section is calm and minimal. When something is wrong, it screams. The visual weight of each element is proportional to its urgency.

### 3.4 — Integrated Action
See a problem → click → fix it. OOM risk? One click to edit the deployment's memory limit. CPU throttling? One click to scale horizontally. No context switching.

---

## 4. Feature Specification

### 4.1 — Resource Health Score (The Headline)

Every resource gets a single number: **0–100 Health Score** with a letter grade (A–F).

**Computation factors (weighted):**
- Resource utilization vs limits (30%) — Are you close to limits?
- Restart frequency (20%) — Any OOMKills or CrashLoopBackOffs?
- Trend stability (15%) — Is usage volatile or steady?
- Limit configuration (15%) — Are requests/limits properly set?
- Network error rate (10%) — Any packet drops or connection failures?
- Age & uptime (10%) — Has the pod been running long enough to trust?

**Visual:** Large circular gauge (like the Grafana gauges but with letter grade inside), color-coded green→amber→red.

**Why this is revolutionary:** No tool in the market gives you a single health score per workload. Datadog has "Service Level Objectives" which require manual configuration. Kubilitics computes this automatically from available data.

---

### 4.2 — The Metrics Overview (Single Pane of Glass)

When you open any resource's metrics, you see ONE screen that tells you everything:

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ ████ 78/A  │  │  CPU       │  │  Memory    │  │  Network  │ │
│  │ Health     │  │  ▁▂▃▄▅▆▇  │  │  ▇▇▇▇▇▇▇  │  │  ▁▂▃▁▂▃▁ │ │
│  │ Score      │  │  42m ↑12%  │  │  128Mi ——  │  │  2.1MB/s  │ │
│  │            │  │  of 500m   │  │  of 256Mi  │  │  ↓1.8 ↑0.3│ │
│  └────────────┘  └────────────┘  └────────────┘  └───────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ 💡 INSIGHTS                                                 ││
│  │ • Memory stable at 50% — well-configured limits             ││
│  │ • CPU spiked 3x at 09:15 — correlates with CronJob run     ││
│  │ • 0 restarts in 48h — excellent stability                   ││
│  │ • Network: 99.2% inbound (this pod receives, rarely sends)  ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ RESOURCE ALLOCATION                                         ││
│  │ CPU  [████████░░░░░░░░░░░░] 42m / 500m (8.4%)              ││
│  │ MEM  [██████████░░░░░░░░░░] 128Mi / 256Mi (50%)            ││
│  │ NET  [██░░░░░░░░░░░░░░░░░░] 2.1 MB/s peak                 ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

Each metric card contains:
- **Sparkline** (last 30 min, 80px, no axes — just the shape)
- **Current value** (large font)
- **Trend** (↑↓—— with percentage, 5-min window)
- **Context** ("of {limit}" or "no limit set ⚠️")
- **Color border** (green/amber/red based on % of limit)

---

### 4.3 — Intelligent Insights Engine

This is what separates Kubilitics from every tool in the market. Auto-generated, context-aware insights computed from real-time and historical data.

**Insight Categories:**

| Category | Example | Trigger |
|----------|---------|---------|
| Stability | "Memory stable at 128Mi for 45 minutes" | Std deviation < 5% of mean |
| Trend | "CPU trending up 23% over last 30 min" | Linear regression slope > 0.15 |
| Spike | "Memory spike to 240Mi at 09:23 (1.8x normal)" | Point > 1.5x rolling average |
| Risk | "OOM risk: memory at 87% of limit and rising" | Usage > 80% of limit + upward trend |
| Throttle | "CPU likely throttled: 95% of 500m limit" | CPU > 90% of limit |
| Config | "No memory limit set — pod can consume unlimited RAM" | Limit not configured |
| Efficiency | "CPU requested 500m but only using 42m (8.4%) — over-provisioned" | Usage < 20% of request |
| Network | "Outbound traffic 10x higher than 1h ago — possible data exfiltration or log flood" | Sudden outbound spike |
| Restart | "2 OOMKills in last hour — increase memory limit" | Recent restarts with OOM reason |
| Comparison | "This pod uses 3x more CPU than other pods in this deployment" | Outlier detection across siblings |

**Implementation:** Pure computation — no ML, no external service. Pattern matching against time-series data with configurable thresholds. Runs in the frontend from history data.

---

### 4.4 — CPU Deep Dive Tab

**Layout (top to bottom):**

1. **Gauge Row** (Grafana-inspired, but smarter):
   - Usage vs Requests gauge (green/amber/red)
   - Usage vs Limits gauge
   - "Resources by container" table (Container | CPU Request | CPU Limit)

2. **Usage Over Time** (full-width area chart):
   - Gradient fill (blue→transparent)
   - Dashed red reference line at CPU limit
   - Dashed amber reference line at CPU request
   - Smart Y-axis: shows millicores for small values, full cores for large
   - Legend: current | avg | min | max | p95

3. **Stats Bar** (4 cards):
   - Min | Max | Average | P95
   - Each card shows the value, when it occurred, and % of limit

4. **Container Breakdown** (for multi-container pods):
   - Stacked area chart per container (different colors)
   - Legend with per-container avg + current

5. **Pod Comparison** (for controllers — Deployments, StatefulSets, etc.):
   - Multi-line chart: one line per pod replica
   - Instantly reveals if one pod is consuming more CPU than its siblings
   - Legend: pod name | avg | current

---

### 4.5 — Memory Deep Dive Tab

**Layout (same structure as CPU but with memory-specific additions):**

1. **Gauge Row**:
   - Usage vs Requests gauge
   - Usage vs Limits gauge
   - "Resources by container" table (Container | Mem Request | Mem Limit)

2. **Usage Over Time**:
   - Purple gradient fill
   - Reference lines for request + limit
   - Smart Y-axis: MiB for small, GiB for large
   - Legend: current | avg | min | max

3. **Stats Bar**: Min | Max | Average | Current

4. **OOM Risk Indicator** (unique to memory):
   - If usage > 70% of limit AND trending up:
     - Red banner: "⚠️ OOM Risk — Memory at {X}% of {limit} and rising. At current rate, limit will be hit in ~{minutes}min."
     - Projected time-to-limit computed from linear regression slope
   - If usage < 50% of limit: Green "Healthy" indicator

5. **Container Breakdown**: Same as CPU

6. **Pod Comparison**: Same as CPU — reveals memory-hungry replicas

---

### 4.6 — Network Deep Dive Tab

**Layout:**

1. **Summary Cards**:
   - Total Received (↓) with rate (MB/s)
   - Total Sent (↑) with rate (MB/s)
   - Peak Bandwidth
   - Packet Rate (if available)

2. **Bandwidth Over Time** (dual-area chart):
   - Inbound: green area (above x-axis)
   - Outbound: blue area (mirrored below x-axis, Grafana-style)
   - Y-axis in adaptive units: B/s → KiB/s → MiB/s
   - This is the most visually distinctive chart — immediately shows traffic patterns

3. **Per-Pod Network** (for controllers):
   - Horizontal bar chart ranking pods by total traffic
   - Heat-mapped colors (red = most traffic, green = least)

4. **Traffic Pattern Analysis** (insight):
   - "Mostly inbound (95%) — this is a receiver/consumer service"
   - "Balanced in/out — likely a proxy or gateway"
   - "Outbound spike at 14:30 — investigate for data leak or log flood"

---

### 4.7 — Resource Allocation Intelligence

This section replaces the boring "Usage vs Limits" cards with actionable intelligence.

**For each container:**

```
┌─────────────────────────────────────────────────────────────┐
│ Container: nginx                                            │
│                                                             │
│ CPU    Request: 100m    Limit: 500m    Actual: 42m          │
│        [████░░░░░░░░░░░░░░░░░░░░░░░░░░░]                   │
│        ↑req              ↑actual        ↑limit              │
│        💡 Over-provisioned: using 8.4% of request.          │
│           Recommendation: reduce request to 50m             │
│                                                             │
│ Memory Request: 128Mi   Limit: 256Mi   Actual: 189Mi       │
│        [████████████████████████░░░░░░░░]                   │
│        ↑req                    ↑actual  ↑limit              │
│        ⚠️ High utilization: 74% of limit.                   │
│           Recommendation: increase limit to 384Mi           │
└─────────────────────────────────────────────────────────────┘
```

**The triple-bar visualization** shows Request, Actual Usage, and Limit on the same axis — this does not exist in any tool today. It immediately answers:
- Am I over/under-provisioned? (actual vs request gap)
- Am I at risk? (actual vs limit proximity)
- What should I change? (computed recommendation)

---

### 4.8 — Real-Time History (Backend)

**Architecture:**
- In-memory ring buffer: 120 points per resource (1 hour at 30-second intervals)
- Background collector goroutine: polls metrics for "watched" resources every 30 seconds
- REST endpoint: `GET /api/v1/clusters/{id}/metrics/history`
- No external database, no Prometheus, no InfluxDB — pure Go, zero dependencies
- Memory budget: ~1KB per resource × 100 watched resources = 100KB (negligible)

**Data stored per point:**
- Timestamp
- CPU (millicores, raw float64)
- Memory (MiB, raw float64)
- Network Rx/Tx (bytes)
- Per-pod breakdown (for controllers)
- Per-container breakdown (for pods)

**Why this matters:** Every competitor requires Prometheus + Thanos/Cortex for history. That's 3+ services, 10GB+ storage, and expert configuration. Kubilitics gives you 1 hour of per-resource history with zero setup.

---

### 4.9 — Collapsible Sections (Grafana-Inspired Layout)

Following the Grafana pattern of `▼ Section Title` collapsible rows:

```
▼ Total Usage           ← Gauges + stats (always visible)
▼ CPU Analytics         ← Charts + breakdown + insights
▼ Memory Analytics      ← Charts + breakdown + insights
▼ Network              ← Bandwidth + traffic patterns
▼ Resource Allocation  ← Request/Limit/Actual triple-bar
▼ Pod Comparison       ← Only for controllers
```

Each section collapses independently. State persists in localStorage. Default: Total Usage and CPU Analytics expanded, rest collapsed.

**Why collapsible instead of tabs:** Tabs hide information. Collapsible sections let you see multiple sections simultaneously — CPU and Memory side by side, or scroll through a complete view. This matches how real SREs work: they need the full picture, not one slice at a time.

---

## 5. Data Sources & What We Can Show

| Metric | Source | Available Today | Notes |
|--------|--------|----------------|-------|
| CPU usage | Metrics Server API | ✅ Yes | Per-container, aggregated to pod |
| Memory usage | Metrics Server API | ✅ Yes | Working set bytes |
| CPU request/limit | Pod spec | ✅ Yes | From K8s API |
| Memory request/limit | Pod spec | ✅ Yes | From K8s API |
| Network Rx/Tx bytes | Kubelet stats/summary | ✅ Yes | Cumulative since pod start |
| Network rate | Computed | ✅ Yes | Diff between samples / interval |
| Restart count | Pod status | ✅ Yes | From K8s API |
| Restart reason | Pod status | ✅ Yes | OOMKilled, Error, etc. |
| Container count | Pod spec | ✅ Yes | From K8s API |
| Node capacity | Node API | ✅ Yes | Total CPU/Memory/Pods |
| Filesystem usage | Kubelet stats/summary | 🟡 Possible | Not yet implemented |
| Disk I/O | Kubelet stats/summary | 🟡 Possible | Future enhancement |

---

## 6. Visual Design Language

### Color System
- **Green (#4ade80):** Healthy, < 60% utilization
- **Amber (#f59e0b):** Elevated, 60–80% utilization
- **Red (#ef4444):** Critical, > 80% utilization
- **Blue (#3b82f6):** Informational, neutral
- **Purple (#8b5cf6):** Memory-specific accent

### Gauge Style
- Half-circle (180°) with gradient arc: green→amber→red
- Large percentage inside, label below
- Dark background (#1a1a2e) matching app theme
- Subtle glow effect on the arc

### Chart Style
- Area charts with vertical gradient fills (15% opacity at top → 0% at bottom)
- Grid lines: subtle white at 5% opacity
- Axis labels: muted color, smart formatting
- Tooltips: dark card with timestamp + all values + context
- Reference lines (limits): dashed, red, labeled

### Typography
- Current value: 2xl bold
- Labels: xs uppercase tracking-wider muted
- Insights: sm with emoji prefix for category
- Units: lg lighter weight beside value

---

## 7. Implementation Phases

### Phase 1: History Backend + Collapsible Layout (Week 1)
- Ring buffer store
- Background collector
- History REST endpoint
- Restructure frontend from tabs to collapsible sections
- Wire real history data (replace mock jiggle)

### Phase 2: Gauges + Stats + Triple-Bar (Week 2)
- Half-circle gauge components (CPU, Memory utilization)
- Stats bar (min/max/avg/p95)
- Resource allocation triple-bar visualization
- Container resources table

### Phase 3: Insights Engine + Pod Comparison (Week 3)
- Implement all insight categories (stability, trend, spike, risk, etc.)
- Pod comparison multi-line chart for controllers
- Container breakdown charts
- OOM risk projector

### Phase 4: Network Intelligence + Polish (Week 4)
- Dual-area bandwidth chart (Grafana-style mirror)
- Network rate computation
- Traffic pattern analysis
- Final visual polish, animations, responsive layout

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Time to first insight | < 2 seconds (open resource → see health score + insights) |
| Zero configuration | No PromQL, no dashboard setup, no data source config |
| Memory overhead | < 10MB for 100 watched resources |
| Works on | Any cluster with Metrics Server (95% of production clusters) |
| Cost | $0 (open source, no license, no SaaS dependency) |

---

## 9. Competitive Moat

| Capability | Kubilitics | Datadog | Grafana | Lens |
|-----------|-----------|---------|---------|------|
| Health Score per resource | ✅ Auto | ❌ Manual SLOs | ❌ No | ❌ No |
| Auto-generated insights | ✅ Yes | ❌ Requires monitors | ❌ No | ❌ No |
| Request/Limit/Actual triple-bar | ✅ Yes | ❌ No | ❌ No | ❌ No |
| OOM time-to-failure projection | ✅ Yes | ⚠️ Manual forecast | ❌ No | ❌ No |
| Right-sizing recommendations | ✅ Automatic | 💰 Paid add-on | ❌ No | ❌ No |
| Zero-config setup | ✅ Yes | ❌ Agent install | ❌ Prometheus stack | ⚠️ Basic |
| Pod sibling comparison | ✅ Built-in | ❌ Custom dashboard | ❌ Custom query | ❌ No |
| Cost | Free | $23+/host/mo | Free + infra | Free |

---

## 10. Non-Goals (What We Won't Build)

- **Log aggregation** — Not in metrics scope (future product area)
- **APM/tracing** — Requires instrumentation; out of scope
- **Custom dashboards** — We are anti-dashboard. The right data shows itself.
- **Alerting/paging** — Future product area (PagerDuty integration)
- **Multi-cluster aggregation** — Per-cluster only (fleet view handles cross-cluster)

---

## 11. Open Questions

1. **Filesystem usage:** The kubelet stats/summary API provides per-container filesystem usage. Should we include this in Phase 1 or defer to Phase 4?

2. **History persistence across app restarts:** Current design uses in-memory storage. Should we persist to SQLite for cross-session history? (Recommendation: Yes, in Phase 2)

3. **Gauge library:** Build custom SVG gauges or use a library? (Recommendation: Custom — 50 lines of SVG, no dependency)

---

*"People deserve great tools. We build them."*
