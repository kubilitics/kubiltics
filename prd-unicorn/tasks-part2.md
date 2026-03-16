# Tasks Part 2 — P1 & P2 Implementation Details

## P1 — Launch Quality (Weeks 5-8)

### UX-008: Dashboard Time Range Selector

**Component:** `src/components/dashboard/TimeRangeSelector.tsx`

```tsx
// Presets: 15m, 1h, 6h, 24h, 7d, 30d, Custom
// Position: Dashboard header, right-aligned
// Behavior: All widgets re-fetch with time range parameter
// Persistence: localStorage via Zustand
```

**Dependencies:**
- Backend must support `?from=&to=` query parameters on metric endpoints
- React Query cache keys must include time range

**Estimated effort:** 3-5 days (frontend) + backend API changes

---

### UX-010: Inline Table Actions

**Component:** `src/components/list/TableRowActions.tsx`

**Actions per resource type:**

| Resource | Available Actions |
|----------|-----------------|
| Pod | Logs, Shell, Delete, YAML |
| Deployment | Scale, Restart, YAML, Delete |
| Service | YAML, Delete |
| StatefulSet | Scale, Restart, YAML, Delete |
| DaemonSet | Restart, YAML, Delete |
| Job | Delete, YAML |
| CronJob | Trigger, Suspend, YAML, Delete |
| ConfigMap | Edit, YAML, Delete |
| Secret | YAML, Delete |

**Multi-Select Bulk Toolbar:**
```tsx
<BulkActionsToolbar
  selectedCount={selectedIds.length}
  onDelete={() => bulkDelete(selectedIds)}
  onRestart={() => bulkRestart(selectedIds)}
  onLabel={() => openLabelDialog(selectedIds)}
  onClear={() => clearSelection()}
/>
```

**Estimated effort:** 5-7 days

---

### UX-011: Resource Relationships Tab

**Component:** `src/components/resources/ResourceRelationships.tsx`

**Mini Topology Layout:**
- Centered on current resource (highlighted with brand border)
- Show 1-hop upstream (what creates/manages this)
- Show 1-hop downstream (what this creates/manages/selects)
- Click any node to navigate to that resource

**Example for a Pod:**
```
Deployment → ReplicaSet → [POD] → ConfigMap
                                  → Secret
                                  → PersistentVolumeClaim
                        Service → [POD]
```

**Implementation:**
- Use xyflow (ReactFlow) with ELK layout
- Fetch topology data filtered to single resource + 1-hop neighbors
- Add "Relationships" tab to ResourceDetailLayout alongside YAML, Events, Logs

**Estimated effort:** 5-7 days

---

### UX-014: Split-Pane Resource View

**Layout:**
```
┌──────────────────────────────────────────────────┐
│ Table List (60%)          │ Detail Panel (40%)    │
│ ┌──────────────────────┐  │ ┌──────────────────┐ │
│ │ Name  Status  Age    │  │ │ Pod: nginx-abc   │ │
│ │ > nginx-abc  Running │  │ │ ├── Overview     │ │
│ │   nginx-def  Running │  │ │ ├── YAML         │ │
│ │   nginx-ghi  Error   │  │ │ ├── Logs         │ │
│ │                      │  │ │ ├── Events       │ │
│ └──────────────────────┘  │ │ └── Relationships│ │
│                           │ └──────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Use react-resizable-panels (already a dependency)
- Add split view toggle button to table header
- Persist panel width preference
- Keyboard: Escape closes detail panel, arrow keys navigate list

**Estimated effort:** 3-5 days

---

### DS-003: Storybook Setup

**Installation:**
```bash
npx storybook@latest init --type react_vite
```

**Component Stories Required (52 components):**

Priority 1 (Core — 15 components):
- Button (all 7 variants × 4 sizes × states)
- Card (header, content, footer variations)
- Input, Textarea, Select
- Dialog, AlertDialog
- Table (with data, empty, loading)
- Badge (all variants)
- Tabs, Accordion
- Tooltip, Popover
- Skeleton

Priority 2 (Forms — 10 components):
- Form, FormField, FormItem, FormMessage
- Checkbox, Radio, Switch, Toggle
- Slider, InputOTP

Priority 3 (Layout — 12 components):
- Sidebar, Breadcrumb, Navigation
- Sheet, Drawer
- Resizable panels
- Separator, AspectRatio, ScrollArea
- DropdownMenu, ContextMenu, Menubar

Priority 4 (Data Display — 15 components):
- Chart (line, bar, pie variations)
- Pagination, Progress
- Avatar, HoverCard
- Carousel, Collapsible
- Command palette
- Sonner toasts

**Addons:**
- @storybook/addon-a11y — Accessibility testing
- @storybook/addon-viewport — Responsive testing
- @storybook/addon-interactions — Interaction tests

**Estimated effort:** 8-10 days

---

### DS-004: Micro-Interactions

**AnimatedNumber Component:**
```tsx
// Uses CountUp animation
// Props: value, duration (default 500ms), format (number | currency | percentage)
<AnimatedNumber value={pods.healthy} format="number" />
```

**Status Transition Animation:**
```tsx
// Smooth color morph when status changes
// e.g., Running (green) → Terminating (amber) → Completed (blue)
<AnimatedStatus status={pod.status} />
```

**Data Pulse Effect:**
```tsx
// Brief shimmer/highlight when data updates via WebSocket
// Applied to: metric cards, table rows, status badges
useEffect(() => {
  if (prevValue !== currentValue) {
    triggerPulse(); // Adds temporary CSS class with glow animation
  }
}, [currentValue]);
```

**Heartbeat Animation:**
```css
@keyframes heartbeat {
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.3); opacity: 1; }
}
.cluster-connected::after {
  animation: heartbeat 2s ease-in-out infinite;
}
```

**Estimated effort:** 5-7 days

---

### PERF-001: Virtualized Tables

**Library:** react-virtuoso (better React 18 support than react-window)

**Implementation:**
```tsx
import { TableVirtuoso } from 'react-virtuoso';

<TableVirtuoso
  data={resources}
  fixedHeaderContent={() => <TableHeader columns={columns} />}
  itemContent={(index, resource) => <TableRow resource={resource} />}
  overscan={20}
/>
```

**Pages to Virtualize (by data volume):**
1. Pods list (most critical — can have 5000+)
2. Events list (high volume)
3. ConfigMaps/Secrets lists
4. All other resource lists

**Performance Targets:**
- 1,000 rows: < 16ms render (60fps)
- 5,000 rows: < 16ms render (60fps)
- 10,000 rows: < 33ms render (30fps minimum)

**Estimated effort:** 3-5 days

---

### A11Y-002: WCAG 2.1 AA Audit

**Automated Testing:**
```typescript
// Already have @axe-core/playwright in devDependencies
// Create comprehensive test suite

test('every page passes WCAG 2.1 AA', async ({ page }) => {
  const pages = ['/dashboard', '/pods', '/deployments', '/topology', ...];
  for (const route of pages) {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }
});
```

**Manual Checks:**
1. Keyboard-only navigation through all critical flows
2. Screen reader testing (VoiceOver on Mac, NVDA on Windows)
3. 200% zoom — all content accessible
4. Reduced motion — all animations respect prefers-reduced-motion
5. Focus management in dialogs, drawers, command palette

**Common Fixes Expected:**
- Missing aria-labels on icon-only buttons
- Missing form labels
- Insufficient color contrast on muted text
- Focus not trapped in modals
- No visible focus indicator on custom components

**Estimated effort:** 8-10 days

---

## P2 — Excellence (Weeks 9-12)

### UX-016: Brand Identity "Topology Blue"

**Gradient Definition:**
```css
:root {
  --brand-gradient: linear-gradient(135deg, hsl(221, 83%, 53%) 0%, hsl(195, 80%, 50%) 100%);
  --brand-gradient-subtle: linear-gradient(135deg, hsl(221, 83%, 95%) 0%, hsl(195, 80%, 95%) 100%);
}
```

**Application Points:**
- Welcome screen hero
- Dashboard header accent line
- Active sidebar item background
- Primary CTA buttons (hover state)
- Topology node glow on selection
- Loading progress bars
- Empty state illustration accents

**Signature Animation — "Connection Lines":**
- When hovering a resource item anywhere (sidebar, table, card), show a subtle animated line suggesting topology connections
- SVG path animation with dash-offset

**Estimated effort:** 5-7 days

---

### UX-017: Responsive Design

**Breakpoint Strategy:**
```
Mobile:  320px - 767px  → Single column, drawer sidebar, stacked widgets
Tablet:  768px - 1023px → Two columns, collapsible sidebar
Desktop: 1024px - 1439px → Full layout, sidebar visible
Wide:    1440px+         → Full layout, extra column space
```

**Key Layout Changes:**

| Component | Mobile | Tablet | Desktop |
|-----------|--------|--------|---------|
| Sidebar | Hidden (hamburger → drawer) | Collapsed icons | Full expanded |
| Dashboard | 1 col stacked | 2 col grid | 12 col grid |
| Tables | Card view per row | Horizontal scroll | Full table |
| Topology | Simplified (no minimap) | Full with minimap | Full |
| Header | Minimal (logo + burger) | Condensed | Full |
| Dialogs | Full screen | Centered modal | Centered modal |

**Estimated effort:** 10-14 days

---

### UX-018: Notification Center

**Architecture:**
```
┌─────────────────────────────┐
│ 🔔 Notifications (3 unread) │
├─────────────────────────────┤
│ Today                       │
│ ⚠ Pod nginx-abc restarted  │
│   3 minutes ago • production│
│                             │
│ ✓ Deployment rollout done   │
│   15 minutes ago • staging  │
│                             │
│ 🤖 AI: Memory leak detected │
│   1 hour ago • monitoring   │
├─────────────────────────────┤
│ Earlier                     │
│ ...                         │
├─────────────────────────────┤
│ ⚙ Notification Preferences  │
└─────────────────────────────┘
```

**Notification Types:**
- Resource events: pod restarts, deployment rollouts, scaling events
- AI insights: anomalies detected, recommendations ready
- System: connection lost/restored, backend health changes
- Add-on: upgrade available, health degraded

**Estimated effort:** 5-7 days

---

### PERF-002: Bundle Optimization

**Current Likely Bundle Issues:**
1. Monaco Editor (~5MB uncompressed) loaded eagerly
2. Three.js (~600KB) loaded for topology even when not viewing 3D
3. Cytoscape loaded globally
4. Multiple chart libraries (Recharts + Chart.js potentially)
5. Full Framer Motion imported when only motion components needed

**Optimization Strategy:**
```typescript
// Lazy load heavy libraries
const MonacoEditor = lazy(() => import('./components/editor/MonacoEditor'));
const ThreeJSTopology = lazy(() => import('./components/topology/ThreeJSView'));
const CytoscapeView = lazy(() => import('./components/topology/CytoscapeView'));
```

**Bundle Budget:**
- Initial load (gzipped): < 500KB
- Route chunks: < 200KB each
- Total app (gzipped): < 2MB
- Largest single chunk: < 300KB

**Estimated effort:** 3-5 days

---

## Testing Strategy

### Unit Tests (Vitest)
- All 52 UI components: render, variants, states, accessibility
- All Zustand stores: state transitions, persistence
- All custom hooks: behavior, edge cases
- All utility functions: pure function testing

### Integration Tests (React Testing Library)
- Form submission flows
- Dialog open/close/confirm
- Table sorting, filtering, pagination
- Navigation flows

### E2E Tests (Playwright)
- Onboarding flow: welcome → connect → dashboard
- Resource CRUD: create, view, edit, delete
- Topology: load, interact, export
- AI: configure, investigate, review
- Dark mode toggle and persistence
- Responsive: test at 320px, 768px, 1024px, 1440px

### Accessibility Tests (axe-core + manual)
- Automated WCAG 2.1 AA scan on every page
- Keyboard navigation: all flows completable without mouse
- Screen reader: VoiceOver and NVDA walkthrough
- Color contrast: all text passes 4.5:1 ratio

### Performance Tests
- Lighthouse scores: Performance > 90, Accessibility > 95
- Bundle size within budget
- Table rendering: 5000 rows < 16ms
- Topology rendering: 1000 nodes < 3 seconds
- WebSocket reconnection: < 5 seconds

### Load Testing
- Simulate 100 concurrent WebSocket connections
- Test with clusters of 100, 500, 1000, 5000 resources
- Measure memory usage over 8-hour session
- Test backend under 50 concurrent API requests

---

## Implementation Timeline

| Week | Focus | Key Deliverables |
|------|-------|-----------------|
| 1 | Foundation | Design tokens, dark mode tokens, ThemeProvider |
| 2 | Onboarding | Welcome flow, zero-config start, AI wizard |
| 3 | Navigation | Sidebar restructure, resource browser, recents |
| 4 | AI Surface | AI buttons everywhere, dashboard insights, inline hints |
| 5 | Dashboard | Time range, trends, alerts position, customization start |
| 6 | Tables | Inline actions, multi-select, split pane, virtualization |
| 7 | Relationships | Resource relationships tab, enhanced topology |
| 8 | Polish | Micro-interactions, loading choreography, Storybook |
| 9 | Responsive | Mobile layouts, touch interactions, drawer sidebar |
| 10 | A11y | WCAG audit, fixes, screen reader testing |
| 11 | Brand | Topology Blue identity, illustrations, animations |
| 12 | Performance | Bundle optimization, virtualization, monitoring |
| 13 | Testing | Full E2E suite, load testing, accessibility verification |
| 14 | Bugs | Fix all issues found in testing |
| 15 | Polish | Final visual QA, animation refinement, documentation |
| 16 | Launch | Storybook publish, changelog, release notes |

---

*Total estimated effort: 16 weeks for 1-2 frontend engineers, or 8 weeks with a team of 3-4.*

---

*© 2026 Kubilitics Inc. | Implementation Tasks | Confidential*
