// PERF: Monaco setup deferred — it imports the full monaco-editor package (~4MB).
// Setup now lives in lib/monacoSetup.ts and is called lazily before any <Editor/>
// renders (via the lazy-import wrapper). No longer blocks initial paint.

// Self-hosted fonts (no external CDN — works offline in Tauri desktop)
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import './i18n/i18n'; // Initialize i18n
import reportWebVitals from './reportWebVitals';
import { ErrorTracker } from './lib/errorTracker';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';

// FIX TASK-001: GlobalErrorBoundary must wrap the entire app at the root level.
// Without this, errors thrown during QueryClientProvider or App initialization are
// uncaught and produce a blank white screen rather than the user-friendly error card.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>
);

// FIX TASK-033: reportWebVitals was being called twice. Consolidated into a single
// call that captures to ErrorTracker.
reportWebVitals((metric) => {
  ErrorTracker.captureMetric(metric);
});
