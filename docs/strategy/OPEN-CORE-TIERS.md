# Kubilitics Open-Core — Tier Structure Draft

**Status:** Draft for review. Not customer-facing.
**Author:** Koti Vellanki
**Last updated:** 2026-04-23 (post-v1.1.0 GA, post-open-core pivot)

---

## Position

Kubilitics is the **Kubernetes Operational Intelligence Platform**. Open-source core, paid tiers for teams and enterprises that need scale, compliance, and support.

**Open-core is the right shape** for our category. Precedents: Grafana, Sentry, GitLab, Kubecost, Istio, Headlamp. The binary is already user-distributed (Tauri bundle, Helm chart); source availability doesn't erode the moat. Moat = integration depth, UX polish, multi-cluster scale, support SLA.

---

## Three tiers

| | Community | Team | Enterprise |
|---|---|---|---|
| **Price** | $0 forever | $20/user/mo (billed annually)¹ | Custom (volume + features) |
| **Target user** | Solo SRE, homelab, evaluators, students | 3–50 engineer teams at startups / mid-market | 50+ engineers, regulated industries, 100+ clusters |
| **License** | Apache 2.0 | Commercial (proprietary) | Commercial (proprietary) |
| **Deployment** | Desktop app + self-hosted Helm | Same + team-hosted control plane | Same + dedicated / air-gapped |
| **Clusters** | Unlimited² | Unlimited | Unlimited |
| **Users** | 1 (local) | Up to team size | Unlimited |
| **Support** | GitHub Issues, Discussions | Email, 24h response | 24/7 phone + Slack, named CSM, SLA |

¹ Benchmarks: Lens Pro $24.95/mo, Kubermatic Kubernetes Platform ~$25/user/mo, Komodor $25/user/mo, Rafay per-node. Pricing lands in the middle of the pack.
² "Unlimited" in Community means no enforcement — reality is a practical cap driven by local compute.

---

## Feature split

### Community (OSS, in `vellankikoti/kubilitics`)

Everything that ships today at v1.1.0:

- **Desktop app** (macOS/Windows/Linux, signed, notarized, auto-update)
- **Helm chart** for in-cluster deployment
- **Multi-cluster management** across Docker Desktop, EKS, AKS, GKE, kind, k3s
- **5 topology view modes** (cluster, namespace, workload, resource-centric, RBAC)
- **9 intelligence pages** (health, events, workloads, network, storage, security, policy, simulation, observability)
- **Blast Radius v1** (wave visualization, cascade simulation)
- **AI Assistant** — full brain, all 163 tools, all providers (Ollama, OpenAI, Claude)
  - Uses user's own API key — no Kubilitics billing in the loop
  - Chat panel, per-cluster sessions, context-aware prompts
- **kcli** integrated terminal + kubectl wrapper
- **Basic RBAC** (Admin / Operator / Viewer)
- **Local SSO** (single-user OIDC for personal deployments)
- **Audit log** (local JSON)
- **Policy engine** (OPA integration, YAML rules)
- **Report schedules** (basic, single-cluster)
- **Metrics** — Prometheus ServiceMonitor, local dashboards

### Team (adds, in `vellankikoti/kubilitics-team` — future private repo)

Built on top of the OSS core. License key unlocks.

- **Team-shared workspace** — roles, invites, cross-user cluster access
- **Centralized auth** — SSO / OIDC / SAML / Google Workspace
- **Multi-cluster pool orchestration** — rolling ops across N clusters, staged rollouts
- **Team audit trail** — per-user attribution, export to CSV / JSON / Webhook
- **Priority insight processing** — dedicated AI budget pool, rate limit lift
- **Slack / Teams / PagerDuty integrations** — incident fan-out
- **Custom report templates** — branded PDF/HTML, scheduled distribution
- **Email / chat support** — 24h business-day response

### Enterprise (adds, in `vellankikoti/kubilitics-enterprise` — future private repo)

Built on Team. Dedicated deployment available.

- **Air-gapped / offline install** (including air-gapped AI brain + local model bundle)
- **SIEM connectors** — Splunk, Datadog, Elastic, Sumo, direct Kafka sink for audit + event stream
- **FIPS-compliant build** (crypto, TLS 1.3 only)
- **SOC 2 Type II + ISO 27001 attestation** (company level, shared as contract evidence)
- **Advanced RBAC** — custom roles, per-resource ACLs, JIT access
- **Compliance packs** — CIS K8s Benchmark automation, PCI-DSS control mapping, HIPAA posture
- **Blast Radius v2** — scoring policies, OTel coverage visibility, infra-component validation (see [Blast Radius v2 Gaps](../../memory/project_blast_radius_v2_gaps.md))
- **Root cause inference engine** (premium mode — causal chains stitched across cluster fleet)
- **Dedicated success engineer**, named CSM
- **24/7 Slack + phone** support, < 1h P0 response, 4h P1
- **Custom retention / compliance** — long-term audit archive, legal hold, data residency
- **Training + certification** — onboarding workshops, SRE team enablement

---

## Hard rules (no regret)

1. **Never move existing OSS features behind a paywall.** Trust violation. Paid tier is additive only. If a feature shipped Community in v1.1.0, it stays Community forever.
2. **AI core stays OSS.** The brain (`vellankikoti/kotg.ai`), the 163 tools, the router, the safety wrapper — all public, forever. Enterprise adds *ops around* the AI (dedicated budget, priority queues, audit export), not gate access to it.
3. **No telemetry by default in Community.** No usage ping-home, no anonymous stats. Opt-in only. Enterprise telemetry is on-by-default as part of the contract.
4. **License key is network-optional.** Enterprise customers must be able to run air-gapped without phoning home. Offline activation via signed license file.
5. **No "limited to N clusters / N users" crippling in Community.** Open-source stays real open-source. The moat is depth, not artificial limits.

---

## Revenue modeling (rough)

| Tier | ARPU/yr | Target 12-mo count | ARR contribution |
|---|---|---|---|
| Community | $0 | 10,000 installs | — (funnel) |
| Team | $240/user/yr | 500 teams × 8 users avg = 4,000 seats | **$960k** |
| Enterprise | $50k–$500k | 10 logos × $150k avg | **$1.5M** |
| **Total (end year 1)** | | | **~$2.5M ARR** |

Conservative — assumes ~5% Community → Team conversion, 0.1% Community → Enterprise. Benchmarks against Lens Pro (~4%) and Kubecost ($15M+ ARR in 3 years with similar shape).

---

## Next decisions needed

1. **When to create `vellankikoti/kubilitics-team`?** Recommendation: not until Team features are scoped and signed up first pilot. Premature repo invites fork temptation.
2. **License key implementation:** off-the-shelf ([Keygen.sh](https://keygen.sh), [Cryptolens](https://cryptolens.io), Paddle) vs. in-house. Recommend Keygen — minimal code, handles offline activation, air-gap, seat counting. ~$99/mo base, scales with revenue.
3. **First paid feature to ship:** Recommend **team-shared workspace + SSO**. Highest-frequency ask from enterprise users, lowest implementation risk, clearest value delta vs. Community.
4. **Pricing page launch:** Requires Team tier shipped. Target: Q3 2026 (v1.3 or v1.4 window).
5. **Support contract templates:** Need MSA, DPA, EULA drafted before first Enterprise sale. Standard tech lawyer ~$5–10k one-time.

---

## Open questions

- **Free-tier usage caps** — should Community ever have soft caps (e.g., "3 clusters max in dashboard UI, more in CLI")? Precedent mixed (Grafana yes, Headlamp no). Leaning **no caps** — simplicity wins.
- **Team tier without SSO** — is there a $10/user/mo "Small Team" tier without SSO/federation? Reduces friction for 3–5 person shops. Defer to post-launch pricing experimentation.
- **Community Edition branding** — should the app render a "Community Edition" watermark somewhere, or stay clean? Clean wins — respect the user.
- **Self-hosted Team** — does Team include the option to self-host its control plane, or is SaaS-only? Must be self-hosted by default; we're a K8s-ops tool, SaaS-only would be ironic.

---

**Status after this doc merges:** circulate to trusted advisors, finalize hard numbers, pick license vendor, draft MSA, then announce tiers publicly (with 90-day lead time before pricing page goes live).
