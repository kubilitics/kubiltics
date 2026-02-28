.PHONY: install install-dev test test-unit test-cov lint format type-check clean dev-up dev-down models

PYTHON := python3
UV := uv
PYTEST := pytest

# ── Installation ────────────────────────────────────────────────────────────

install:
	$(UV) sync

install-dev:
	$(UV) sync --extra dev
	$(UV) run pre-commit install

# ── Testing ─────────────────────────────────────────────────────────────────

test:
	$(UV) run $(PYTEST) tests/ -v

test-unit:
	$(UV) run $(PYTEST) tests/core tests/mcp -v

test-cov:
	$(UV) run $(PYTEST) tests/ --cov=kotg --cov-report=html --cov-report=term-missing

# ── Code quality ─────────────────────────────────────────────────────────────

lint:
	$(UV) run ruff check kotg/ tests/

format:
	$(UV) run ruff format kotg/ tests/
	$(UV) run black kotg/ tests/

type-check:
	$(UV) run mypy kotg/

# ── Docker dev environment ───────────────────────────────────────────────────

dev-up:
	docker compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 5
	@echo "Ollama:  http://localhost:11434"
	@echo "Qdrant:  http://localhost:6333"

dev-down:
	docker compose down

dev-logs:
	docker compose logs -f

# ── Model management ─────────────────────────────────────────────────────────

models:
	$(UV) run kotg models install medium

models-all:
	$(UV) run kotg models install all

# ── Cleanup ──────────────────────────────────────────────────────────────────

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage

# ── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo "KOTG.AI Development Commands"
	@echo ""
	@echo "  make install       Install dependencies (production)"
	@echo "  make install-dev   Install dev dependencies + pre-commit hooks"
	@echo "  make test          Run all tests"
	@echo "  make test-cov      Run tests with HTML coverage report"
	@echo "  make lint          Run ruff linter"
	@echo "  make format        Auto-format code"
	@echo "  make type-check    Run mypy type checker"
	@echo "  make dev-up        Start Ollama + Qdrant via Docker Compose"
	@echo "  make dev-down      Stop Docker Compose services"
	@echo "  make models        Pull medium-tier LLM models via Ollama"
	@echo "  make clean         Remove build artifacts"
