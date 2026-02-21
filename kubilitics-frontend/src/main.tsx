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
// call that both logs to console and captures to ErrorTracker.
reportWebVitals((metric) => {
  console.log(metric);
  ErrorTracker.captureMetric(metric);
});
