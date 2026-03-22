/**
 * Analytics Service
 *
 * FIX P2-005: Replaced console.log stubs with silent no-ops for production.
 * When a real analytics provider (e.g. PostHog, Amplitude, Mixpanel) is
 * integrated, replace these with actual SDK calls. The Tauri desktop app
 * checks analytics consent via `get_analytics_consent` before any tracking.
 */

// Set to true during development to see analytics events in the console.
const DEBUG_ANALYTICS = import.meta.env?.DEV === true;

function debugLog(...args: unknown[]) {
  if (DEBUG_ANALYTICS) {
    console.debug('[Analytics]', ...args);
  }
}

export const analyticsService = {
  trackEvent: (category: string, action: string, label?: string) => {
    debugLog('trackEvent:', category, action, label);
  },
  init: () => {
    debugLog('init');
  },
  pageView: (path: string) => {
    debugLog('pageView:', path);
  },
  trackFeatureUsage: (feature: string, action: string) => {
    debugLog('trackFeatureUsage:', feature, action);
  },
  trackAppStart: () => {
    debugLog('trackAppStart');
  },
};
