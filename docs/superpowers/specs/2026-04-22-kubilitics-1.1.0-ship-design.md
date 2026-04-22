# Kubilitics 1.1.0 — Ship Design

*Design approved 2026-04-22 via brainstorming skill. Target release: `v1.1.0` on `github.com/vellankikoti/kubilitics`.*

## Goal (one testable sentence)

Ship a macOS desktop app + Windows `.msi` + Linux AppImage/deb/rpm that a K8s operator can install, configure with any LLM provider, and use to chat with their Kubernetes clusters — passing 95/100 on real-world incident scenarios with three different providers before the tag pushes.

## Why this document

The prior `v1.0.0` on `github.com/kubilitics/kubilitics` was frozen months ago; auto-update has been broken for months; the AI layer landed in pieces across 30+ commits without a coherent release. This spec closes every known gap in the user's first-10-minutes path, validates with bench evidence, and gates on automated + manual tests before ship. **Robust, not half-cooked.**

---

## Section 1 — Architecture & scope

### Binary shape (single DMG per arch, single `.msi`, three Linux archives)

```
Kubilitics.app/                                   (macOS)
├── Contents/MacOS/kubilitics                     ← Tauri frontend
├── Contents/Resources/sidecars/
│   ├── kubilitics-backend                        ← Go, binds :8190 REST (+ :50061 gRPC)
│   └── kubilitics-ai-server                      ← Go, binds :50051 gRPC + :28081 HTTP
└── Contents/Resources/assets/
```

Tauri spawns both sidecars on launch, health-checks `/health` + `nc -z 50051`, blocks UI until ready, SIGTERMs on quit.

### Pages in 1.1.0 — all six enabled + QA'd

1. **Cluster picker** (sidebar)
2. **Dashboard**
3. **Topology**
4. **AI Chat** (the hero view)
5. **Simulation**
6. **Reports**
7. **Auto-Pilot**
8. **Settings** (gear icon, always accessible)

Pages remain re-orderable / hideable by the user, but default nav shows all. **Nothing hidden behind a beta flag.**

### Provider-agnostic commitment

Zero hardcoded vendor references in binary, README, or default config. Settings lists four options in alphabetical order:

| Provider | Default `base_url` | Default model placeholder |
|---|---|---|
| Anthropic | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-latest` |
| Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenAI-compatible (custom) | *blank* | *blank* |

Together.ai / Groq / Fireworks / DeepSeek / self-hosted LiteLLM all work through the "custom" option.

---

## Section 2 — First-time user journey

1. Download DMG / MSI / AppImage from `github.com/vellankikoti/kubilitics/releases/latest`
2. Install. First launch → Gatekeeper / SmartScreen pass (signed + notarized)
3. Sidecars spawn. Splash clears. Sidebar populates from `~/.kube/config`
4. Chat panel shows empty-state: *"Configure an LLM provider to start chatting."* → **[ Open Settings ]**
5. Settings → AI Providers → dropdown + form → **[ Test connection ]** → green ✓ auto-saves
6. Chat works. Stream tool calls. Read answer. Switch clusters. Settings persist on restart.

Failure modes surfaced explicitly: no clusters / provider unreachable / key rejected / budget exceeded — each with a direct action link.

**Explicitly NOT in the first-run flow:** onboarding wizard, sample-prompt autocompletions, telemetry opt-in, cost estimates.

---

## Section 3 — Provider-agnostic config

### Config file — `~/Library/Application Support/kubilitics/config.yaml` (per-OS equivalent)

```yaml
llm:
  provider: openai
  openai:
    base_url: https://api.openai.com/v1
    api_key_env: KUBILITICS_LLM_API_KEY      # NAME of env var
    model: gpt-4o-mini
  tool_router:
    enabled: true
  budget:
    max_usd: 0
  max_turns: 20

backend:
  http_base_url: http://localhost:8190
  grpc_port: 50061

clusters:
  kubeconfig_path: ~/.kube/config
```

### Key handling — three-layer hygiene

1. Key never written to `config.yaml`. Stored in **OS Keychain** (macOS Keychain / Windows Credential Manager / Linux `libsecret`)
2. On process start, brain reads key and sets env var `KUBILITICS_LLM_API_KEY` for its own process only — never exported to user shell
3. Key never logged. "Test connection" errors redact any displayed response body (regex strips `sk-\w+` / `Bearer \w+`)

### Env override for CI / headless

Any YAML field overridable via `KUBILITICS_LLM_PROVIDER`, `KUBILITICS_LLM_OPENAI_BASE_URL`, etc. If `KUBILITICS_LLM_API_KEY` is set in env, keychain is bypassed.

---

## Section 4 — Ship-blocker bug fixes

All must pass. Each has a regression test.

| Blocker | Root cause | Fix | Estimate |
|---|---|---|---:|
| A — Sidebar "0s" recurrence | `/summary` 5xx, frontend didn't distinguish loading / error / real zero | Verify `kubilitics@10848cf` defense-in-depth caches still on release branch; port forward if missing | 1 h |
| B — Cluster switch race | Zustand stores don't invalidate on cluster-ID change | Add `cluster-switch` event bus, stores subscribe + clear slice | 4 h |
| C — AI Settings persist + reload | Keychain round-trip gaps | Round-trip test: save → restart app → chat works without re-type | 3 h |
| D — Auto-update (broken) | Updater shows "available" before assets exist | Proper implementation: static `.latest.json` on releases host, signed ed25519 manifest, in-app banner, one-click install | 8 h |
| E — Chat regressions | None currently known (99/100 on bench) | Smoke-test post-fix, sign off | 1 h |
| F — Tauri sidecar wiring | Brain not in `externalBin` today | Add `kubilitics-ai-server` to `externalBin`, Rust spawn + health-check + SIGTERM path | 6 h |
| G — Code signing | Apple Developer already active, Windows cert needed | Reuse existing `APPLE_*` secrets in `release.yml`; purchase EV cert for Windows (~$200/yr) | 3 h + cert lead time |

**Total Section 4: ~26 h.**

---

## Section 5 — Release packaging (uses existing infrastructure)

Existing `release.yml` is 25 KB with version-consistency check across 6 files, Apple signing + `notarytool` already wired. Deltas only:

### Delta 1 — Add brain to sidecars (2 h)
`tauri.conf.json` + matching cross-compile build step for `darwin-amd64` / `darwin-arm64`.

### Delta 2 — Windows + Linux builds (9 h)
Matrix expand `release.yml`: `windows-2022` + `ubuntu-22.04` runners. Windows signing via purchased cert. Linux AppImage + `.deb` + `.rpm`.

### Delta 3 — Proper auto-update (8 h, overlaps Blocker D)
- `.latest.json` hosted at `https://releases.kubilitics.io/latest.json`
- Signed via ed25519 key (Tauri native updater format)
- In-app banner: "1.1.1 available · [ Update & restart ]"
- Tested on a fresh-install before publishing

### Delta 4 — Version bumps across 6 files (15 min, automated)
`scripts/bump-version.sh 1.1.0` updates:
- `kubilitics-frontend/package.json`
- `kubilitics-desktop/src-tauri/tauri.conf.json`
- `kubilitics-desktop/src-tauri/Cargo.toml`
- `deploy/helm/kubilitics/Chart.yaml` (× 2: `version` + `appVersion`)
- `deploy/helm/kubilitics/values.yaml` (`image.tag`)

### Delta 5 — Release hygiene (2 h)
- `CHANGELOG.md` for 1.1.0: tool router + 27 inspect composites + 6 gap aggregators + 50 new tools + LLM-judge + bug fixes A–G + auto-update + multi-platform builds
- `README.md` update: "Kubilitics is an AI copilot for Kubernetes" framing, provider-agnostic quickstart
- `KNOWN_ISSUES.md` for anything discovered during smoke test

### Delta 6 — Homebrew tap (1 h)
`brew tap vellankikoti/kubilitics` + formula emitting the macOS DMG.

**Total Section 5: ~22 h.**

---

## Section 6 — Work packages (full scope, not deferred)

Batched so agents can execute in parallel.

### Package A — Backend completeness (10 h)
- Patch 1: `/metrics/summary` unscoped aggregate + caching (2 h)
- Patch 3: `/ingresses/{ns}/{name}/tls-info` subresource + x509 parser (2 h)
- Cosmetic: `handlers_gaps.go:265` `changeCause` camelCase reader (30 min)
- gRPC + REST simultaneous binding (port-conflict fix) (3 h)
- Integration tests: every new tool has a live test (2 h)

### Package B — AI robustness (15 h)
- Retries with exp-backoff on 503/429 (2 h)
- Rate-limit: honor `Retry-After` on OpenAI/Anthropic (2 h)
- Session persistence via SQLite on app restart (3 h)
- Multi-cluster session isolation (3 h)
- Cluster-switch race fix (Blocker B) (3 h)
- Budget enforcement live + UI surface (2 h)

### Package C — Tool layer completion (30 h)
- 50 new tools from `new-tools-plan.md`, batched 10 per category: observability, diagnostics, planning, security/compliance, narrative
- Plain-English descriptions for all 183 tools
- Tool catalog UI in Settings

### Package D — LLM-as-judge bench (8 h)
- `cmd/chat-quality-bench/judge.go` — rubric: factual / completeness / clarity / tool-use appropriateness, 1–5 per axis
- Report renders both pass/fail gate + judge score per prompt
- Release gate: judge-mean ≥ 4.0 on incident-scenarios-100

### Package E — Page QA sweep (40 h, parallelizable)
Per-page: functional test + bug fix + release-notes screenshot. Per-page budget: ~5 h average.
- Dashboard, Topology, Simulation, Reports, Auto-Pilot, Advisor, Cost, Security, Observability
- Navigation consistency across all pages

### Package F — Release infrastructure (20 h)
- Proper auto-update (Blocker D + Delta 3) — 8 h
- Windows build + signing — 6 h
- Linux AppImage + deb + rpm — 3 h
- Homebrew tap — 1 h
- CHANGELOG + release-notes automation — 2 h

### Package G — Final QA + ceremony (10 h)
- Fresh-install smoke test on clean macOS + Windows + Linux VMs
- Bench `incident-scenarios-100` × 3 providers (Ollama, OpenAI, Anthropic) — ≥95/100 each
- Tag push, CI watch, GitHub release publish
- Sunset `kubilitics/kubilitics@v1.0.0` (README deprecation, issues disabled, install URL redirects)

**Total Section 6: ~133 h ≈ 10–14 calendar days with parallel agent execution.**

---

## Section 7 — Testing plan

### Tier 1 — CI (every commit to `release/v1.1.0`)

- `go build ./...` — backend + brain clean
- `npm run build` + `cargo build --release`
- Unit tests, zero skipped
- **Privacy guardrails — 7 tests in `internal/mcp/server/privacy_test.go`**. Ship-blocker.
- Bench `incident-scenarios-100` against CI Ollama sidecar — ≥ 90%

### Tier 2 — Three-provider bench (user-gated)

`incident-scenarios-100` × (Ollama `qwen2.5:32b`, OpenAI `gpt-4o-mini`, Together.ai `llama-3.3-70B-Instruct-Turbo`). Each must hit:
- **Bench gate ≥ 95/100**
- **LLM-judge mean ≥ 4.0**

Total provider cost per full test run: ~$2.

### Tier 3 — Fresh-install smoke (mandatory, all 3 platforms)

On clean OS VM:
1. Download artifact from GitHub Release (not local build)
2. Install, launch, Gatekeeper/SmartScreen passes
3. Sidecars spawn within 5 s
4. Sidebar populates
5. Settings → provider config → test connection passes
6. Run all 20 incident-scenarios-20 prompts live; all return real answers
7. Cluster switch + one-prompt repro
8. Kill app → re-open → settings + session persist
9. Auto-update banner appears when `.latest.json` bumped
10. Activity Monitor clean after quit — no zombie sidecars

### Rollback plan

P0 bug in first 24 h:
- Delete GitHub Release (unpublished, artifacts stay)
- Homebrew tap reverted
- `.latest.json` stays at 1.0.x (no in-flight users upgrade into broken)
- Fix on `hotfix/v1.1.1`, repeat from bump

---

## Explicit rejections (never shipping)

- Telemetry / analytics. No phone-home.
- Tool marketplace / plugin store.
- Auto-remediation / autonomous destructive actions.
- Provider "recommendations" / vendor affiliations.
- AI-budget subscription features. Users pay their provider directly.

---

## Cut line

> *"Kubilitics 1.1.0 is a three-platform desktop app that lets you chat with your Kubernetes cluster using any LLM you bring, with auto-update, signed binaries, and a passing three-provider bench."*

Anything not in that sentence is out.

## Total budget

**133 hours. ~2 weeks calendar with 2–3 parallel agent streams. First robust stable release.**
