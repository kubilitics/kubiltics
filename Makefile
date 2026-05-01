# Kubilitics — Enterprise-grade one-command dev and test (B3)
# Usage: make start | stop | restart | desktop | test | backend | frontend | clean

.PHONY: dev dev-ai start stop restart test backend frontend backend-test frontend-test test-reports clean env-example desktop desktop-dev desktop-install kcli kcli-build

# ── Desktop app lifecycle (Tauri dev window + all sidecars) ──────────────────

# Launch the full Kubilitics desktop dev stack (kills stale processes, builds
# all Go sidecars, opens Tauri dev window with hot-reload frontend).
# Ctrl+C stops everything. Logs also written to /tmp/tauri-dev.log.
start:
	@chmod +x scripts/desktop.sh
	@./scripts/desktop.sh start

# Kill all kubilitics processes and dev-server ports (backend, brain, Tauri, Vite).
stop:
	@chmod +x scripts/desktop.sh
	@./scripts/desktop.sh stop

# Clean relaunch: stop everything, then start fresh.
restart:
	@chmod +x scripts/desktop.sh
	@./scripts/desktop.sh restart

# ── Non-desktop (web-only) dev stack ────────────────────────────────────────

# Default: run full stack (backend + frontend) via script
dev: env-example
	@chmod +x scripts/dev.sh 2>/dev/null || true
	@./scripts/dev.sh

# Full stack with AI: backend + kubilitics-ai + frontend (for testing AI Assistant before release)
dev-ai: env-example
	@chmod +x scripts/dev-with-ai.sh 2>/dev/null || true
	@./scripts/dev-with-ai.sh

# Or run in separate terminals: make backend-dev | make frontend-dev

# Run backend only (blocking). Use binary if built, else go run. Must run from backend dir so migrations/db are found.
backend-dev:
	cd kubilitics-backend && (test -x bin/kubilitics-backend && ./bin/kubilitics-backend || go run ./cmd/server)

# Run frontend only (blocking)
frontend-dev:
	cd kubilitics-frontend && npm run dev

# Build backend binary
backend:
	cd kubilitics-backend && go build -o bin/kubilitics-backend ./cmd/server

# Build frontend (production)
frontend:
	cd kubilitics-frontend && npm run build

# Run all tests and publish to test_reports (B3.3)
test: test-reports
	@mkdir -p test_reports/backend test_reports/frontend test_reports/playwright
	$(MAKE) backend-test 2>&1 | tee test_reports/backend/test.log; exit $${PIPESTATUS[0]}
	$(MAKE) frontend-test 2>&1 | tee test_reports/frontend/test.log; exit $${PIPESTATUS[0]}
	@echo "Test reports: test_reports/"

# Run backend + frontend tests + E2E (full local verification before push)
test-all: test
	$(MAKE) e2e

backend-test:
	cd kubilitics-backend && go test -v -count=1 ./... 2>&1

frontend-test:
	cd kubilitics-frontend && npm run test 2>&1

# E2E (optional; requires backend + frontend running or playwright config). Use CI=true to auto-start preview server.
e2e:
	@mkdir -p test_reports/playwright
	cd kubilitics-frontend && CI=true npx playwright test --reporter=html 2>&1 | tee ../test_reports/playwright/e2e.log

# Ensure test_reports dir exists (B3.3)
test-reports:
	@mkdir -p test_reports/backend test_reports/frontend test_reports/playwright
	@touch test_reports/backend/.gitkeep test_reports/frontend/.gitkeep test_reports/playwright/.gitkeep

# Copy .env.example to .env if missing (B3.2)
env-example:
	@if [ ! -f .env ]; then cp -n .env.example .env 2>/dev/null || true; echo "Created .env from .env.example (if present)"; fi

# Fetch kcli binary from https://github.com/vellankikoti/kcli (latest release)
# Places it in kubilitics-desktop/src-tauri/binaries/ with Tauri target-triple naming.
kcli:
	@chmod +x scripts/fetch-kcli.sh
	@./scripts/fetch-kcli.sh

# Build kcli from source (requires Go toolchain)
kcli-build:
	@chmod +x scripts/fetch-kcli.sh
	@./scripts/fetch-kcli.sh --build

# Build desktop app (Go backend + frontend + Tauri bundle)
# Output: kubilitics-desktop/src-tauri/target/release/bundle/
desktop: backend kcli
	@chmod +x scripts/build-desktop.sh
	@./scripts/build-desktop.sh

# Desktop development mode (alias for start)
desktop-dev:
	@$(MAKE) start

# Install npm dependencies for desktop (needed once after creating package.json)
desktop-install:
	cd kubilitics-desktop && npm install

clean:
	rm -rf kubilitics-backend/bin
	rm -rf kubilitics-frontend/dist
	rm -rf kubilitics-desktop/dist
	rm -rf kubilitics-desktop/node_modules
	rm -rf test_reports/backend/*.log test_reports/frontend/*.log test_reports/playwright/*.log 2>/dev/null || true
