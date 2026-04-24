# Monorepo migration plan — `kotg.ai` → `kubilitics`

**Date:** 2026-04-24
**Status:** Plan only. Execute in a dedicated session on a quiet weekend — do **not** run mid-sprint.
**Author notes:** Assumes no active PRs on `vellankikoti/kotg.ai` other than the ones listed in §2.1. Holds only if that's true at execution time.

---

## 1. Why

Three repos today carry tightly-coupled code that ships together:

- `vellankikoti/kubilitics` — desktop app (backend + frontend + Tauri + helm)
- `vellankikoti/kotg.ai` — AI brain (toolserver + gateway + agents)
- `vellankikoti/kotg-schema` — proto wire contract (importable library)

**Observed friction** (2026-04-23 to 2026-04-24 session):
- Week-1 inspect refactor needed taxonomy change in `kotg.ai` **AND** dispatch wiring **AND** integration tests. All three couldn't live in a single PR because they straddle the two repos.
- Bench harness lives in `kotg.ai` but needs `kubilitics-backend` binary from the other repo; ~200 LOC of orchestration in `scripts/run-merge-gate.sh` exists purely to bridge that gap.
- Cross-repo coordination: `proxy.golang.org` caching issues when `kotg-schema` bumps, forcing fast-follow patch tags.
- Directory-naming confusion on dev machine (`kotg.ai/` was a misclone of kubilitics during this session).

**Key insight** from scoping this plan: **kubilitics-backend does not import `kotg.ai` Go packages — only `kotg-schema`.** The brain is a separate binary that the backend dials over gRPC. So consolidating the two git repos has **zero** Go-import blast radius on the backend side; the migration is mechanical code relocation, not semantic change.

## 2. End state

```
vellankikoti/kubilitics/               ← MONOREPO
├── kubilitics-backend/                (unchanged)
├── kubilitics-frontend/               (unchanged)
├── kubilitics-desktop/                (unchanged)
├── brain/                             ← moved from kotg.ai/kotg-ai/kotg-toolserver
│   ├── cmd/server/                      (the brain binary = kubilitics-ai)
│   ├── cmd/chat-quality-bench/
│   ├── cmd/bench-report/
│   ├── internal/mcp/                    (183 MCP tools after Week 1)
│   ├── internal/triage/                 (Week 1)
│   ├── internal/logpattern/             (Week 1)
│   ├── deploy/helm/                     (brain Helm chart)
│   └── go.mod                           (module: github.com/vellankikoti/kubilitics/brain)
├── gateway/                           ← moved from kotg.ai/kotg-ai/kotg-gateway (if active)
├── charts/                            (merged: kubilitics-otel + kubilitics-agent + new brain chart)
├── deploy/                            (merged release automation)
├── docs/
│   └── strategy/                      (this doc + Week-N roadmap + specs)
└── scripts/
    └── run-merge-gate.sh              ← moved from kotg.ai/scripts

vellankikoti/kotg-schema               ← UNCHANGED (stays separate; importable library)
vellankikoti/homebrew-kubilitics       ← UNCHANGED (distribution channel)
vellankikoti/kotg.ai                   ← ARCHIVED with redirect README
```

### 2.1 Gating pre-work

Before starting: close out everything in-flight on `kotg.ai`.

- [ ] Merge PR [#7 Week-1 inspect-completion](https://github.com/vellankikoti/kotg.ai/pull/7) (after bench gate passes).
- [ ] Merge any open Dependabot PRs on kotg.ai (last check: 14 open — most are transitive).
- [ ] Tag a final release: `git tag -a v0.9.0-final -m "Final release before monorepo migration" && git push --tags`.
- [ ] Take a bare-mirror backup: `git clone --mirror https://github.com/vellankikoti/kotg.ai.git kotg.ai-backup.git && tar czf kotg.ai-pre-migration-backup.tar.gz kotg.ai-backup.git`. Store in S3 or similar offsite. This is the "oh shit" rollback artifact.

## 3. Migration phases

**Estimated wall-clock: 4–6 hours of migration + ~2 hours of smoke-gate runtime (6 runs × ~20 min) for an experienced operator.** Each phase is individually committable and reversible.

**Smoke gate between every phase.** A regression on any of the 10 critical UI flows halts the migration and forces rollback of the last phase. See [`docs/testing/2026-04-24-ui-smoke-harness.md`](../testing/2026-04-24-ui-smoke-harness.md) for the full flow list and pass/fail contract.

**Baseline (run ONCE before Phase A):** capture all 10 flows on pre-migration main, save to `docs/testing/baselines/2026-04-24-pre-migration/`. Every subsequent phase run diffs against this.

### Phase A — Prepare target tree (~30 min)

Purpose: bring `kotg.ai` content into `kubilitics` with full history preserved. Nothing else breaks during this phase.

```bash
cd /path/to/kubilitics          # the target monorepo, currently at main @ c0b2b4a
git checkout -b migrate/monorepo-consolidation

# Add the brain subtree. This creates a commit that embeds the full history
# of kotg.ai under kubilitics/brain/ — `git log --follow kubilitics/brain/...`
# will walk back through the original kotg.ai commits.
git subtree add --prefix=brain \
    https://github.com/vellankikoti/kotg.ai.git main

# At this point brain/ contains the whole kotg.ai tree. Pare it down.
cd brain/
# Keep only these subprojects; everything else can live in the archived kotg.ai.
# kubilitics-ai/ holds the brain + bench. The -layer, -agents, -agent, -frontend-business
# subprojects are experimental and can be reintroduced later from the archived repo.
for d in kotg-agent kotg-agents kotg-ai-layer kotg-frontend-business kotg-gateway; do
    [ -d "$d" ] && git rm -r "$d"
done
# Flatten: move kubilitics-ai/* to brain/* (top-level).
mv kubilitics-ai/* kubilitics-ai/.[!.]* . 2>/dev/null || true
rmdir kubilitics-ai
cd ..
git add -A
git commit -m "migrate: bring kotg.ai/kubilitics-ai subtree into brain/"
```

**Rollback at end of Phase A:** `git reset --hard origin/main && git branch -D migrate/monorepo-consolidation`. Nothing has been pushed.

**→ Smoke gate Phase A.** Run [UI smoke harness](../testing/2026-04-24-ui-smoke-harness.md) (~20 min). Phase A only adds a subtree — the desktop + backend shouldn't care. Expect all 10 flows GREEN. If any RED: something about the subtree add broke module resolution or file visibility; investigate + rollback.

### Phase B — Fix Go module path (~1–2 hours)

Purpose: rename the brain's module so its in-monorepo path is coherent.

```bash
cd brain/

# 1. Change go.mod module name.
# Old: github.com/vellankikoti/kotg.ai/kubilitics-ai
# New: github.com/vellankikoti/kubilitics/brain
go mod edit -module github.com/vellankikoti/kubilitics/brain

# 2. Rewrite all internal import statements. Scope: only brain/ — the rest of
# the monorepo never imported kotg.ai code (verified via grep).
OLD='github.com/vellankikoti/kotg.ai/kubilitics-ai'
NEW='github.com/vellankikoti/kubilitics/brain'
# macOS sed requires -i ''
find . -name '*.go' -type f -exec sed -i '' "s|$OLD|$NEW|g" {} \;

# 3. Verify nothing references the old path anywhere in the monorepo.
(cd .. && grep -rn "$OLD" --include='*.go' --include='go.mod' --include='go.sum' . || echo "ok: no references")

# 4. Rebuild + run brain tests.
go mod tidy
go build ./...
go test ./... -count=1

# 5. Verify kubilitics-backend still builds (it only imports kotg-schema,
# so this should be a no-op, but sanity-check).
(cd ../kubilitics-backend && go build ./... && go test ./internal/ai/... -count=1)

git add -A
git commit -m "migrate: rename module path to github.com/vellankikoti/kubilitics/brain"
```

**Rollback at end of Phase B:** `git reset --hard HEAD~2` then go back to main. Still local only.

**→ Smoke gate Phase B.** Module path changes don't affect the running desktop (brain binary's internal Go paths are invisible to the UI). Expect all 10 flows GREEN. If Flow 9 (AI chat) RED: the brain was rebuilt with a bad module path and the backend can't dial it. Check `lsof -iTCP:50051` for the brain process; check brain logs for import errors.

### Phase C — Merge workflows + configs (~1 hour)

Purpose: relocate `.github/workflows/` entries from `kotg.ai` into the monorepo, add path filters, make sure the brain has its own CI leg.

```bash
# 1. Copy brain's CI workflows with path scoping.
cd brain/
# Existing workflows from kotg.ai that we want:
#   .github/workflows/buf-ci.yml       (proto linting)
#   .github/workflows/chat-quality-bench.yml
#   .github/workflows/go-ci.yml
# Move them to the monorepo root with path filters.
cd ..
mkdir -p .github/workflows
for wf in buf-ci go-ci chat-quality-bench; do
    src="brain/.github/workflows/${wf}.yml"
    dst=".github/workflows/brain-${wf}.yml"
    [ -f "$src" ] || continue
    cp "$src" "$dst"
    # Add paths filter so the brain CI only runs on brain/ changes.
    # Done manually — each workflow file's trigger block needs a paths clause.
    echo "Edit $dst manually to add: paths: ['brain/**']"
done
# Then delete the original nested workflow dir — only root .github/workflows fires.
rm -rf brain/.github

# 2. Sanity-check: does kubilitics already have a backend-ci workflow that
# might conflict on names? Rename for clarity if so.
ls .github/workflows/

# 3. Push to a throwaway branch of vellankikoti/kubilitics to verify CI runs green.
git add -A
git commit -m "migrate: relocate brain CI workflows with path filters"
git push -u origin migrate/monorepo-consolidation
gh workflow list --repo vellankikoti/kubilitics | head
# Trigger each workflow manually once if they don't auto-run.
```

**Rollback at end of Phase C:** `git push origin :migrate/monorepo-consolidation` to delete the remote branch; local reset.

**→ Smoke gate Phase C.** CI workflow changes don't affect the running desktop. Expect all 10 flows GREEN. The real Phase-C validation is on GitHub (watch the Actions tab for clean runs) — that's not UI-visible.

### Phase D — Release tagging strategy (~30 min, a decision rather than a mechanical step)

**Pick one:**

**D1. Monolithic tags (recommended).** `v1.2.0` on the monorepo = backend, brain, frontend, desktop, helm all ship together. Simpler everything. Go module consumers import `github.com/vellankikoti/kubilitics/brain@v1.2.0`.

**D2. Per-component tags.** `backend/v1.2.0`, `brain/v1.2.0`, etc. — tag path-scoped. Allows shipping brain independently. Go modules handle this cleanly: `github.com/vellankikoti/kubilitics/brain/v1.2.0`. But release automation doubles in complexity.

D1 is my recommendation because Kubilitics ships as a product, not as a toolkit of libraries. One version number for everything matches user mental model.

- [ ] Update `.github/workflows/release.yml` to build backend + brain binaries from the monorepo at the same tag.
- [ ] Update `deploy/homebrew/kubilitics.rb` and charts to reference the new binary location.
- [ ] Cut `v1.2.0-rc.1` from the migrate branch to dry-run the release workflow.

**→ Smoke gate Phase D.** Tagging strategy is metadata-only; the desktop bits don't change. Expect all 10 flows GREEN. Also verify the RC release workflow produces all expected artifacts (backend binary, brain binary, DMG, Helm chart on ghcr.io).

### Phase E — Merge + archive (~15 min)

```bash
# 1. Merge the migration branch.
gh pr create --draft --title "MIGRATE: consolidate kotg.ai into monorepo" ...
# Review, squash-merge (or merge-commit if you want the subtree history intact).
# `--squash` WILL destroy the subtree history; use `--merge` to keep it. Recommend merge.

# 2. Archive the old kotg.ai repo.
cd /tmp && git clone https://github.com/vellankikoti/kotg.ai.git kotg.ai-final
cd kotg.ai-final
cat > README.md <<'EOF'
# Archived — code moved to `vellankikoti/kubilitics`

This repository's code has moved into the Kubilitics monorepo:

- Brain / toolserver → [`vellankikoti/kubilitics/brain`](https://github.com/vellankikoti/kubilitics/tree/main/brain)
- Experimental agents / gateway / frontend-business → available in the git
  history of this repo at tag `v0.9.0-final`, not yet ported.

File issues and PRs against the monorepo. This repo is archived.
EOF
git add README.md
git commit -m "archive: code moved to vellankikoti/kubilitics"
git push origin main

gh repo archive vellankikoti/kotg.ai --yes

# 3. Update anything that still points at the archived repo:
#    - Homebrew tap (no changes needed; it pulls from kubilitics releases)
#    - kubilitics README
#    - Any docs / READMEs in kotg-schema referencing kotg.ai
```

**→ Smoke gate Phase E.** This is THE big one. After the merge lands on main, the whole monorepo is the new reality. Expect all 10 flows GREEN. If Flow 1 (sidebar) RED post-merge: backend couldn't dial brain because the image tag changed / binary moved; re-check Phase C CI published artifacts correctly. **Do NOT archive `kotg.ai` until this gate is GREEN** — that's the last point of no-return.

### Phase F — Downstream fixups (~30 min)

- [ ] `vellankikoti/homebrew-kubilitics` — **no changes needed**. Its sync workflow reads from `vellankikoti/kubilitics/releases/latest`.
- [ ] `vellankikoti/kotg-schema` — update README to say "consumed by `vellankikoti/kubilitics`" (was `kotg.ai`).
- [ ] Any external tap/package managers (winget, AUR) — no change (distribution channels, not code).
- [ ] Update team docs: onboarding guide now says `git clone https://github.com/vellankikoti/kubilitics` — one command.

**→ Smoke gate Phase F.** Final gate. Expect all 10 flows GREEN. This is also the baseline for v1.2.0's release smoke — archive this run's artifacts as `docs/testing/baselines/2026-05-XX-post-migration/` so future regressions can be bisected against a known-good post-migration state.

## 4. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `git subtree add` pollutes main history with 500+ kotg.ai commits | High (this is what subtree does) | Acceptable: `git log --follow brain/...` filters; alternatively squash the subtree via `git subtree add --squash` at the cost of losing per-file blame (not recommended) |
| CI red across the monorepo post-migration | Medium | Phase C has an explicit "push to throwaway branch, watch CI" step before merge. Don't skip. |
| Existing external consumers pinned to old module path break | Low (we confirmed only kubilitics itself is a consumer, via kotg-schema which isn't moving) | `go mod edit` + regenerate go.sum on branch; cut a final `v0.9.0-final` tag on kotg.ai BEFORE archiving so anyone pinned to old path can stay on that tag forever |
| PR #7 (Week-1) conflicts with migration | Medium | Merge PR #7 FIRST. This plan explicitly gates on §2.1. |
| Release automation breaks on first post-migration tag | Medium | Cut `v1.2.0-rc.1` as a dry run; verify; only then cut GA |
| Docker image names change, breaking deployments | Low | Docker images already published from `vellankikoti/kubilitics` (backend) and `vellankikoti/kotg.ai` (brain — future: `vellankikoti/kubilitics-brain`). Keep the old brain image tag live for one release cycle before breaking |
| Subtree merge loses commits | Very low (subtree merge is well-tested) | Bare-mirror backup in §2.1 step 3 is the insurance |

## 5. Rollback procedures

**Full undo at any point before Phase E merge:**
```bash
# On kubilitics/
git checkout main
git branch -D migrate/monorepo-consolidation    # local
git push origin :migrate/monorepo-consolidation # remote

# kotg.ai is untouched until Phase E. No cleanup needed there.
```

**Rollback after Phase E archive (within 48 hours):**
```bash
# 1. Un-archive kotg.ai
gh repo unarchive vellankikoti/kotg.ai

# 2. Revert the merge on kubilitics
cd /path/to/kubilitics
git revert -m 1 <merge-sha-of-migration-pr>
git push origin main

# 3. Force-push kotg.ai back to its pre-migration HEAD
cd /tmp && git clone https://github.com/vellankikoti/kotg.ai.git
cd kotg.ai
git reset --hard v0.9.0-final  # the tag from §2.1
git push --force-with-lease origin main
```

**Rollback after 48 hours becomes progressively harder** as new work lands on the monorepo. Don't let rollback need drift past a week.

## 6. Success criteria

After Phase F is done, verify:

- [ ] `git clone https://github.com/vellankikoti/kubilitics` produces a single tree with backend + frontend + desktop + brain + helm
- [ ] `cd kubilitics && go build ./...` compiles every binary in the monorepo (backend, brain, gateway)
- [ ] `go test ./... -count=1` passes across the entire monorepo
- [ ] `docker build -f brain/Dockerfile .` builds the brain image (path anchored to repo root)
- [ ] `helm install kubilitics-brain brain/deploy/helm/...` works
- [ ] The previous month's brain bench can be re-run against the new monorepo with identical results (smoke signal that nothing semantic changed)
- [ ] `vellankikoti/kotg.ai` page shows "Archived" badge + redirect README
- [ ] `vellankikoti/kubilitics/releases/v1.2.0-rc.1` ships a brain binary alongside the backend

## 7. Open questions

Defer answers until execution day, but surface now so they're not discovered mid-migration:

1. **`kotg-ai-layer`, `kotg-agents`, `kotg-agent` subprojects — port or drop?** My Phase A drops them (they're experimental). If any contains production code we depend on, pull it in as a separate subtree-add.
2. **`kotg-gateway` — is it shipping today?** If yes, add `git subtree add --prefix=gateway` alongside brain. If no, drop.
3. **`kotg-frontend-business` — separate app or subsumed by `kubilitics-frontend`?** Probably separate; leave archived for now.
4. **Who owns the private enterprise repo when open-core launches?** Not a migration blocker but should be decided before cutting enterprise-feature work. See [OPEN-CORE-TIERS.md](./OPEN-CORE-TIERS.md).
5. **Do we rename the brain binary from `kubilitics-ai` to just `kubilitics-brain`?** Easier to grep logs with a distinct name; binary path `brain/cmd/server` could stay.

## 8. When to execute

Good moments:
- **End of a feature cycle**, not mid-sprint.
- When CI baseline is green on both repos.
- When no external contributors have pending PRs (check kotg.ai contributor list via `gh api repos/vellankikoti/kotg.ai/pulls`).

Bad moments:
- Actively shipping a release (breaks release automation mid-cut).
- Week 2 of the 5-keeper plan (DAG planner) is about to land.
- You're tired.

## 9. Timeline recommendation

- **Week of 2026-05-05** (after v1.2.0 Week-1 ships and we've done one normal release cycle on the post-Week-1 stack). Gives a baseline to compare against post-migration. Quiet window between Week-1 and Week-2 work.

---

## Appendix A: Commands compiled

One-liner to drop into a terminal for the greenfield execution:

```bash
# (run in a throwaway worktree first to rehearse)
cd /path/to/kubilitics
git checkout -b migrate/monorepo-consolidation
git subtree add --prefix=brain https://github.com/vellankikoti/kotg.ai.git main
cd brain/
for d in kotg-agent kotg-agents kotg-ai-layer kotg-frontend-business kotg-gateway; do
    [ -d "$d" ] && git rm -r "$d"
done
mv kubilitics-ai/* kubilitics-ai/.[!.]* . 2>/dev/null || true
rmdir kubilitics-ai 2>/dev/null
go mod edit -module github.com/vellankikoti/kubilitics/brain
find . -name '*.go' -type f -exec sed -i '' 's|github.com/vellankikoti/kotg.ai/kubilitics-ai|github.com/vellankikoti/kubilitics/brain|g' {} \;
go mod tidy && go build ./... && go test ./... -count=1
cd ..
git add -A
git commit -m "migrate: consolidate kotg.ai brain into monorepo at brain/"
# CI workflow relocation, release automation, archive — per phases C, D, E
```
