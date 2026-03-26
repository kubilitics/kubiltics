---
name: frontend-design-audit
description: Audit and fix frontend UX — enforce spacing, typography, color, hierarchy, and interaction consistency. Use when reviewing UI code, fixing design issues, or building new components.
---

# Kubilitics Frontend Design Audit Skill

You are a senior product designer and frontend engineer. Your goal: make Kubilitics feel like Notion (clarity), Figma (precision), and Linear (speed).

## Design System Rules

### Spacing (8px scale)

All spacing MUST use the 8px grid. Tailwind equivalents:

| Token | px  | Tailwind | Use for |
|-------|-----|----------|---------|
| xs    | 4   | 1        | Icon gaps, inline elements |
| sm    | 8   | 2        | Compact padding, small gaps |
| md    | 12  | 3        | Standard padding, card body |
| lg    | 16  | 4        | Section gaps, card padding |
| xl    | 24  | 6        | Page padding, major sections |
| 2xl   | 32  | 8        | Page margins |

**Anti-patterns:**
- `py-[1px]`, `gap-[13px]`, any arbitrary pixel value
- Mixing p-2 and p-3 for same component type
- Different padding for same-level elements

### Typography Hierarchy

Use ONLY these sizes — no arbitrary `text-[Npx]` values:

| Level    | Class      | Weight      | Use for |
|----------|------------|-------------|---------|
| H1       | text-2xl   | font-bold   | Page titles |
| H2       | text-xl    | font-semibold | Section headers |
| H3       | text-lg    | font-semibold | Card titles |
| Body     | text-sm    | font-normal | Primary content |
| Caption  | text-xs    | font-medium | Labels, metadata, badges |
| Micro    | text-[10px]| font-medium | Topology node labels ONLY |

**Anti-patterns:**
- `text-[11px]`, `text-[13px]`, `text-[9px]`, `text-[7px]` — use text-xs or text-[10px]
- `text-[15px]` — use text-sm (14px)
- More than 2 font sizes on one component

### Color System (Semantic Only)

**Primary palette:**
| Token | Light | Dark | Use |
|-------|-------|------|-----|
| bg-background | white | slate-950 | Page background |
| bg-card | white | slate-900 | Card surfaces |
| bg-muted | slate-100 | slate-800 | Subtle backgrounds |
| text-foreground | slate-900 | slate-100 | Primary text |
| text-muted-foreground | slate-500 | slate-400 | Secondary text |
| border-border | slate-200 | slate-700 | Standard borders |

**Status colors:**
| Status | Background | Text | Dot |
|--------|-----------|------|-----|
| Healthy/Running | emerald-50 | emerald-700 | bg-emerald-500 |
| Warning/Pending | amber-50 | amber-700 | bg-amber-500 |
| Error/Failed | red-50 | red-700 | bg-red-500 |
| Unknown | slate-100 | slate-600 | bg-slate-400 |

**K8s brand:** Use `text-blue-600` / `bg-blue-600` — NOT `#326CE5` hex.

**Anti-patterns:**
- Inline hex colors (`bg-[#0d1117]`, `text-[#326CE5]`)
- Non-semantic one-off colors
- More than 3 colors competing on screen

### Border Radius

| Component | Class | px |
|-----------|-------|-----|
| Buttons, inputs | rounded-md | 6 |
| Cards, panels | rounded-lg | 8 |
| Modals, overlays | rounded-xl | 12 |
| Avatars, dots | rounded-full | 50% |

### Elevation (Shadows)

| Level | Class | Use |
|-------|-------|-----|
| 0 | none | Flat elements |
| 1 | shadow-sm | Cards, inputs |
| 2 | shadow-md | Dropdowns, popovers |
| 3 | shadow-lg | Modals, overlays |

---

## UX Heuristics

### Notion: Clarity + Structure
- Every screen has ONE clear purpose
- Content is grouped in blocks with clear boundaries
- Whitespace is generous — elements breathe
- No decorative elements that don't serve function

### Figma: Precision + Layout
- All elements align to the 8px grid
- Consistent spacing between repeated elements
- Visual weight distributed intentionally (not randomly)
- Components are same size when they represent same level

### Linear: Speed + Focus
- Primary action is obvious and one click away
- No unnecessary steps between user intent and result
- Loading states are immediate (skeleton, not spinner)
- Transitions are fast (150-200ms), not theatrical

---

## Topology-Specific Rules

### Node Cards
- ALL cards same width within a zoom level (260px base, 200px compact, 380px expanded)
- Long names TRUNCATE with tooltip — never stretch the card
- Category header: 28px height, bold uppercase kind label
- Body: name (text-sm bold), namespace (text-xs muted), status badge

### Edge Labels
- Maximum 20 characters
- Action-oriented: "owned by", "selects", "mounts", "uses SA"
- No filesystem paths, no IPs, no long selectors on canvas
- Verbose details go to the detail panel

### Mode Behavior
- **Direct**: Focus node + immediate neighbors. Zero noise.
- **Extended**: Direct + meaningful chains (ownership, networking, storage, rbac). No cross-service leakage.
- **Full**: Complete connected graph. Full-screen overlay. Category grouping.

### Focus Node
- Blue ring (3px) + glow shadow + scale(1.03) + z-index boost
- Always centered after layout
- "Center" button in toolbar to snap back

---

## Audit Checklist

For every screen, answer:

1. **Focus**: What is the user supposed to do here? Is it obvious in < 3 seconds?
2. **Hierarchy**: Is there a clear primary > secondary > tertiary visual order?
3. **Consistency**: Do same-level elements look identical?
4. **Spacing**: Is everything on the 8px grid?
5. **Typography**: Are only approved sizes used?
6. **Color**: Are colors semantic (not arbitrary hex)?
7. **Actions**: Is the primary action < 1 click away?
8. **Noise**: Can anything be removed without losing meaning?

### Severity Scale
- **P0 Critical**: Breaks functionality or blocks user
- **P1 Major**: Significant visual inconsistency or confusion
- **P2 Minor**: Off-grid spacing, wrong font size
- **P3 Polish**: Could be cleaner but doesn't impede

---

## Anti-Patterns to Flag

| Anti-Pattern | Detection | Fix |
|---|---|---|
| Arbitrary text sizes | `text-[11px]`, `text-[13px]`, `text-[9px]` | Use text-xs or text-[10px] |
| Hex colors in code | `bg-[#...]`, `text-[#...]` | Use semantic Tailwind classes |
| Inconsistent card sizes | min-w + max-w allowing stretch | Fixed width (w-[260px]) |
| Overlapping edge labels | Multiple edges between same nodes | Deduplicate in transformGraph |
| Events in topology | Event nodes cluttering graph | Filter in transformGraph |
| Competing visual weight | Multiple bold/large elements | One primary per view |
| Deep nesting | 4+ levels of containers | Flatten with grid/flex |
| Spinner overuse | Full-page spinners | Use skeleton loading |
