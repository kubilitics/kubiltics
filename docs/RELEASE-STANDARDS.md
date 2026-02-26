# Kubilitics Release Standards

This document is the single source of truth for how every release is prepared, validated, and shipped. Follow it exactly — every deviation is a potential CI failure or security gap.

---

## Table of Contents

1. [Pre-Release Gate: What Must Pass](#1-pre-release-gate-what-must-pass)
2. [Versioning Rules](#2-versioning-rules)
3. [Dependency Management Rules](#3-dependency-management-rules)
4. [CI Workflow Rules](#4-ci-workflow-rules)
5. [Step-by-Step Release Procedure](#5-step-by-step-release-procedure)
6. [Post-Release Checklist](#6-post-release-checklist)
7. [Known Pitfalls & Permanent Fixes Applied](#7-known-pitfalls--permanent-fixes-applied)
8. [Hotfix Releases](#8-hotfix-releases)
9. [Rollback a Release](#9-rollback-a-release)
10. [Dependabot Maintenance Rules](#10-dependabot-maintenance-rules)

---

## 1. Pre-Release Gate: What Must Pass

**Nothing gets tagged until every item below is green, locally, on the release author's machine.**

| Check | Command | Pass Condition |
|---|---|---|
| Backend build | `cd kubilitics-backend && go build -o bin/kubilitics-backend ./cmd/server` | Zero errors |
| kcli build | `cd kcli && CGO_ENABLED=0 go build -o bin/kcli ./cmd/kcli` | Zero errors |
| Frontend build | `cd kubilitics-frontend && npm run build` | Zero errors (warnings OK) |
| Backend tests | `cd kubilitics-backend && go test -count=1 ./...` | All packages `ok` |
| kcli tests | `cd kcli && go test -count=1 -timeout=120s ./...` | All packages `ok` |
| Frontend unit tests | `cd kubilitics-frontend && npm run test` | All tests pass |
| Backend govulncheck | `cd kubilitics-backend && govulncheck ./...` | No vulnerabilities |
| go vet (backend) | `cd kubilitics-backend && go vet ./...` | Zero issues |
| go vet (kcli) | `cd kcli && go vet ./...` | Zero issues |

> **govulncheck installation:** `go install golang.org/x/vuln/cmd/govulncheck@latest`
>
> Run them all at once with `make test` then check govulncheck separately.

---

## 2. Versioning Rules

We use [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

| Change type | Version bump | Example |
|---|---|---|
| Bug fix / security patch / test fix | PATCH | `0.1.0` → `0.1.1` |
| New backward-compatible feature | MINOR | `0.1.1` → `0.2.0` |
| Breaking API or behaviour change | MAJOR | `0.2.0` → `1.0.0` |

**Rules:**
- Tags are always annotated (`git tag -a`), never lightweight.
- Tags are always prefixed with `v` — e.g. `v0.1.1`.
- Tags must point to a commit that is already on `main`.
- Never reuse or force-push an existing tag. Delete and recreate only if the tag was never pushed to any remote.
- If a tag was pushed, create a new PATCH version instead.

**Version strings to update on every release:**

| File | Field | Example |
|---|---|---|
| `kubilitics-frontend/package.json` | `"version"` | `"0.1.1"` |
| `CHANGELOG.md` | New section heading | `## [v0.1.1] - 2026-02-26` |
| Git tag | Annotated tag | `v0.1.1` |

---

## 3. Dependency Management Rules

### 3.1 Go dependencies (backend + kcli)

- **Never ignore `govulncheck` failures.** If it reports a vulnerability, the dependency must be patched before tagging.
- Update vulnerable deps with: `go get <module>@<patched-version> && go mod tidy`
- After bumping, always run the full test suite — major transitive upgrades (e.g. k8s.io/*, helm.sh/helm/v3) can break API signatures.
- Commit both `go.mod` and `go.sum`.

### 3.2 npm dependencies (frontend)

- `npm audit` must show no high/critical vulnerabilities before release.
- Use `npm audit fix` for auto-fixable issues. For manual fixes, pin the package to a safe version in `package.json`.

### 3.3 Dependabot hygiene

- Dependabot entries must only reference **directories that exist** in the repository.
- When removing a component (e.g. `kubilitics-desktop`, `kubilitics-mobile`), immediately remove the corresponding entry from `.github/dependabot.yml` in the same PR.
- Review and merge security-related Dependabot PRs within **48 hours**.

> **Why this matters:** A Dependabot entry for a missing directory causes every Dependabot run to fail with a `file not found` error, polluting CI history.

---

## 4. CI Workflow Rules

### 4.1 Cross-platform shell commands

**Never use Unix inline env-var syntax in steps that run on Windows:**

```yaml
# WRONG — fails in PowerShell (Windows runners)
- run: CGO_ENABLED=0 go build ./...

# CORRECT — use the YAML env: block; works on all platforms
- env:
    CGO_ENABLED: "0"
  run: go build ./...
```

Applies to any step whose `runs-on` includes `windows-latest` or `windows-*`.

### 4.2 Sandbox / unshare tests on Linux CI

GitHub Actions Linux runners (`ubuntu-latest`) block unprivileged user namespace creation (`unshare --user`) by default via kernel sysctl. Any test that exercises the Linux plugin sandbox **must** probe for this capability at runtime and skip gracefully:

```go
// In test files, use this pattern before calling any sandboxed execution:
if runtime.GOOS == "linux" && !unshareAvailable() {
    t.Skip("unprivileged user namespaces not available on this runner; skipping sandbox execution test")
}
```

Where `unshareAvailable()` is:
```go
func unshareAvailable() bool {
    path, err := exec.LookPath("unshare")
    if err != nil { return false }
    return exec.Command(path, "--user", "--map-root-user", "true").Run() == nil
}
```

**Rule:** Any test that would call `unshare`, `sandbox-exec`, or any OS-level isolation primitive must guard with the appropriate skip. Look at `kcli/internal/plugin/sandbox_test.go` for the established pattern.

### 4.3 Workflow file maintenance

- When adding a new module/component, add a corresponding workflow under `.github/workflows/`.
- When removing a module/component, remove its workflow and any Dependabot entries in the **same commit**.
- Go version across all workflows must stay in sync. The canonical version lives in `backend-ci.yml` under `env.GO_VERSION`. Copy it to all other workflows that build Go code.
- Use `continue-on-error: true` only for steps that are explicitly optional (e.g. integration tests requiring a live cluster). Never for unit tests or builds.

---

## 5. Step-by-Step Release Procedure

```
VERSION=0.1.2    # set this first, no "v" prefix
```

### Step 1 — Sync local main

```bash
git checkout main
git pull origin main
```

### Step 2 — Run the full pre-release gate (Section 1)

```bash
# Backend
cd kubilitics-backend
go build -o bin/kubilitics-backend ./cmd/server
go test -count=1 ./...
go vet ./...
govulncheck ./...
cd ..

# kcli
cd kcli
CGO_ENABLED=0 go build -o bin/kcli ./cmd/kcli
go test -count=1 -timeout=120s ./...
go vet ./...
cd ..

# Frontend
cd kubilitics-frontend
npm run build
npm run test
npm audit
cd ..
```

All must pass. Fix failures before continuing.

### Step 3 — Bump version strings

```bash
# Frontend package.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" kubilitics-frontend/package.json
grep '"version"' kubilitics-frontend/package.json   # verify
```

### Step 4 — Update CHANGELOG.md

Add a new section above the previous `[Unreleased]` content:

```markdown
## [v0.1.2] - YYYY-MM-DD

### Fixed
- …

### Added
- …

### Changed
- …
```

### Step 5 — Stage and commit

```bash
git add -A
git status   # review — ensure no secrets, binaries, or build artifacts
git commit -m "chore: release v${VERSION}

<summary of changes>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### Step 6 — Create annotated tag

```bash
git tag -a "v${VERSION}" -m "Release v${VERSION}

<2-3 sentence summary of what changed>"
```

### Step 7 — Confirm the tag points to HEAD

```bash
git log --oneline -1
git show "v${VERSION}" --stat | head -5
```

Both should show the same commit hash.

### Step 8 — Push branch then tag

```bash
git push origin main
git push origin "v${VERSION}"
```

> The tag push triggers the GitHub Actions **Release** workflow which builds and attaches artifacts.

### Step 9 — Verify CI

- Go to **Actions → Release** on GitHub and confirm the workflow is running.
- Wait for it to complete green.
- Go to **Releases** and confirm the release was created with the correct artifacts.

---

## 6. Post-Release Checklist

- [ ] GitHub Release page has the correct tag and description
- [ ] All CI workflows (Backend CI, kcli CI, Release) are green
- [ ] `CHANGELOG.md` `[Unreleased]` section is cleared/reset for the next cycle
- [ ] Dependabot PRs for the release are reviewed and merged or closed
- [ ] Announce the release (GitHub Discussions / Discord / etc.)

---

## 7. Known Pitfalls & Permanent Fixes Applied

This section documents every recurring failure we've encountered and what was done to fix it permanently. **Read this before reporting a CI failure.**

---

### P-01: `CGO_ENABLED=0` fails on Windows PowerShell runners

**Symptom:**
```
CGO_ENABLED=0: The term 'CGO_ENABLED=0' is not recognized ...
```

**Root cause:** Unix inline `VAR=value command` syntax is not valid PowerShell. GitHub Actions Windows runners use PowerShell 7 by default.

**Fix applied:** `.github/workflows/kcli-ci.yml` — Windows build step now uses the YAML `env:` block:
```yaml
- name: Build Windows binary
  env:
    CGO_ENABLED: "0"
  run: go build -ldflags="-s -w" -o kcli.exe ./cmd/kcli
```

**Rule:** Any step that sets env vars inline and runs on `windows-*` must be converted to use `env:`.

---

### P-02: `unshare --user` fails on GitHub Actions Linux runners

**Symptom:**
```
unshare: write failed /proc/self/uid_map: Operation not permitted
--- FAIL: TestTryRunForArgsUsesManifestCommandAlias
```

**Root cause:** GitHub Actions `ubuntu-latest` runners disable unprivileged user namespace creation. The Linux plugin sandbox uses `unshare --user` to isolate plugins. Tests that invoke this path fail unconditionally on CI.

**Fix applied:** `kcli/internal/plugin/plugin_test.go` — added `unshareAvailable()` probe and `t.Skip()` guard on all tests that invoke sandboxed plugin execution.

**Rule:** Every test that exercises `unshare`, `sandbox-exec`, or any OS-level isolation must call `unshareAvailable()` / check for the tool's availability before running. See Section 4.2 for the canonical pattern.

---

### P-03: `govulncheck` fails on containerd / helm.sh/helm/v3

**Symptom (v0.1.0 → v0.1.1):**
```
Vulnerability #1: GO-2025-4108 (containerd v1.7.23, host memory exhaustion)
Vulnerability #2: GO-2025-4100 (containerd v1.7.23, local privilege escalation)
Vulnerability #3: GO-2025-3888 (helm.sh/helm/v3 v3.16.3, panic via invalid YAML)
Vulnerability #4: GO-2025-3887 (helm.sh/helm/v3 v3.16.3, memory exhaustion)
```

**Fix applied:** `kubilitics-backend/go.mod` — bumped:
- `github.com/containerd/containerd` `v1.7.23` → `v1.7.29`
- `helm.sh/helm/v3` `v3.16.3` → `v3.18.5`

**Rule:** Run `govulncheck ./...` in `kubilitics-backend` before every release. If any HIGH or CRITICAL vulnerability is reported, the release is **blocked** until the dependency is patched.

---

### P-04: Dependabot targeting a deleted directory

**Symptom:**
```
ERROR: /kubilitics-desktop/Cargo.toml not found
Dependabot encountered an error performing the update
```

**Root cause:** `kubilitics-desktop` and `kubilitics-mobile` were removed from the repo, but `.github/dependabot.yml` still listed them as `cargo` ecosystem targets.

**Fix applied:** `.github/dependabot.yml` — removed the `cargo` entry for `/kubilitics-desktop`.

**Rule:** When any directory that owns a Dependabot entry is deleted, update `dependabot.yml` in the **same PR**. See Section 10.

---

### P-05: Nil pointer panic in `ExecuteUpgrade` when `clusterService` is nil

**Symptom:**
```
panic: runtime error: invalid memory address or nil pointer dereference
addon_service_impl.go:464
```

**Root cause:** `AddOnServiceImpl.ExecuteUpgrade` called `s.clusterService.GetClient()` unconditionally. In tests and standalone binary mode, `clusterService` is injected as `nil`.

**Fix applied:** `kubilitics-backend/internal/service/addon_service_impl.go` — added nil guard; the velero backup block is now skipped when `clusterService` is nil.

---

### P-06: Registry community addon ID mismatch in tests

**Symptom:**
```
expected: "community/p1"
actual:   "community/repo/test-pkg1"
```

**Root cause:** Production code changed the community addon ID format from `community/<packageID>` to `community/<repoName>/<chartName>` (needed for ArtifactHub URL routing), but test assertions were not updated.

**Fix applied:** `kubilitics-backend/internal/addon/registry/catalog_test.go` — updated test assertions to match the `community/<repo>/<chart>` format.

---

### P-07: Docker build fails — `go.mod requires go >= 1.25.0 (running go 1.24.x; GOTOOLCHAIN=local)`

**Symptom:**
```
go: go.mod requires go >= 1.25.0 (running go 1.24.2; GOTOOLCHAIN=local)
ERROR: failed to build: failed to solve: process "/bin/sh -c go mod download" did not complete successfully
```

**Root cause:** The Dockerfile sets `ENV GOTOOLCHAIN=local` which prevents auto-downloading a newer Go toolchain. When `kcli/go.mod` requires `go 1.25.0` (driven by `k8s.io/api v0.35.0` which requires Go ≥1.25.0), any Docker builder pinned to an older Go image fails at `go mod download`.

**Fix applied:** `kubilitics-backend/Dockerfile` — bumped `ARG GO_VERSION=1.24.2` → `1.25.0`. Updated `backend-ci.yml` and `kcli-ci.yml` to use `GO_VERSION: '1.25.0'`.

**Rule — Go version alignment:** The `ARG GO_VERSION` in the Dockerfile and `GO_VERSION` in all CI workflows **must** be ≥ the highest `go` directive across all modules built in that Docker image:

| Module | go.mod directive |
|---|---|
| `kubilitics-backend/go.mod` | `go 1.24.0` |
| `kcli/go.mod` | `go 1.25.0` ← controls the minimum |

**Whenever you bump a dependency that raises a module's `go` directive, update:**
1. `kubilitics-backend/Dockerfile` → `ARG GO_VERSION`
2. `.github/workflows/backend-ci.yml` → `env.GO_VERSION`
3. `.github/workflows/kcli-ci.yml` → `go-version`

Check current module go directives with:
```bash
grep "^go " kubilitics-backend/go.mod kcli/go.mod
```

Also update `ARG KUBECTL_VERSION` in the Dockerfile whenever `k8s.io/client-go` major version changes:
- `k8s.io/client-go v0.31.x` → `kubectl v1.31.x`
- `k8s.io/client-go v0.33.x` → `kubectl v1.33.x`
- `k8s.io/client-go v0.35.x` → `kubectl v1.35.x`

**govulncheck also flags stdlib CVEs** (e.g. `net/url`, `crypto/tls`, `archive/tar`) that require a Go patch release upgrade — not just a dependency bump. When govulncheck reports `Fixed in: go1.25.X`, bump `ARG GO_VERSION` (and CI `go-version`) to that patch level. Current pin: `go1.25.7` (fixes 10 CVEs from GO-2025-4010 through GO-2026-4341).

---

### P-08 — Blocking subprocess calls in watch loops cause CI test timeouts

**Symptom:** `TestIncidentWatchContextCancellation` (or similar watch-loop tests) fails with:
```
incident --watch did not exit within 2s after context cancellation
--- FAIL: TestIncidentWatchContextCancellation (2.00s)
```

**Root cause:** The watch loop calls `buildIncidentReport` → `fetchPods` / `fetchNodes` / `fetchEvents`, which each launch kubectl as an `exec.Command` subprocess. Without context, the subprocess blocks until kubectl times out on its own (which on a GHA runner with no cluster can take many seconds), so the watch loop cannot detect context cancellation until after the test deadline.

**Fix applied:** Added `runner.CaptureKubectlCtx(ctx, args)` (uses `exec.CommandContext`) and wired `context.Context` through the entire call chain:
- `fetchPods(ctx, a)`, `fetchNodes(ctx, a)`, `fetchEvents(ctx, a)`
- `buildIncidentReport(ctx, a, window, threshold)` and all callers
- `fetchPodHealthSummary(ctx, a)`, `fetchNodeHealthSummary(ctx, a)`

When the watch loop's context is cancelled, the kubectl subprocess is killed immediately (typically sub-250ms). Test deadline also widened from 2s → 10s as belt-and-suspenders.

**Rule:** Any function that spawns `kubectl` as a subprocess and is called from a watch loop or background goroutine **must** accept `context.Context` and use `exec.CommandContext` (or `runner.CaptureKubectlCtx`). Never use `exec.Command` for subprocess calls that can outlive their caller.

---

## 8. Hotfix Releases

Use when `main` has diverged and a critical fix is needed on an older release:

```bash
HOTFIX_VERSION=0.1.2
BASE_TAG=v0.1.1

git checkout -b hotfix/v${HOTFIX_VERSION} ${BASE_TAG}
# apply minimal fix only
# follow Steps 2–9 from Section 5
git checkout main
git merge hotfix/v${HOTFIX_VERSION}
git branch -d hotfix/v${HOTFIX_VERSION}
```

---

## 9. Rollback a Release

GitHub does not allow deleting releases in public repos without admin access. If a release contains a critical bug:

1. Mark the GitHub Release as **Pre-release** immediately to reduce visibility.
2. Cut a hotfix PATCH release (Section 8) as quickly as possible.
3. Edit the bad release's description to add a deprecation notice pointing to the hotfix.
4. **Never** delete a pushed tag — it may be cached in users' environments.

---

## 10. Dependabot Maintenance Rules

| Rule | Detail |
|---|---|
| Add entry when adding module | Every new directory with a `go.mod`, `package.json`, or `Cargo.toml` needs a Dependabot entry |
| Remove entry when removing module | Must happen in the same commit that deletes the directory |
| Review security PRs within 48h | Security patches should not wait for the weekly batch window |
| Merge minor/patch PRs via batch | Dependabot groups them by ecosystem — merge the grouped PR, not individual ones |
| Don't auto-merge major bumps | Always review breaking changes before merging |

**Current Dependabot targets (as of v0.1.1):**

| Ecosystem | Directory | Cadence |
|---|---|---|
| `gomod` | `/kubilitics-backend` | Weekly (Monday 09:00) |
| `gomod` | `/kubilitics-ai` | Weekly (Monday 09:00) |
| `npm` | `/kubilitics-frontend` | Weekly (Monday 09:00) |
| `github-actions` | `/` | Weekly (Monday 09:00) |

---

## Quick Reference Card

```
# Before EVERY release — run this sequence:
cd kubilitics-backend && go build ./cmd/server && go test -count=1 ./... && govulncheck ./... && cd ..
cd kcli && go build ./cmd/kcli && go test -count=1 -timeout=120s ./... && cd ..
cd kubilitics-frontend && npm run build && npm run test && npm audit && cd ..

# Version bump:
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" kubilitics-frontend/package.json
# + update CHANGELOG.md

# Tag & push:
git add -A && git commit -m "chore: release v${VERSION}"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin main && git push origin "v${VERSION}"
```

> See [`docs/release-steps.md`](release-steps.md) for the full step-by-step walkthrough.
> See [`docs/RELEASE-PROCESS.md`](RELEASE-PROCESS.md) for CI/CD pipeline architecture details.
