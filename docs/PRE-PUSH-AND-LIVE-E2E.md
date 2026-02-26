# Pre-push and live E2E checklist

Use this checklist before pushing and when validating the application end-to-end in a live environment.

---

## 1. Pending tasks (TASKS.md)

- **Required roadmap:** All phased tasks (A through W, MO1.1) are marked complete in `TASKS.md`.
- **Optional (later):** MO1.2–MO1.5 (mobile API client, push spec, biometric, Tauri mobile build) remain optional.

No required tasks are pending.

---

## 2. Local builds

From repo root:

| Step | Command | Expected |
|------|---------|----------|
| Backend binary | `make backend` | Builds `kubilitics-backend/bin/kubilitics-backend` |
| Frontend (production) | `make frontend` | Builds `kubilitics-frontend/dist/` |

---

## 3. Local tests

| Suite | Command | Expected |
|-------|---------|----------|
| Backend (unit + integration) | `make backend-test` or `cd kubilitics-backend && go test -v -count=1 ./...` | All packages pass (api/rest, websocket, validate, service, topology). |
| Frontend (unit) | `make frontend-test` or `cd kubilitics-frontend && npm run test` | Vitest: backendConfigStore + backendApiClient tests pass. |
| E2E (Playwright) | `make e2e` or `cd kubilitics-frontend && CI=true npx playwright test` | One E2E: app loads and shows cluster/topology entry. |

**Full local test run:**

```bash
make test          # backend + frontend tests (writes test_reports/backend, test_reports/frontend)
make e2e           # Playwright E2E with CI preview server (writes test_reports/playwright)
make test-all      # test + e2e (full local verification)
```

**First-time E2E:** Install Playwright browser once: `cd kubilitics-frontend && npx playwright install chromium`.

---

## 4. Before you push

- [ ] `make backend` succeeds  
- [ ] `make frontend` succeeds  
- [ ] `make backend-test` passes  
- [ ] `make frontend-test` passes  
- [ ] `make e2e` passes (or `CI=true npx playwright test` in `kubilitics-frontend`)  
- [ ] No unintended changes; review `git status` and diffs  

---

## 5. Run app locally (for laptop testing)

From repo root, start backend and frontend:

```bash
# Terminal 1: backend (or run in background)
cd kubilitics-backend && go run ./cmd/server
# Backend: http://localhost:819  (health: /health, API: /api/v1)

# Terminal 2: frontend (after backend is up)
cd kubilitics-frontend && npm run dev
# Frontend: http://localhost:5173 (Vite; strictPort)
```

Or one command (backend in background, then frontend in foreground):

```bash
make dev
```

**To test:** Open the frontend URL in your browser. In Settings, set Backend URL to `http://localhost:819` if needed. Add a cluster (kubeconfig path or in-cluster) and check cluster list, topology, resources.

---

## 6. Live application E2E (after push)

After pushing, validate the real app end-to-end:

1. **Backend + frontend (web)**  
   - Start backend: `make backend-dev` or `cd kubilitics-backend && go run ./cmd/server`.  
   - Start frontend: `make frontend-dev` or `cd kubilitics-frontend && npm run dev`.  
   - Open browser: frontend URL (e.g. http://localhost:5173).  
   - Configure backend URL in Settings (e.g. http://localhost:819) if not default.  
   - Add a cluster (kubeconfig or in-cluster).  
   - **Check:** Cluster list, topology view, resource list/detail, logs/events/metrics (or 501), error states (backend unreachable, no clusters).

2. **Desktop (optional)**  
   - Build backend binary and place for Tauri (see README Desktop section).  
   - `cd kubilitics-desktop && cargo tauri dev`.  
   - **Check:** App launches, sidecar backend starts, cluster list and topology work.

3. **Deployed backend (e.g. Helm)**  
   - Deploy backend (e.g. `helm install` from `deploy/helm/kubilitics/`).  
   - Point frontend (or desktop) at deployed backend URL.  
   - **Check:** Health, clusters, topology, resources, auth/HTTPS as applicable.

4. **Website (optional)**  
   - If GitHub Pages (or other) is enabled: open the site URL.  
   - **Check:** Landing, install section, links to GitHub/Helm/desktop.

---

## 7. CI (after push)

- Backend CI: tests and build.  
- Frontend CI: tests and build.  
- E2E: Playwright in CI (e.g. frontend workflow with `CI=true` and optional backend).  
- Desktop CI: build per platform.  
- Website CI: build (and deploy if configured).  

If any workflow fails, fix and re-push; then re-run the live E2E steps above as needed.
