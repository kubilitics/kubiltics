# Kubilitics — Production Release Checklist

**Version:** 1.0 | **Date:** 2026-02-17
**Source doc:** `project-docs/gap-analysis.md`
**Purpose:** Gate checklist for each numbered public release. Must be 100% complete before any tag is pushed.
**Current overall readiness:** ~65% → Target: 100%

---

## How to Use This Document

This checklist is the **release gate**. All items must be checked before tagging a public release (e.g., `v1.0.0`). For each release:

1. Copy this checklist into the release PR description
2. Check off items as CI verifies them or a human validates them
3. A release is **not** approved until every box in all Priority 0 and Priority 1 sections is checked
4. Priority 2 items are "should have" — document exceptions with issue numbers if skipping

---

## Priority 0 — Blocker Gates (Release Cannot Ship Without These)

### Confirmed Bugs

- [ ] **BUG-001 / DESK-001** — Tauri CSP updated to allow ports 819 and 8081 (not 8080)
  - Verify: `grep -n "csp" kubilitics-desktop/src-tauri/tauri.conf.json` shows `819` and `8081`
  - Verify: Open desktop app → DevTools Console → zero CSP violation messages

- [ ] **BUG-004 / AI-001** — AI backend port conflict resolved
  - Verify: `grep HTTPPort kubilitics-ai/internal/server/config.go` shows no hardcoded 8080
  - Verify: Start AI backend with no env vars → `curl http://localhost:8081/health` returns 200
  - Verify: `lsof -i :8080` shows no kubilitics-ai process

- [ ] **BUG-005 / AI-SEC-001** — LLM API keys removed from browser localStorage
  - Verify: `grep localStorage kubilitics-frontend/src/services/aiService.ts | grep LLM` returns nothing
  - Verify: Open devtools → Application → Local Storage → no `kubilitics_ai_provider_config` key after setting LLM provider

- [ ] **BUG-007 / AI-002** — AI WebSocket `defaultAllowedOrigins` is empty or production-only
  - Verify: `grep -A5 "defaultAllowedOrigins" kubilitics-ai/internal/server/websocket.go` shows empty slice

### Backend

- [ ] Backend builds successfully: `cd kubilitics-backend && go build ./cmd/server` exits 0
- [ ] All backend tests pass: `cd kubilitics-backend && go test ./...` exits 0
- [ ] Backend test coverage ≥ 80%: `go test -coverprofile=c.out ./... && go tool cover -func=c.out | grep total` shows ≥80%
- [ ] govulncheck passes: `govulncheck ./...` in kubilitics-backend exits 0 (no critical CVEs)
- [ ] All 20 migrations apply cleanly against fresh PostgreSQL and SQLite
- [ ] `GET /health` returns 200 with `{status: "ok"}` after startup
- [ ] `GET /ready` returns 200 only after DB migrations complete
- [ ] JWT auth works: login → token → authenticated request → 200; invalid token → 401
- [ ] Rate limiting active: 100+ rapid requests from same IP triggers 429 response
- [ ] Audit log records user actions: login, cluster add, resource view
- [ ] RBAC enforced: viewer role cannot call write endpoints (403 returned)

### Frontend

- [ ] Frontend builds successfully: `cd kubilitics-frontend && npm run build` exits 0 with no TypeScript errors
- [ ] All frontend tests pass: `npm test` exits 0
- [ ] Playwright E2E tests pass: `npx playwright test` exits 0
- [ ] `npm audit --audit-level=high` exits 0 (no high/critical npm vulnerabilities)
- [ ] All API calls use correct ports (819 for backend, 8081 for AI):
  - Verify: `grep -rn "localhost:8080\|:8080" kubilitics-frontend/src/` returns nothing except in comments
- [ ] LLM provider config shows masked key indicator after saving (not plaintext key)
- [ ] Login flow works end-to-end: email + password → JWT → authenticated cluster list loads
- [ ] AI assistant chat sends and receives messages in < 5 seconds
- [ ] Virtual scrolling works for resource lists with 1000+ items (no browser freeze)
- [ ] App works in: Chrome 120+, Firefox 120+, Safari 17+

### AI Backend

- [ ] AI backend builds: `cd kubilitics-ai && go build ./cmd/server` exits 0
- [ ] All AI backend tests pass: `cd kubilitics-ai && go test ./...` exits 0
- [ ] govulncheck passes in kubilitics-ai
- [ ] AI backend starts on port 8081 (confirmed via lsof)
- [ ] `GET http://localhost:8081/health` returns 200
- [ ] `GET http://localhost:8081/ready` returns 200
- [ ] `GET http://localhost:8081/info` returns JSON with `version`, `llm_providers`, `uptime` fields
- [ ] WebSocket connection at `ws://localhost:8081/ws/chat` accepts connections (with valid JWT)
- [ ] Unauthenticated API call returns 401 (after AI-SEC-002 implemented)
- [ ] Rate limit: >20 LLM completions/minute from one user → 429 response (after AI-SEC-003)

### Desktop

- [ ] Desktop app builds for macOS: `cargo tauri build` on macOS exits 0
- [ ] Desktop app builds for Windows: cross-compile or Windows runner succeeds
- [ ] Desktop app builds for Linux: AppImage produced
- [ ] Open desktop app → Cluster page loads (no CSP errors in DevTools)
- [ ] AI assistant works in desktop app (AI sidecar auto-started by Tauri)
- [ ] Desktop app closes cleanly → both sidecar processes terminate within 5 seconds
- [ ] Tray icon appears when app is minimized

### CI/CD

- [ ] backend-ci.yml passes on clean branch
- [ ] frontend-ci.yml passes on clean branch
- [ ] ai-ci.yml passes on clean branch (INT-002)
- [ ] desktop-ci.yml passes on clean branch
- [ ] Security scanning passes in all CI workflows (INT-001):
  - [ ] govulncheck in backend-ci.yml
  - [ ] govulncheck in ai-ci.yml
  - [ ] npm audit in frontend-ci.yml
- [ ] Docker images build successfully for backend, AI, frontend (INT-003)
- [ ] Docker image Trivy scans pass (no CRITICAL CVEs) (INT-003)

---

## Priority 1 — Required for Production Quality

### Security

- [ ] HTTPS enforced in production deployment (TLS certificate present, HTTP redirects to HTTPS)
- [ ] All sensitive env vars (JWT_SECRET, DB_URL, LLM keys) sourced from secrets manager or Kubernetes Secrets — never hardcoded
- [ ] SAML SSO tested with at least one external IdP (Okta or Azure AD)
- [ ] MFA TOTP tested end-to-end: enable TOTP → scan QR → enter code → login
- [ ] Password reset flow works: forgot password → email → reset link → new password
- [ ] Session revocation: user logout → subsequent requests with old JWT return 401
- [ ] API key revocation: revoke key → API calls with that key return 401
- [ ] Security headers present in all HTTP responses:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: <policy>`
  - `Referrer-Policy: strict-origin-when-cross-origin`

### Performance

- [ ] Backend responds to `GET /api/v1/clusters/{id}/resources/Pod?limit=100` in < 500ms against a live cluster
- [ ] Frontend Lighthouse performance score ≥ 80 on desktop
- [ ] Frontend First Contentful Paint < 2 seconds on fast 3G
- [ ] WebSocket messages delivered in < 100ms on localhost
- [ ] Backend memory usage < 256MB under normal load (< 500 requests/minute)

### Helm (Required for Enterprise/Cloud Deployment)

- [ ] `helm lint kubilitics-helm/ --strict` exits 0 (HELM-001 through HELM-006 complete)
- [ ] `helm install kubilitics kubilitics-helm/` succeeds on Kubernetes 1.28+
- [ ] All three pods (backend, AI, frontend) reach Running state within 3 minutes
- [ ] `helm test kubilitics` passes all test hooks
- [ ] Helm chart packaged and available at `oci://ghcr.io/kubilitics/charts/kubilitics:<version>`

### Integration

- [ ] Integration test suite passes (INT-005): login, cluster list, AI chat all work end-to-end
- [ ] Backend → AI service communication verified: topology analysis returns results
- [ ] Frontend AI status badge shows "Available" when AI backend is running and "Unavailable" when stopped

---

## Priority 2 — Should Have (Document Exceptions if Skipping)

### Accessibility

- [ ] Keyboard navigation works throughout the app (Tab, Enter, Escape, arrow keys)
- [ ] Screen reader test: main pages announce content correctly (VoiceOver on macOS or NVDA on Windows)
- [ ] Color contrast ratio ≥ 4.5:1 for all text (WCAG AA)
- [ ] No focus traps (except modals, which should trap focus correctly)
- [ ] All form inputs have associated labels

### Internationalization

- [ ] i18n framework initialized (react-i18next or similar)
- [ ] All user-facing strings extracted to translation files
- [ ] At minimum: English (en) locale complete
- [ ] Date/time formatting uses user's locale

### Desktop Code Signing

- [ ] macOS DMG is signed with Developer ID certificate
- [ ] macOS notarization complete: `spctl --assess --type exec kubilitics.app` returns "accepted"
- [ ] Windows MSI signed with EV Code Signing certificate — no SmartScreen warning on installation

### Desktop Auto-Update

- [ ] Update server configured at `releases.kubilitics.dev` or GitHub Releases endpoint
- [ ] Desktop app checks for updates on launch (max once per 24 hours)
- [ ] Update notification appears when newer version is available
- [ ] "Install Now" button installs update and restarts app

### Monitoring

- [ ] Backend exposes `/metrics` in Prometheus format (or structured logs for log-based monitoring)
- [ ] Alerts defined for: backend down, AI backend down, error rate > 1%, high memory usage
- [ ] Runbook created for each alert

### Documentation

- [ ] `README.md` in repo root: what Kubilitics is, quick-start (3 commands), links to full docs
- [ ] User documentation: how to add a cluster, use AI assistant, configure LLM provider
- [ ] Deployment guide: Helm install, environment variables reference, TLS setup
- [ ] API documentation: OpenAPI spec published (e.g., at `/api/docs` or docs site)
- [ ] Architecture diagram showing backend/AI/frontend/desktop relationships

---

## Priority 3 — Nice to Have (Post-Release Backlog)

- [ ] Analytics consent dialog implemented in desktop app (DESK-021)
- [ ] Desktop settings UI shows sidecar status, version, kubeconfig path (DESK-005)
- [ ] Kubeconfig security: context selection on first launch (DESK-010)
- [ ] Offline mode in desktop: cached cluster state shown when network unavailable (DESK-011)
- [ ] Network policies deployed with Helm chart (HELM-010)
- [ ] Pod disruption budgets deployed with Helm chart (HELM-011)
- [ ] Prometheus ServiceMonitor added to Helm chart (HELM-012)
- [ ] Contract tests (OpenAPI) run in CI (INT-006)
- [ ] Cross-browser E2E tests (Chrome, Firefox, Safari, Edge)

---

## Release Sign-Off

Before tagging the release, the following people must sign off:

| Role | Name | Date | Signature |
|---|---|---|---|
| Lead Engineer | | | |
| Security Reviewer | | | |
| QA / Testing | | | |

**Release tag format:** `v<major>.<minor>.<patch>` (e.g., `v1.0.0`)
**Tag command:** `git tag -s v1.0.0 -m "Release v1.0.0" && git push origin v1.0.0`

---

## Release Notes Template

```markdown
## Kubilitics v<X.Y.Z>

### What's New
- ...

### Bug Fixes
- ...

### Breaking Changes
- ...

### Upgrade Notes
- ...

### Known Issues
- ...

### Checksums
| File | SHA256 |
|---|---|
| kubilitics-backend-linux-amd64 | ... |
| kubilitics-backend-linux-arm64 | ... |
| kubilitics-backend-darwin-arm64 | ... |
| kubilitics-backend-windows-amd64.exe | ... |
| kubilitics-macos-universal.dmg | ... |
| kubilitics-windows-x64.msi | ... |
| kubilitics-linux-x86_64.AppImage | ... |
```

---

## Current Release Gate Status (v1.0.0)

| Category | Items | Done | % |
|---|---|---|---|
| P0 Confirmed Bugs | 4 | 0 | 0% |
| P0 Backend | 10 | ~8 | ~80% |
| P0 Frontend | 10 | ~7 | ~70% |
| P0 AI Backend | 9 | ~5 | ~55% |
| P0 Desktop | 7 | ~1 | ~14% |
| P0 CI/CD | 7 | 5 | 71% |
| P1 Security | 9 | ~6 | ~67% |
| P1 Performance | 5 | unknown | TBD |
| P1 Helm | 5 | 0 | 0% |
| P1 Integration | 3 | 1 | 33% |
| **Total P0+P1** | **69** | **~33** | **~48%** |

**v1.0.0 release is not ready. Estimated completion: 4–6 weeks of focused development.**

**Next priority order for fastest path to v1.0.0:**
1. Fix DESK-001 (15 minutes)
2. Fix AI-001 (2 hours)
3. Fix AI-SEC-001 (3 days)
4. Create Helm chart HELM-001 through HELM-006 (1 week)
5. Add security scanning INT-001 (1 day)
6. Create AI CI workflow INT-002 (4 hours)
7. Build Docker images INT-003 (2 days)
8. Fix DESK-002 AI sidecar (1 week)
9. Code signing DESK-003 (1 week)
10. Increase backend test coverage BE-030 (2 weeks)
