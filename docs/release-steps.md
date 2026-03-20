# Kubilitics Release Steps

Step-by-step runbook for cutting a new release. Follow every section in order. Do **not** push the tag until all checks pass locally.

---

## 1. Decide the version

Use [Semantic Versioning](https://semver.org/):

| Change type | Bump |
|---|---|
| Bug fixes / minor improvements | PATCH (`0.1.0` → `0.1.1`) |
| New backward-compatible features | MINOR (`0.1.0` → `0.2.0`) |
| Breaking API / behavior change | MAJOR (`0.1.0` → `1.0.0`) |

Set the target version as a shell variable for the rest of these steps:

```bash
VERSION=0.1.1   # without the "v" prefix
```

---

## 2. Sync & create a release branch (optional for PATCH)

```bash
git checkout main && git pull origin main
# For MINOR or MAJOR, create a dedicated branch:
git checkout -b release/v${VERSION}
```

---

## 3. Bump version strings

Update every package that carries a version number:

### Frontend (`kubilitics-frontend/package.json`)
```bash
# Edit manually or use npm version (do NOT push tags with npm version)
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" kubilitics-frontend/package.json
```
Verify:
```bash
grep '"version"' kubilitics-frontend/package.json
```

### kcli version constant (if present)
```bash
grep -rn "Version\s*=" kcli/internal/version/
# Update the constant to ${VERSION}
```

### Desktop Tauri config (when desktop is released)
```bash
# kubilitics-desktop/src-tauri/tauri.conf.json → "version"
```

---

## 4. Update `CHANGELOG.md`

Add a new section at the top of the unreleased changes:

```markdown
## [v0.1.1] - YYYY-MM-DD

### Fixed
- …

### Added
- …
```

Replace `[Unreleased]` content with the new version heading.

---

## 5. Run all builds

All three must succeed with **zero errors**:

```bash
# Backend
cd kubilitics-backend && go build -o bin/kubilitics-backend ./cmd/server && cd ..

# kcli
cd kcli && go build -o bin/kcli ./cmd/kcli && cd ..

# Frontend (production)
cd kubilitics-frontend && npm run build && cd ..
```

Warnings about chunk sizes are acceptable; errors are not.

---

## 6. Run all tests

All test suites must be **green** before tagging.

```bash
# Backend
cd kubilitics-backend && go test -count=1 ./... && cd ..

# kcli
cd kcli && go test -count=1 -timeout=120s ./... && cd ..

# Frontend unit
cd kubilitics-frontend && npm run test && cd ..
```

Use the Makefile shorthand if preferred:
```bash
make test
```

Fix any failures before proceeding. Do **not** skip or ignore failing tests.

---

## 7. Commit all pending changes

Stage and commit everything that belongs to this release (version bumps, bug fixes, changelog, docs):

```bash
git add kubilitics-frontend/package.json CHANGELOG.md docs/
git add kubilitics-backend/ kcli/ kubilitics-ai/
# Add any other modified files shown by `git status`
git status   # review before committing

git commit -m "$(cat <<'EOF'
chore: release v${VERSION}

- Bump version to ${VERSION} across frontend, backend, kcli
- Update CHANGELOG.md
- Fix all pre-release test failures

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 8. Tag the release

```bash
git tag -a "v${VERSION}" -m "Release v${VERSION}"
```

Verify:
```bash
git tag --list | sort -V | tail -5
git show "v${VERSION}" --stat
```

---

## 9. Push branch + tag

```bash
# Push the commit(s)
git push origin main       # or release/v${VERSION} branch

# Push the tag — this triggers the GitHub Actions release workflow
git push origin "v${VERSION}"
```

> **Warning:** Pushing the tag is irreversible in public repos. Confirm tests are green before this step.

---

## 10. Verify CI / GitHub Release

1. Go to **Actions → release.yml** and confirm the run triggered.
2. Wait for the workflow to finish — it builds backend binaries and desktop installers.
3. Go to **Releases** on GitHub and confirm the new release was created with the expected artifacts attached.
4. Edit the release description to add human-readable notes (if not auto-generated from CHANGELOG).

---

## 11. Post-release housekeeping

- [ ] Merge `release/v${VERSION}` branch back to `main` (if used).
- [ ] Update `[Unreleased]` section in `CHANGELOG.md` for the next development cycle.
- [ ] Announce the release (Discord, GitHub Discussions, etc.).
- [ ] Update any open issues / milestones referencing the released version.

---

## Hotfix releases (PATCH on a previous tag)

If `main` has moved on and you need to hotfix an older release:

```bash
git checkout -b hotfix/v${VERSION} v<previous-tag>
# Apply the minimal fix
# Follow steps 5–10 above
```

---

## Reference: version locations

| File | Field |
|---|---|
| `kubilitics-frontend/package.json` | `"version"` |
| `kubilitics-desktop/src-tauri/tauri.conf.json` | `"version"` |
| `kcli/internal/version/*.go` | Version constant |
| `CHANGELOG.md` | Release heading |
| Git tag | `v{MAJOR}.{MINOR}.{PATCH}` |

> See also: [`docs/RELEASE-PROCESS.md`](RELEASE-PROCESS.md) for CI/CD pipeline details and [`docs/DISTRIBUTION.md`](DISTRIBUTION.md) for artifact signing and Helm chart publishing.
