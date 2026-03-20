# Topology V2 — Contributor Guide

## Development Setup

### Prerequisites
- Go 1.21+
- Node.js 18+ with npm
- Docker (for running K8s tests locally)

### Backend
```bash
cd kubilitics-backend
go build ./...
go test ./internal/topology/v2/... -v
go test ./internal/topology/v2/... -bench=. -benchmem
```

### Frontend
```bash
cd kubilitics-frontend
npm install
npx tsc --noEmit          # Type check
npx vitest run             # Unit tests
npx playwright test        # E2E tests
```

## Architecture Overview
The topology engine follows a pipeline pattern:
1. **Fetch** — Kubernetes API resources via informers
2. **Match** — 12 concurrent relationship matchers discover edges
3. **Enrich** — Health and metrics enrichers annotate nodes
4. **Filter** — View filter reduces graph to the selected view mode
5. **Cache** — TTL cache (30s) prevents redundant builds
6. **Serve** — REST handler serializes to JSON; WebSocket pushes deltas

## Adding a New Relationship Matcher

1. Create `matcher_yourtype.go` in `internal/topology/v2/`
2. Implement the `Matcher` interface:
```go
type YourTypeMatcher struct{}

func (m *YourTypeMatcher) Match(bundle *ResourceBundle) []TopologyEdge {
    var edges []TopologyEdge
    // Discovery logic here
    return edges
}
```
3. Register in `match_all.go`'s `allMatchers` slice
4. Add tests in `matcher_yourtype_test.go`
5. Add resilience test in `resilience_test.go`

## Adding a New Node Type

1. Create `YourNode.tsx` in `src/topology/nodes/`
2. Follow the pattern: `memo` wrapper, `aria-label`, `role="treeitem"`
3. Register in `nodeTypes.ts`
4. Define zoom thresholds in `useElkLayout.ts`

## Adding a New View Mode

1. Backend: Add case in `view_filter.go`'s `Filter()` method
2. Frontend: Add option in `TopologyToolbar.tsx` view selector
3. Add keyboard shortcut in `useTopologyKeyboard.ts`
4. Add E2E test file
5. Add visual regression baseline

## Testing Strategy

### Unit Tests (vitest)
- Node/edge rendering
- Hook behavior (layout, keyboard, WebSocket)
- Store actions and selectors
- Utility functions

### Integration Tests (Go)
- Pipeline end-to-end with fixtures
- Benchmark with parameterized large fixtures
- Resilience with partial/nil data

### E2E Tests (Playwright)
- 8 test files covering all view modes, interactions, search, navigation, export
- Visual regression baselines for each view mode and overlay

### Performance Benchmarks
- 100, 500, 1000, 2000 resource fixtures
- Layout determinism verification
- Cache hit/miss ratios

## Code Standards
- All components use `React.memo` for render optimization
- All interactive elements have `aria-label` and appropriate `role`
- Design tokens are centralized in `nodeConfig.ts` and `edgeConfig.ts`
- Edge styles are category-based with light/dark mode support
- No inline colors — use design system tokens
