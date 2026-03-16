# Kubilitics — Task Rewrite: UX & Design System

**Source:** Design Critique Report + Design System Audit
**Date:** 2026-03-16
**Priority Framework:** P0 = blocks launch, P1 = blocks growth, P2 = competitive advantage

---

## Sprint 1: Design Foundations (2 weeks)

### TASK-UX-001: Design Token Formalization (P0) ✅
**Goal:** Consistent visual language across 240 components
**Acceptance Criteria:**
- [x] Create `tokens/` directory with: colors.css, typography.css, spacing.css, motion.css
- [x] Typography: define scale (display → caption) with font-size, line-height, letter-spacing
- [x] Spacing: standardize page-padding (24px), card-padding (20px), section-gap (24px)
- [x] Motion: define duration-fast (150ms), duration-normal (300ms), easing-standard
- [x] Migrate top 20 most-used components to token-based styles

### TASK-UX-002: Font Selection (P1) ✅
**Goal:** Distinctive typography for premium developer tool
**Acceptance Criteria:**
- [x] Select sans-serif: JetBrains Mono or Geist Sans for headings
- [x] Body: system font stack for performance
- [x] Code: JetBrains Mono with ligatures
- [x] Implement via Tailwind theme fontFamily override
- [x] Self-host fonts (no external CDN dependency for offline desktop)

### TASK-UX-003: Status Indicators — Icon + Color (P0) ✅
**Goal:** WCAG 2.1 SC 1.4.1 compliance (no color-only information)
**Acceptance Criteria:**
- [x] Create `StatusBadge` component with icon+color for every status
- [x] Healthy: checkmark circle (green), Warning: triangle (amber), Error: x-circle (red), Unknown: question (gray)
- [x] Replace all color-only status indicators across Dashboard, resource lists, topology
- [x] Test with color blindness simulator (deuteranopia, protanopia)

### TASK-UX-004: Storybook Setup (P0) ✅
**Goal:** Component documentation and visual regression testing
**Acceptance Criteria:**
- [x] Storybook configured with Vite builder
- [x] Document top 30 components: Button, Card, Badge, Dialog, Table, Tabs, Select, Input, Tooltip, Toast, StatusBadge, MetricCard, HealthRing, ResourceTable
- [x] Each story shows: default, variants, sizes, dark mode, interactive controls
- [x] Deploy Storybook to GitHub Pages (CI pipeline)

---

## Sprint 2: Key UX Improvements (2 weeks)

### TASK-UX-005: Dashboard Time Range Selector (P0) ✅
**Goal:** Enable temporal analysis on Dashboard
**Acceptance Criteria:**
- [x] Time range picker: Last 15m / 1h / 6h / 24h / 7d / Custom
- [x] Selector in Dashboard header (persistent across tab switches)
- [x] All Dashboard widgets respect selected time range
- [x] Events list filtered by time range
- [x] Metrics cards show trend arrow (up/down from previous period)

### TASK-UX-006: Inline Table Actions (P1) ✅
**Goal:** Reduce clicks for common operations
**Acceptance Criteria:**
- [x] Hover-revealed action buttons on resource table rows
- [x] Actions: Scale (Deployments/SS), Restart, Delete, View YAML
- [x] Multi-select checkbox column for batch operations
- [x] Batch actions toolbar: "Delete Selected", "Restart Selected"
- [x] Keyboard shortcut: Enter = open detail, Delete = delete with confirm

### TASK-UX-007: Table Density Toggle (P2) ✅
**Goal:** Accommodate power users and casual users
**Acceptance Criteria:**
- [x] Toggle in table header: compact / comfortable / spacious
- [x] Compact: 32px row height, smaller font
- [x] Comfortable: 44px row height (default)
- [x] Spacious: 56px row height, larger font
- [x] Persist preference in localStorage

### TASK-UX-008: Page-Specific Loading Skeletons (P1) ✅
**Goal:** Reduce perceived loading time
**Acceptance Criteria:**
- [x] Dashboard skeleton: card grid layout with shimmer
- [x] Topology skeleton: canvas area with faded graph placeholder
- [x] Resource list skeleton: table header + row shimmers
- [x] Resource detail skeleton: metadata + tabs layout
- [x] Staggered reveal animation (cards appear sequentially, 50ms delay)

---

## Sprint 3: Accessibility & Polish (2 weeks)

### TASK-UX-009: WCAG 2.1 AA Contrast Audit (P1) ✅
**Goal:** Accessible to all users including those with visual impairments
**Acceptance Criteria:**
- [x] Run axe-core automated scan across all pages (light + dark mode)
- [x] Fix all contrast ratio failures (4.5:1 normal text, 3:1 large text)
- [x] Audit muted text colors in dark mode (most common failure point)
- [x] Document approved color combinations in design tokens

### TASK-UX-010: Focus Management Audit (P1) ✅
**Goal:** Keyboard users can navigate all flows
**Acceptance Criteria:**
- [x] All modals/dialogs trap focus correctly
- [x] Focus returns to trigger element on modal close
- [x] Skip navigation link added to MainLayout
- [x] Topology: visible keyboard shortcut hints in toolbar
- [x] Tab order follows visual layout on all pages

### TASK-UX-011: Empty State Library (P1) ✅
**Goal:** Every empty state tells users what to do next
**Acceptance Criteria:**
- [x] Create `EmptyState` component with: illustration, title, description, primary CTA
- [x] Implement for: no clusters, no workloads, no metrics, no events, no add-ons, disconnected
- [x] Each empty state has a clear next action (connect cluster, deploy workload, install add-on)
- [x] Consistent visual style across all empty states

### TASK-UX-012: Micro-Interactions (P2) ✅
**Goal:** UI feels alive and responsive to state changes
**Acceptance Criteria:**
- [x] Badge counters animate when value changes
- [x] Cards pulse briefly when data updates (via WebSocket)
- [x] Toast notifications for significant state changes (pod crash, deployment complete)
- [x] Smooth page transitions (exit → enter animations)

---

## Backlog

### TASK-UX-013: Dark Mode Variable Enforcement (P1) ✅
Lint rule: ban direct `dark:bg-*` classes; enforce `bg-card`, `bg-background`, `bg-popover`. Implemented in `src/lib/lint-dark-mode.ts`.

### TASK-UX-014: CNCF Kubernetes Icons (P2) ✅
Replace generic Lucide icons for K8s resources with official CNCF icon set. Implemented in `src/components/icons/KubernetesIcons.tsx`.

### TASK-UX-015: Remove GSAP (P2) ✅
Migrate remaining GSAP animations to Framer Motion, remove 27KB dependency. Migration guide in `src/lib/gsapMigration.ts`.

### TASK-UX-016: Right-to-Left (RTL) Support (P2) ✅
For future i18n with Arabic/Hebrew locales. Implemented in `src/lib/rtlSupport.ts` and `src/hooks/useDirection.ts`.

---

*Total Tasks: 16 | P0: 4 | P1: 7 | P2: 5 | ✅ All Complete*
