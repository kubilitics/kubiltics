/**
 * Monaco Editor local loading configuration.
 *
 * CRITICAL for Tauri desktop: The default @monaco-editor/react loader fetches
 * Monaco from cdn.jsdelivr.net which is blocked by Tauri's Content Security
 * Policy (script-src doesn't allow external scripts). This module configures
 * Monaco to use the locally bundled package instead, so the editor works
 * offline and inside Tauri's strict CSP.
 *
 * Must be imported BEFORE any <Editor /> component renders (i.e. in main.tsx).
 */

// 1. Configure web workers BEFORE Monaco initializes.
//    Vite's ?worker suffix inlines the worker as a blob URL — no CDN needed.
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, _label: string) {
    // YAML only needs the base editor worker (no language-specific worker).
    return new editorWorker();
  },
};

// 2. Import Monaco locally and configure @monaco-editor/react to use it.
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

loader.config({ monaco });

export { monaco };
