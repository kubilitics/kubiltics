# Changelog

All notable changes to Kubilitics will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.1.0] - 2026-04-22

First "robust stable" release. The AI chat surface is now provider-agnostic
(OpenAI / Anthropic / Ollama / Together / Groq via OpenAI-compatible API),
the brain ships as a Tauri externalBin sidecar, and the tool catalog grew
from 133 to 183 with new aggregators, diagnostics, planners, compliance
checks, and narrators.

### Added

**AI — new tool surface (50 tools)**

- 10 observability aggregators: `observe_flapping_services`,
  `observe_noisy_neighbors`, `observe_unhealthy_probes`,
  `observe_missing_probes`, `observe_orphaned_pods`,
  `observe_stuck_rollouts`, `observe_high_cardinality_labels`,
  `observe_restart_storms`, `observe_pending_scheduler_events`,
  `observe_zombie_finalizers`.
- 10 root-cause diagnostics: `diagnose_pod_not_ready`,
  `diagnose_service_no_endpoints`, `diagnose_pvc_pending`,
  `diagnose_ingress_404`, `diagnose_deployment_rollback_needed`,
  `diagnose_cronjob_missing_runs`, `diagnose_node_unschedulable`,
  `diagnose_hpa_not_scaling`, `diagnose_networkpolicy_blocking`,
  `diagnose_certificate_failures`.
- 10 planning tools: `plan_scale_deployment`, `plan_drain_node`,
  `plan_rollout_safety`, `plan_cost_reduction`, `plan_ha_upgrade`,
  `plan_resource_quota`, `plan_psa_enforcement`,
  `plan_image_pull_secrets`, `plan_backup_coverage`, `plan_pdb_coverage`.
- 10 compliance checks: `check_privileged_containers`,
  `check_root_containers`, `check_writable_root_fs`,
  `check_capabilities_all_added`, `check_host_path_mounts`,
  `check_default_service_accounts_in_use`, `check_secrets_in_env`,
  `check_image_tag_latest`, `check_ingress_tls_expiry_30d`,
  `check_rbac_wildcards`.
- 10 narrative tools: `narrate_incident_timeline`,
  `narrate_deploy_diff`, `narrate_weekly_status`,
  `narrate_onboarding_for_user`, `narrate_service_dependency_graph`,
  `narrate_capacity_report`, `narrate_cost_report`,
  `narrate_security_posture`, `narrate_migration_readiness`,
  `narrate_change_impact`.

**AI — robustness**

- Brain ships as Tauri externalBin sidecar (new
  `kubilitics-ai-server` binary per arch).
- OpenAI client retries 5xx with exponential backoff + honors
  `Retry-After` on 429.
- Chat sessions persist to SQLite across app restarts.
- AI Settings round-trips API keys through the OS keychain
  (Keychain / Credential Manager / libsecret).
- Cluster-switch event bus clears 9 cache stores in <200 ms on switch.
- Budget Gate enforces per-session cost cap; WebSocket emits
  `budget_exceeded` banner; Settings has one-click reset.

**Backend — integration gap closures**

- `/metrics/summary` without a resource scope now returns a cluster
  aggregate ({pods, nodes}) instead of 400.
- New `/resources/ingresses/{ns}/{name}/tls-info` subresource parses
  each TLS cert and returns `days_remaining` per host.
- gRPC and REST can bind simultaneously (gRPC port made configurable).

**Bench — LLM-as-judge**

- New `--judge-base-url` / `--judge-model` flags on
  chat-quality-bench.  Scores each answer 1..5 on factual /
  completeness / clarity / tool_use plus a one-sentence critique.
- Judge JSON embedded into JUnit `<system-out>` blocks for downstream
  ingestion.  `--judge-gate` makes scores below
  `--judge-threshold` (default 4.0) count as failures.
- Rubric documented in `cmd/chat-quality-bench/judge_rubric.md`.

### Changed

- Desktop app now spawns two sidecars (backend + brain) with
  independent health checks and emits `brain-status` events alongside
  `backend-status`.
- Replaced the old GitHub Releases API check-for-updates widget with
  the signed `tauri-plugin-updater` pipeline (keys provisioned via
  `TAURI_UPDATER_PRIVATE_KEY` secret).

### Removed

- `UpdateChecker` component (GitHub-Releases polling) — superseded by
  `tauri-plugin-updater`.

### Fixed

- Deployment rollout `changeCause` camelCase is now read by
  `observe_recent_changes` (was silently empty).
- Sidebar counter widget gracefully degrades when `/summary` is
  rate-limited; no more 0-everywhere flashes on cluster switch.

### Known Issues

See `KNOWN_ISSUES.md`.

## [v0.1.0] - 2026-03-28

First public release of Kubilitics. Clean version reset with full security audit,
release pipeline hardening, and production readiness.

### Added

**Desktop App (Tauri 2.0)**
- macOS (universal), Windows (x64), Linux (x64) desktop application
- Go backend sidecar with automatic health monitoring and restart
- Auto-detect kubeconfig from `~/.kube/config` with multi-context support
- AES-256-GCM encrypted kubeconfig storage
- Check-for-updates via GitHub Releases API

**Kubernetes Dashboard**
- Real-time resource monitoring via WebSocket informer streams
- 51 resource detail pages with unified SectionCard design
- Multi-cluster management with fleet overview
- Topology visualization (React Flow + ELK layout) with export
- In-browser terminal with kcli (kubectl wrapper) integration
- Port forwarding, log viewer, pod exec

**Backend (Go)**
- REST API + WebSocket with RBAC (Admin/Operator/Viewer)
- JWT auth, API key auth, MFA/TOTP, OIDC/SAML SSO support
- Rate limiting (token bucket per IP), circuit breaker
- SQLite (desktop) / PostgreSQL (in-cluster) database
- Kubernetes Secret data redaction in API responses
- Version reporting via `/health` endpoint

**In-Cluster Deployment**
- Helm chart with NetworkPolicies, security contexts, RBAC
- cert-manager integration for TLS
- Multi-arch Docker images (amd64, arm64)
- Production values file with all security hardening enabled

**CI/CD Pipeline**
- Version consistency check across 6 files
- CI gate before release (verifies all checks passed)
- Trivy scanning for both backend and frontend Docker images
- govulncheck, npm audit, Semgrep, Gitleaks, Kubescape
- Dependabot for Go, npm, Cargo, and GitHub Actions
- Checksums generation for all release artifacts

### Security

- Backend binds to `127.0.0.1` by default (desktop), `0.0.0.0` for in-cluster
- Kubernetes tokens and kubeconfig credentials excluded from localStorage persistence
- Zustand store migration cleans stale credentials from previous versions
- Content Security Policy without `unsafe-eval`
- Security headers (CSP, HSTS with preload, X-Frame-Options, etc.)
- WebSocket Origin validation with auth fallback
- Secure temp file creation (`os.CreateTemp`) prevents symlink attacks
- Docker entrypoint sanitizes environment variables before JS injection
- nginx proxy port corrected (was 819, now 8190)

### Architecture

```
Kubilitics
├── kubilitics-desktop  (Tauri 2.0 host, Rust)
├── kubilitics-frontend (React + TypeScript + Vite SPA)
├── kubilitics-backend  (Go REST API + WebSocket, SQLite/PostgreSQL, port 8190)
└── kcli                (kubectl wrapper CLI, Go)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to Kubilitics.

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
