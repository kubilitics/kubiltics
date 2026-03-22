/**
 * Centralized React.lazy wrappers for heavy page-level components.
 *
 * These wrappers enable route-level code-splitting by deferring the import
 * of pages that pull in large dependency subtrees (Three.js, Cytoscape,
 * Monaco, Recharts). Use these in the router instead of direct lazy() calls
 * to keep import paths DRY and enable consistent chunk naming.
 *
 * All wrappers follow the same pattern:
 * - `React.lazy()` with dynamic `import()` for Vite chunk splitting
 * - Named exports are re-exported via `.then(m => ({ default: m.X }))`
 * - Comment annotations for `webpackChunkName` / Vite chunk hints
 *
 * @module lazy-imports
 *
 * @example
 * ```tsx
 * import { LazyTopologyPage, LazyYamlEditor, LazyDashboardCharts } from '@/lib/lazy-imports';
 *
 * <Suspense fallback={<PageSkeleton />}>
 *   <LazyTopologyPage />
 * </Suspense>
 * ```
 */
import { lazy, type ComponentType } from 'react';

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Creates a React.lazy wrapper with an optional artificial minimum delay.
 * The delay prevents layout flash when a chunk loads near-instantly from cache.
 *
 * @param factory - Dynamic import factory returning `{ default: ComponentType }`
 * @param minDelayMs - Minimum delay in ms (0 = no delay). Defaults to 0.
 */
function lazyWithMinDelay<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  minDelayMs = 0,
) {
  if (minDelayMs <= 0) return lazy(factory);

  return lazy(() =>
    Promise.all([
      factory(),
      new Promise<void>((resolve) => setTimeout(resolve, minDelayMs)),
    ]).then(([module]) => module),
  );
}

// ─── Topology Page (~300 kB: Cytoscape + ELK + Three.js) ───────────────────

/**
 * Lazy-loaded Topology page.
 * Defers the entire Cytoscape/Three.js dependency tree until the user
 * navigates to `/topology`. This is the single largest code-split win.
 *
 * Dependencies deferred: cytoscape, cytoscape-fcose, cytoscape-dagre,
 * cytoscape-cola, cytoscape-elk, elkjs, three, @react-three/*
 */
export const LazyTopologyPage = lazyWithMinDelay(
  () => import(/* webpackChunkName: "topology" */ '@/topology/TopologyPage').then(
    (m) => ({ default: m.TopologyPage as ComponentType<unknown> }),
  ),
);

// ─── YAML / Resource Editor (~400 kB: Monaco Editor) ────────────────────────

/**
 * Lazy-loaded YAML editor component backed by Monaco Editor.
 * Monaco is ~400 kB gzipped and should never be in the initial bundle.
 * This wrapper resolves the default export from `@monaco-editor/react`.
 *
 * Usage: wrap in `<Suspense>` with a skeleton or spinner fallback.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded-lg" />}>
 *   <LazyYamlEditor
 *     height="400px"
 *     language="yaml"
 *     value={yamlContent}
 *     onChange={setYamlContent}
 *     theme={isDark ? 'vs-dark' : 'light'}
 *   />
 * </Suspense>
 * ```
 */
export const LazyYamlEditor = lazyWithMinDelay(
  () => import(/* webpackChunkName: "monaco-editor" */ '@monaco-editor/react'),
);

// ─── Dashboard Charts (~80 kB: Recharts) ────────────────────────────────────

/**
 * Lazy-loaded Recharts container components.
 * Recharts is ~80 kB gzipped. By lazy-loading the chart wrapper,
 * pages that don't display charts (e.g. list views) avoid this cost.
 */
export const LazyResourceMetricsChart = lazyWithMinDelay(
  () =>
    import(
      /* webpackChunkName: "charts" */ '@/components/ResourceMetricsChart'
    ),
);


// ─── 3D Topology (~180 kB: Three.js + R3F) ─────────────────────────────────

/**
 * Lazy-loaded Cytoscape-based 2D topology component.
 * Use when embedding topology outside the full Topology page route.
 */
export const LazyCytoscapeTopology = lazyWithMinDelay(
  () =>
    import(
      /* webpackChunkName: "topology-cytoscape" */ '@/components/resources/CytoscapeTopology'
    ),
);

// ─── Export Utilities (~50 kB: jsPDF) ───────────────────────────────────────

/**
 * Lazy-loaded PDF/image export panel.
 * Defers jspdf and html-to-image dependencies.
 */
