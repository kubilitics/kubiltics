# Tasks Part 1 — P0 Implementation Details (Ship-Blocking)

## UX-001: Welcome & Onboarding Flow

### Files to Create
- `src/components/onboarding/WelcomeScreen.tsx` — Full-screen welcome with hero animation
- `src/components/onboarding/OnboardingTour.tsx` — Step-by-step feature tour overlay
- `src/components/onboarding/OnboardingStep.tsx` — Individual tour step with spotlight
- `src/components/onboarding/OnboardingProgress.tsx` — Progress dots/steps indicator
- `src/stores/onboardingStore.ts` — Track completion state (Zustand + persist)

### Files to Modify
- `src/App.tsx` — Add onboarding route, check onboarding completion status
- `src/pages/ModeSelection.tsx` — Move to step 3 of welcome flow

### Implementation Steps
1. Create WelcomeScreen with: Kubilitics logo animation (scale up + fade), tagline "Kubernetes, Made Human", three feature highlights (Topology, AI, Offline), "Get Started" CTA
2. Feature highlights screen: animated cards showing topology visualization, AI investigation, offline desktop
3. Mode selection (existing, enhanced with better labels)
4. Product tour (on first dashboard load): spotlight overlay highlighting sidebar, dashboard widgets, AI button, topology link
5. Store onboarding completion in localStorage via Zustand persist

### Acceptance Criteria
- First-time user sees welcome before any configuration
- Tour highlights 5 key features with dismiss option
- Returning users skip directly to last-used page
- Tour can be replayed from Settings

---

## UX-002: Zero-Config Auto-Start

### Files to Modify
- `src/pages/ModeSelection.tsx` — Add auto-detection logic
- `src/App.tsx` — Route conditionally based on kubeconfig detection
- `src/pages/ClusterConnect.tsx` — Add "Quick Connect" single-button path

### Implementation Steps
1. On app launch, check if kubeconfig exists at ~/.kube/config (Tauri API)
2. If found and has exactly 1 context: show "Connect to [cluster-name]?" with single button
3. If found and has multiple contexts: show context picker (simplified, not full ClusterConnect)
4. If not found: show current mode selection flow
5. Add "Skip" option that goes to full ClusterConnect for advanced users

### Acceptance Criteria
- Single-context users connect in 1 click after welcome
- Multi-context users connect in 2 clicks (pick context + confirm)
- Time from launch to dashboard: under 15 seconds for single-context

---

## UX-003: Complete Dark Mode

### Files to Create
- `src/providers/ThemeProvider.tsx` — Theme context with system/light/dark
- `src/stores/themeStore.ts` — Zustand store for theme preference
- `src/components/ui/ThemeToggle.tsx` — Sun/Moon/System toggle button

### Files to Modify
- `src/App.tsx` — Wrap with ThemeProvider
- `src/index.css` — Add dark mode CSS variable overrides
- `src/components/layout/Header.tsx` — Add ThemeToggle to header controls
- All 52 files in `src/components/ui/` — Audit dark mode coverage
- All 150+ page files — Audit dark mode coverage

### Dark Mode Token Set
```css
.dark {
  --background: 222 47% 6%;         /* Deep navy, not pure black */
  --foreground: 210 40% 95%;
  --card: 222 47% 8%;
  --card-foreground: 210 40% 95%;
  --popover: 222 47% 10%;
  --primary: 217 91% 60%;           /* Brighter blue for dark */
  --primary-foreground: 222 47% 6%;
  --secondary: 217 33% 17%;
  --muted: 217 33% 14%;
  --muted-foreground: 215 20% 60%;
  --accent: 217 33% 17%;
  --destructive: 0 63% 55%;
  --border: 217 33% 17%;
  --input: 217 33% 17%;
  --ring: 217 91% 60%;
  --success: 142 71% 45%;
  --warning: 38 92% 50%;
  --error: 0 84% 60%;
  --info: 217 91% 60%;
}
```

### Acceptance Criteria
- Toggle between Light, Dark, and System in header
- All components render correctly in dark mode
- No white flashes during page transitions in dark mode
- System option follows OS prefers-color-scheme
- Preference persists across sessions

---

## UX-004: Sidebar Navigation Restructure

### New Navigation Hierarchy
```
1. Home (/ home) — icon: Home
2. Dashboard (/dashboard) — icon: LayoutDashboard
3. Resources — icon: Box (expandable)
   ├── All Resources (/resources) — unified browser
   ├── Workloads (/workloads)
   ├── Networking (/networking)
   ├── Storage (/storage)
   ├── Cluster (/cluster-overview)
   ├── RBAC (/serviceaccounts)
   └── Advanced (/crds)
4. Intelligence — icon: Brain (expandable)
   ├── Topology (/topology)
   ├── AI Assistant (/ai)
   └── Analytics (/analytics)
5. Add-ons (/addons) — icon: Puzzle
6. Settings (/settings) — icon: Settings (bottom-pinned)
```

### Files to Create
- `src/components/layout/ResourceBrowser.tsx` — Searchable, filterable resource tree
- `src/components/layout/RecentResources.tsx` — Last 10 viewed resources
- `src/stores/navigationStore.ts` — Recent resources, favorites

### Files to Modify
- `src/components/layout/Sidebar.tsx` — Complete restructure
- `src/components/layout/AppLayout.tsx` — Update layout if needed

### Acceptance Criteria
- Maximum 6 top-level items visible without scrolling
- Resource Browser shows all resource types with search filter
- Recent Resources shows last 10 with timestamps
- Collapsed sidebar shows only 6 distinct icons

---

## UX-005: AI Integration Everywhere

### Files to Create
- `src/components/ai/AIContextButton.tsx` — "Ask AI about this [resource]" button
- `src/components/ai/AIInlineInsight.tsx` — Inline AI hypothesis for error states
- `src/components/dashboard/AIInsightsWidget.tsx` — Dashboard widget

### Files to Modify
- Resource detail page layouts — Add AIContextButton
- `src/features/dashboard/components/DashboardLayout.tsx` — Add AIInsightsWidget
- `src/components/layout/Header.tsx` — Add autonomy level indicator
- Pod/Deployment status badge components — Add inline AI for errors

### Implementation Steps
1. AIContextButton: renders a sparkle icon button, on click opens AI panel pre-loaded with resource context (kind, name, namespace, status, events)
2. AIInlineInsight: when a pod shows CrashLoopBackOff/OOMKilled/Error, show a subtle card: "AI suggests: [one-line hypothesis]. Click to investigate"
3. AIInsightsWidget: shows top 3 AI-detected issues across cluster, each clickable to expand investigation
4. Autonomy level badge in header: shows current level (1-5) with color coding, click to change

### Acceptance Criteria
- Every resource detail page has "Ask AI" button
- Error states show inline AI hypothesis
- Dashboard shows AI insights without manual trigger
- Autonomy level visible and adjustable from header

---

## DS-001: Formalize Design Tokens

### Files to Modify
- `tailwind.config.ts` — Add semantic color tokens, type scale, spacing scale
- `src/index.css` — Add CSS variable definitions for all tokens

### Token Definitions

**Semantic Colors (add to both light and dark):**
```
--success: 142 71% 45%;
--success-foreground: 0 0% 100%;
--warning: 38 92% 50%;
--warning-foreground: 0 0% 100%;
--error: 0 84% 60%;
--error-foreground: 0 0% 100%;
--info: 217 91% 60%;
--info-foreground: 0 0% 100%;
```

**Type Scale (as Tailwind extension):**
```
display: ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
h1: ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
h2: ['1.875rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
h3: ['1.5rem', { lineHeight: '1.4', fontWeight: '600' }],
h4: ['1.25rem', { lineHeight: '1.4', fontWeight: '600' }],
h5: ['1.125rem', { lineHeight: '1.5', fontWeight: '600' }],
body-lg: ['1.125rem', { lineHeight: '1.6' }],
body: ['1rem', { lineHeight: '1.6' }],
body-sm: ['0.875rem', { lineHeight: '1.5' }],
caption: ['0.75rem', { lineHeight: '1.4' }],
overline: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.05em', fontWeight: '600' }],
code: ['0.875rem', { lineHeight: '1.5', fontFamily: 'JetBrains Mono' }],
```

### Acceptance Criteria
- All status colors defined as global CSS variables
- Type scale documented and used consistently
- No ad-hoc color values in component files

---

## A11Y-001: Status Indicators Shape + Color

### Files to Create
- `src/components/ui/StatusIndicator.tsx` — Unified status component

### Component API
```tsx
<StatusIndicator
  status="healthy" | "warning" | "error" | "pending" | "info" | "unknown"
  size="sm" | "md" | "lg"
  showLabel?: boolean
  label?: string
/>
```

### Visual Design
- healthy: ✓ checkmark + green circle
- warning: ⚠ triangle + amber circle
- error: ✕ cross + red circle
- pending: ⏳ hourglass + gray circle (with pulse animation)
- info: ℹ info + blue circle
- unknown: ? question + gray circle

### Files to Modify
- All sidebar NavItem components showing status dots
- All table status columns
- Dashboard health widgets
- Topology node status indicators
- Header cluster status badges

### Acceptance Criteria
- No color-only status indicators remain in the app
- All statuses identifiable by colorblind users (8% of male population)
- Screen readers announce status text, not just color
