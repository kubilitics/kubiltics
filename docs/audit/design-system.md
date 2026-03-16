# Kubilitics OS — Design System Audit

**Version:** 1.0
**Date:** 2026-03-16
**Scope:** Design tokens, component library, typography, color system, spacing, dark mode, accessibility

---

## Executive Summary

Kubilitics uses a **Tailwind CSS + Radix UI + shadcn/ui-style** design system with HSL-based CSS variables for theming. The system provides a solid foundation with 20+ Radix UI primitives, semantic color tokens, and a custom typography scale. However, the system lacks **formal documentation, component storybook, visual consistency enforcement, and complete dark mode coverage**.

**Design System Maturity Score: 5.5/10** — Functional but not formalized.

---

## 1. Typography System

### 1.1 Current Implementation

**Font Stack:** Custom Tailwind theme with semantic font sizes:

| Token | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `display` | Not defined | - | Page titles (missing) |
| `h1` | Not defined | - | Section headers (missing) |
| `h2` | Not defined | - | Card headers (missing) |
| `h3` | Not defined | - | Sub-sections (missing) |
| `body-lg` | Not defined | - | Emphasized body text |
| `body` | Default (1rem) | - | Standard body text |
| `body-sm` | Not defined | - | Secondary text |
| `caption` | Not defined | - | Labels, metadata |
| `code` | Monospace | - | Code blocks, YAML |

### 1.2 Issues

**DS-TYPO-01: No Defined Font Family (HIGH)**
The project uses system/default fonts. For a developer tool targeting premium positioning, a distinctive font choice is needed.

*Recommendation:* Select a distinctive monospace/sans-serif combination:
- Headers: JetBrains Mono, IBM Plex Sans, or Geist Sans
- Body: System sans-serif stack for performance
- Code: JetBrains Mono or Fira Code with ligatures

**DS-TYPO-02: Typography Scale Not Formalized (MEDIUM)**
While the Tailwind config references semantic sizes (display, h1-h5, body variants), these are not consistently applied across 130 pages. Headers use arbitrary Tailwind classes (`text-lg`, `text-xl`, `text-2xl`) rather than semantic tokens.

*Recommendation:* Define a strict type scale and enforce via custom Tailwind utilities:
```
display:  2.5rem / 1.1 / -0.02em  — Page titles
h1:       2rem / 1.2 / -0.015em   — Section headers
h2:       1.5rem / 1.3 / -0.01em  — Card headers
h3:       1.25rem / 1.4            — Sub-sections
body-lg:  1.125rem / 1.5           — Emphasized
body:     1rem / 1.5               — Standard
body-sm:  0.875rem / 1.5           — Secondary
caption:  0.75rem / 1.4            — Labels
code:     0.875rem / 1.6           — Monospace
```

---

## 2. Color System

### 2.1 Current Implementation

HSL-based CSS variables with light/dark mode support:

**Semantic Tokens:**
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--background` | White/near-white | Dark slate | Page background |
| `--foreground` | Dark slate | Near-white | Primary text |
| `--primary` | Brand color | Brand color | Buttons, links, active states |
| `--secondary` | Muted | Muted dark | Secondary buttons |
| `--destructive` | Red | Red | Delete, error actions |
| `--muted` | Light gray | Dark gray | Disabled, placeholder |
| `--accent` | Light highlight | Dark highlight | Hover backgrounds |
| `--card` | White | Dark card | Card backgrounds |
| `--popover` | White | Dark popover | Dropdown/dialog backgrounds |
| `--border` | Gray | Dark gray | Borders |
| `--input` | Gray | Dark input | Form input borders |
| `--ring` | Brand | Brand | Focus rings |

**Signal Colors:**
| Token | Usage |
|-------|-------|
| `--success` | Healthy states, successful operations |
| `--warning` | Degraded states, attention needed |
| `--error` | Failed states, critical issues |
| `--info` | Informational states |

**Topology Category Colors:**
| Category | Color | Hex (approx) |
|----------|-------|--------------|
| Compute | Blue | #3B82F6 |
| Networking | Cyan | #06B6D4 |
| Storage | Purple | #8B5CF6 |
| Security | Red | #EF4444 |
| Config | Orange | #F97316 |
| Scheduling | Yellow | #EAB308 |

### 2.2 Issues

**DS-COLOR-01: No Color Palette Documentation (HIGH)**
Color values exist in CSS variables but are not documented with:
- Usage guidelines (when to use primary vs accent)
- Contrast ratios for text/background combinations
- Do/don't examples

**DS-COLOR-02: Dark Mode Color Inconsistency (HIGH)**
Dark mode uses `hsl(228, 14%, 11%)` as the base dark background, but individual components define their own dark backgrounds (`dark:bg-slate-800`, `dark:bg-gray-900`, `dark:bg-zinc-900`). This creates visual inconsistency.

*Recommendation:* Enforce all dark backgrounds through CSS variable tokens. Ban direct `dark:bg-*` classes in favor of `bg-card`, `bg-background`, `bg-popover`.

**DS-COLOR-03: Color-Only Status Indicators (MEDIUM)**
Health status uses green/amber/red without accompanying icons or patterns. This fails WCAG 2.1 SC 1.4.1 (Use of Color).

*Recommendation:* Add status icons alongside colors: checkmark (healthy), warning triangle (degraded), x-circle (failed), info circle (unknown).

---

## 3. Component Library

### 3.1 Component Inventory

**Radix UI Primitives (20+):**
Accordion, AlertDialog, AspectRatio, Avatar, Checkbox, Collapsible, ContextMenu, Dialog, DropdownMenu, HoverCard, Label, Menubar, NavigationMenu, Popover, Progress, RadioGroup, ScrollArea, Select, Separator, Slider, Switch, Tabs, Toast, Toggle, ToggleGroup, Tooltip

**Custom Components (~240 files):**
| Category | Count | Examples |
|----------|-------|---------|
| UI Primitives | ~40 | Badge, Button, Card, Input, Table, Textarea |
| Layout | ~10 | Header, Sidebar, MainLayout, PageSkeleton |
| Dashboard | ~15 | HealthRing, MetricCard, AlertsStrip, PodDistribution |
| Topology | ~24 | BaseNode, CompactNode, Canvas, Toolbar, DetailPanel |
| AI | ~5 | AIAssistant, AIChat, AISetupModal |
| Shell | ~5 | Terminal, CompletionEngine, CommandInput |
| Loading | ~5 | PageSkeleton, PageLoadingState, CircuitBreakerBanner |
| Forms | ~10 | CreateProjectDialog, AddClusterDialog |
| Tables | ~10 | ResourceTable, DataTable, AIResourceColumns |
| Resource-Specific | ~100+ | Per-resource list/detail components |

### 3.2 Issues

**DS-COMP-01: No Component Storybook (HIGH)**
240 components with no visual documentation, interactive playground, or design review tool. New contributors have no way to discover existing components before building new ones.

*Recommendation:* Set up Storybook with at least the top 30 shared components documented. Include: Button (all variants), Card, Badge, Dialog, Table, Tabs, form inputs, topology nodes.

**DS-COMP-02: Component Duplication Risk (MEDIUM)**
With 240 component files across `components/`, `features/`, `topology/`, and `pages/`, there's risk of duplicate or near-duplicate components (e.g., different Card implementations, multiple table patterns).

*Recommendation:* Audit for duplicate patterns. Create a shared `ui/` component contract that all features import from.

**DS-COMP-03: No Component API Consistency (MEDIUM)**
Components likely have inconsistent prop patterns (some use `className`, others use `variant`, some use both). Without TypeScript strict mode, prop types may be loosely defined.

*Recommendation:* Establish component API conventions: `variant` for visual variants, `size` for size variants, `className` for style overrides, `asChild` for composition.

---

## 4. Spacing & Layout

### 4.1 Current Implementation

- **Base unit:** 8px (Tailwind default with `gap-6 = 24px`)
- **Page padding:** varies (`p-4`, `p-5`, `p-6`, `p-8`)
- **Card padding:** varies (`p-4`, `p-5`, `p-6`)
- **Grid system:** Tailwind grid with responsive breakpoints (sm, md, lg, xl)

### 4.2 Issues

**DS-SPACE-01: Inconsistent Page Padding (MEDIUM)**
Different pages use different padding values. Some use `p-4` (16px), others `p-6` (24px), others `p-8` (32px). This creates visual inconsistency as users navigate.

*Recommendation:* Define standard page layout tokens:
```
page-padding-x: 1.5rem (24px)
page-padding-y: 1.5rem (24px)
section-gap: 1.5rem (24px)
card-padding: 1.25rem (20px)
card-gap: 1rem (16px)
```

**DS-SPACE-02: No Layout Grid Documentation (LOW)**
The responsive grid behavior (when do cards stack, when do they go side-by-side) is not documented.

---

## 5. Icons

### 5.1 Current Implementation

- **Primary:** Lucide React (0.462.0) — 450+ icons
- **Custom:** SVG illustrations for specific Kubernetes resource types in topology nodes

### 5.2 Issues

**DS-ICON-01: No Kubernetes Resource Icon Set (MEDIUM)**
Kubernetes resources (Pod, Deployment, Service, etc.) use generic Lucide icons. The CNCF provides official Kubernetes resource icons that would improve recognition.

*Recommendation:* Use CNCF Kubernetes icons for topology nodes and resource headers. Fall back to Lucide for generic actions.

---

## 6. Motion & Animation

### 6.1 Current Implementation

**Libraries:**
- Framer Motion 12.23.26 — primary animation library
- GSAP 3.12.0 — heavy animations (underutilized)
- Tailwind animate — CSS keyframe animations
- Custom CSS animations (topology edge flow)

**Patterns:**
- `AnimatePresence` for enter/exit transitions
- `motion.div` for fade-in, slide, scale effects
- Staggered list reveals in AlertsStrip
- Topology edge dash-flow animation
- Hover effects: shadow elevation, color transitions

### 6.2 Issues

**DS-MOTION-01: Two Animation Libraries (MEDIUM)**
Framer Motion and GSAP serve overlapping purposes. GSAP is a 27KB additional dependency.

*Recommendation:* If GSAP is used in <5 components, migrate those animations to Framer Motion and remove GSAP.

**DS-MOTION-02: No Animation Design Tokens (LOW)**
Animation durations, easing functions, and stagger delays are hardcoded per-component.

*Recommendation:* Define motion tokens:
```
duration-fast: 150ms
duration-normal: 300ms
duration-slow: 500ms
easing-standard: cubic-bezier(0.4, 0, 0.2, 1)
easing-decelerate: cubic-bezier(0, 0, 0.2, 1)
easing-accelerate: cubic-bezier(0.4, 0, 1, 1)
stagger-delay: 50ms
```

---

## 7. Accessibility Audit

### 7.1 Strengths
- Radix UI provides ARIA attributes, focus management, keyboard navigation
- Topology nodes have `aria-label` with contextual descriptions
- `role="treeitem"`, `role="status"`, `role="note"` used appropriately
- `sr-only` class for screen reader content
- Focus visible outlines (`outline-2 outline-offset-2`)
- @axe-core/playwright for E2E a11y audits

### 7.2 Issues

**DS-A11Y-01: Color-Only Status (HIGH)**
Status indicators (healthy/degraded/failed) use color only. 8% of males have color vision deficiency.

*Recommendation:* Pair every status color with an icon: checkmark, warning, x-circle.

**DS-A11Y-02: Focus Management in Complex Flows (HIGH)**
Modal chains (e.g., Create Project → Select Clusters → Confirm) may not properly return focus on close. Topology canvas keyboard navigation requires learning custom shortcuts.

*Recommendation:* Audit focus trap behavior in all dialogs. Add visible keyboard shortcut hints in topology toolbar.

**DS-A11Y-03: Contrast Ratios Unverified (MEDIUM)**
The dark mode implementation likely has areas where text contrast falls below WCAG AA (4.5:1 for normal text, 3:1 for large text). Muted text on dark backgrounds is a common failure point.

*Recommendation:* Run axe-core contrast audit across all pages in both light and dark modes.

**DS-A11Y-04: Missing Skip Navigation (LOW)**
No "Skip to main content" link for keyboard/screen reader users to bypass the sidebar.

---

## 8. Design Token Architecture (Proposed)

```
tokens/
├── colors.css          # HSL color primitives + semantic mappings
├── typography.css      # Font families, sizes, weights, line-heights
├── spacing.css         # Base unit, page padding, card padding, gaps
├── motion.css          # Durations, easing functions, stagger delays
├── shadows.css         # Elevation levels (sm, md, lg, xl)
├── borders.css         # Border widths, radii
├── breakpoints.css     # Responsive breakpoints
└── z-index.css         # Z-index scale (dropdown, modal, toast, tooltip)
```

**Token Naming Convention:**
```
--kub-color-{semantic}-{shade}    e.g., --kub-color-primary-500
--kub-font-{role}                 e.g., --kub-font-heading
--kub-space-{size}                e.g., --kub-space-4 (16px)
--kub-motion-duration-{speed}     e.g., --kub-motion-duration-fast
--kub-shadow-{level}              e.g., --kub-shadow-md
--kub-radius-{size}               e.g., --kub-radius-lg
```

---

## 9. Recommendations Summary

| Priority | ID | Issue | Effort |
|----------|------|-------|--------|
| P0 | DS-COLOR-02 | Enforce dark mode through tokens only | Medium |
| P0 | DS-COMP-01 | Set up Storybook for top 30 components | Medium |
| P0 | DS-A11Y-01 | Add icons to all color-only status indicators | Small |
| P1 | DS-TYPO-01 | Select and implement distinctive font family | Small |
| P1 | DS-TYPO-02 | Formalize and enforce type scale | Medium |
| P1 | DS-COLOR-01 | Document color palette with usage guidelines | Medium |
| P1 | DS-SPACE-01 | Standardize page/card padding tokens | Medium |
| P1 | DS-A11Y-02 | Audit and fix focus management | Medium |
| P1 | DS-A11Y-03 | Run contrast ratio audit (both themes) | Medium |
| P2 | DS-MOTION-01 | Remove GSAP, consolidate to Framer Motion | Small |
| P2 | DS-MOTION-02 | Define motion design tokens | Small |
| P2 | DS-ICON-01 | Adopt CNCF Kubernetes icons | Medium |
| P2 | DS-COMP-02 | Audit for component duplication | Medium |

---

*End of Design System Audit — Kubilitics OS v1.0*
