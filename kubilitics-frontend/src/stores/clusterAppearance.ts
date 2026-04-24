/**
 * Per-cluster appearance settings — color, environment label, alias.
 *
 * Extracted from the legacy `clusterStore.ts` in Phase 7 Task 4 when that
 * monolith was dismantled. The appearance helpers are pure localStorage
 * utilities (no Zustand state, no cluster identity) and belong in their own
 * small module so their consumers (`Header`, `ProductionBanner`,
 * `ClusterAppearance` settings panel, `Sidebar`) don't have to keep alive
 * an otherwise-dead store just for `getClusterAppearance()`.
 *
 * Appearance is keyed by the backend session UUID. That's the same
 * identifier emitted by the presence layer's `ConnectedCluster.session_id`
 * (and `useActiveCluster()?.id` for the legacy-shaped view).
 */

export interface ClusterAppearance {
  color: string;        // hex color e.g. '#ef4444'
  environment: string;  // 'production' | 'staging' | 'development' | 'testing' | custom
  alias: string;        // short display name
}

const DEFAULT_APPEARANCE: ClusterAppearance = {
  color: '#3b82f6',     // blue
  environment: '',
  alias: '',
};

const APPEARANCE_STORAGE_KEY = 'kubilitics-cluster-appearance';

function loadAppearanceMap(): Record<string, ClusterAppearance> {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAppearanceMap(map: Record<string, ClusterAppearance>) {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(map));
}

export function getClusterAppearance(clusterId: string | undefined): ClusterAppearance {
  if (!clusterId) return DEFAULT_APPEARANCE;
  const map = loadAppearanceMap();
  return map[clusterId] ?? DEFAULT_APPEARANCE;
}

export function setClusterAppearance(clusterId: string, appearance: Partial<ClusterAppearance>): void {
  const map = loadAppearanceMap();
  map[clusterId] = { ...(map[clusterId] ?? DEFAULT_APPEARANCE), ...appearance };
  saveAppearanceMap(map);
}

/** Environment badge label mapping */
export function getEnvBadgeLabel(env: string): string | null {
  switch (env) {
    case 'production': return 'PROD';
    case 'staging': return 'STG';
    case 'development': return 'DEV';
    case 'testing': return 'TEST';
    default: return env ? env.toUpperCase().slice(0, 4) : null;
  }
}

/** Environment badge color classes */
export function getEnvBadgeClasses(env: string): string {
  switch (env) {
    case 'production': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800';
    case 'staging': return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800';
    case 'development': return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800';
    case 'testing': return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:border-sky-800';
    default: return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}
