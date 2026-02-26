# Kubilitics — Enterprise-grade one-command dev and test (B3)
# Usage: make dev | desktop | desktop-dev | test | backend | frontend | clean

.PHONY: dev dev-ai test backend frontend kcli backend-test frontend-test kcli-test test-reports clean env-example restart desktop desktop-dev

# Default: run full stack (backend + frontend) via script
dev: env-example
	@chmod +x scripts/dev.sh 2>/dev/null || true
	@./scripts/dev.sh

# Full stack with AI: backend + kubilitics-ai + frontend (for testing AI Assistant before release)
dev-ai: env-example
	@chmod +x scripts/dev-with-ai.sh 2>/dev/null || true
	@./scripts/dev-with-ai.sh

# Build backend + kubilitics-ai, kill processes on 819/8081/5173, then start backend + AI + frontend.
restart:
	@chmod +x scripts/restart.sh 2>/dev/null || true
	@./scripts/restart.sh

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

# Build kcli binary
kcli:
	cd kcli && go build -o bin/kcli ./cmd/kcli

# Build frontend (production)
frontend:
	cd kubilitics-frontend && npm run build

# Run all tests and publish to test_reports (B3.3)
test: test-reports
	@mkdir -p test_reports/backend test_reports/frontend test_reports/playwright
	$(MAKE) backend-test 2>&1 | tee test_reports/backend/test.log; exit $${PIPESTATUS[0]}
	$(MAKE) frontend-test 2>&1 | tee test_reports/frontend/test.log; exit $${PIPESTATUS[0]}
	$(MAKE) kcli-test 2>&1 | tee test_reports/backend/kcli-test.log; exit $${PIPESTATUS[0]}
	@echo "Test reports: test_reports/"

# Run backend + frontend tests + E2E (full local verification before push)
test-all: test
	$(MAKE) e2e

backend-test:
	cd kubilitics-backend && go test -v -count=1 ./... 2>&1

frontend-test:
	cd kubilitics-frontend && npm run test 2>&1

kcli-test:
	cd kcli && go test -v -count=1 ./... 2>&1

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

# Build desktop app (Go backend + kcli + frontend + Tauri bundle)
# Output: kubilitics-desktop/src-tauri/target/release/bundle/
desktop: backend kcli
	@chmod +x scripts/build-desktop.sh
	@./scripts/build-desktop.sh

# Desktop development mode (hot reload)
# Starts backend sidecar + frontend dev server + Tauri dev window
desktop-dev: backend kcli
	@chmod +x scripts/dev-desktop.sh
	@./scripts/dev-desktop.sh

# Install npm dependencies for desktop (needed once after creating package.json)
desktop-install:
	cd kubilitics-desktop && npm install

clean:
	rm -rf kubilitics-backend/bin
	rm -rf kubilitics-frontend/dist
	rm -rf kubilitics-desktop/dist
	rm -rf kubilitics-desktop/node_modules
	rm -rf test_reports/backend/*.log test_reports/frontend/*.log test_reports/playwright/*.log 2>/dev/null || true
