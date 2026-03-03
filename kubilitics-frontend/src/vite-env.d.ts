/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Kubilitics backend base URL (e.g. http://localhost:819). Used when frontend talks to backend. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite ?worker import suffix — returns a Worker constructor from any module.
declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

/**
 * Compile-time constant injected by vite.config.ts `define`.
 * True when the frontend was built with TAURI_BUILD=true (i.e. for the desktop app).
 * This is timing-independent — unlike isTauri() which relies on __TAURI_INTERNALS__ injection,
 * this constant is baked into the JS bundle at build time and is always correct.
 */
declare const __VITE_IS_TAURI_BUILD__: boolean;
