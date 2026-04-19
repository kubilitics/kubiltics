# Archived AI integration code

These packages were the supervisor / cert-mint / NoOpGate stack from
subproject 2 of the AI integration arc. They are retained as historical
reference but excluded from the build via `//go:build never` tags.

The architecture they served (kubilitics-backend exec'ing a kotg-ai-server
binary over local mTLS) was replaced in subproject 3a corrected by:

- `internal/ai/aiclient/` — gRPC + HTTP client to in-cluster kubilitics-ai
- `github.com/vellankikoti/kotg-schema` — the wire contract (Chat + AIControl)

See `docs/superpowers/specs/2026-04-19-backend-kubilitics-ai-integration-design.md`
for the corrected design.
