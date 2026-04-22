/**
 * Zustand store for Events Intelligence UI state.
 * Stores filters, selected event, active mode, and analyze query.
 */
import { create } from 'zustand';
import type { AnalyzeQuery } from '@/services/api/eventsIntelligence';
import { onClusterSwitch } from './clusterSwitch';

export type EventsMode = 'timeline' | 'analyze' | 'incidents';

export interface EventsState {
  // Filters
  timeRange: string; // '1h', '6h', '24h', '7d'
  namespace: string;
  resourceKind: string;
  eventType: string;
  eventReason: string;

  // UI state
  mode: EventsMode;
  selectedEventId: string | null;
  contextPanelOpen: boolean;

  // Analyze query
  analyzeQuery: AnalyzeQuery | null;

  // Actions
  setTimeRange: (range: string) => void;
  setNamespace: (ns: string) => void;
  setResourceKind: (kind: string) => void;
  setEventType: (type: string) => void;
  setEventReason: (reason: string) => void;
  setMode: (mode: EventsMode) => void;
  selectEvent: (id: string | null) => void;
  setContextPanelOpen: (open: boolean) => void;
  setAnalyzeQuery: (query: AnalyzeQuery | null) => void;
  resetFilters: () => void;
}

const DEFAULT_FILTERS = {
  timeRange: '24h',
  namespace: '',
  resourceKind: '',
  eventType: '',
  eventReason: '',
};

export const useEventsStore = create<EventsState>()((set) => ({
  ...DEFAULT_FILTERS,
  mode: 'timeline',
  selectedEventId: null,
  contextPanelOpen: false,
  analyzeQuery: null,

  setTimeRange: (timeRange) => set({ timeRange }),
  setNamespace: (namespace) => set({ namespace }),
  setResourceKind: (resourceKind) => set({ resourceKind }),
  setEventType: (eventType) => set({ eventType }),
  setEventReason: (eventReason) => set({ eventReason }),
  setMode: (mode) => set({ mode }),
  selectEvent: (id) => set({ selectedEventId: id, contextPanelOpen: !!id }),
  setContextPanelOpen: (open) =>
    set({ contextPanelOpen: open, selectedEventId: open ? undefined : null }),
  setAnalyzeQuery: (analyzeQuery) => set({ analyzeQuery }),
  resetFilters: () => set(DEFAULT_FILTERS),
}));

// Phase 2 / Gap 4 — drop cluster-scoped slices on every cluster switch so
// stale filters/selection from the previous cluster never leak across.
onClusterSwitch(() => {
  useEventsStore.setState({
    ...DEFAULT_FILTERS,
    selectedEventId: null,
    contextPanelOpen: false,
    analyzeQuery: null,
  });
});
