/**
 * Bundle Size Analysis & Optimization Guide
 *
 * This module documents the heavy dependencies in the Kubilitics frontend bundle
 * and provides dynamic import wrappers to enable code-splitting. Use these
 * wrappers instead of static imports to keep the initial bundle lean.
 *
 * @module bundle-analysis
 *
 * ## Heavy Dependencies (estimated gzip sizes)
 *
 * | Dependency             | Est. gzip | Used by                          | Strategy         |
 * |------------------------|-----------|----------------------------------|------------------|
 * | three + @react-three/* | ~180 kB   | 3D topology visualization        | Lazy route       |
 * | cytoscape + plugins    | ~120 kB   | 2D topology graph (CytoscapeTopology) | Lazy route  |
 * | gsap                   | ~30 kB    | Micro-animations (onboarding)    | Dynamic import   |
 * | monaco-editor          | ~400 kB   | YAML editor (resource edit)      | Dynamic import   |
 * | recharts               | ~80 kB    | Dashboard charts                 | Lazy route       |
 * | d3                     | ~60 kB    | Custom SVG charts                | Dynamic import   |
 * | @codemirror/*          | ~90 kB    | YAML editor (add-on values)      | Dynamic import   |
 * | elkjs                  | ~35 kB    | ELK layout for topology          | Dynamic import   |
 * | jspdf                  | ~50 kB    | PDF export                       | Dynamic import   |
 *
 * ## Optimization Strategy
 *
 * 1. **Route-level splitting**: All page components are already `React.lazy()` in App.tsx.
 *    This naturally code-splits Three.js, Cytoscape, and Recharts into their route chunks.
 *
 * 2. **Component-level splitting**: Heavy editor components (Monaco, CodeMirror) should be
 *    loaded via the dynamic import wrappers in `lazy-imports.ts`.
 *
 * 3. **Library-level splitting**: Utility libraries (GSAP, jsPDF, d3) should be dynamically
 *    imported at the call site using the helpers below.
 *
 * 4. **Vite config**: Use `build.rollupOptions.output.manualChunks` to isolate vendor chunks.
 *    The `rollup-plugin-visualizer` devDep can generate treemaps for analysis.
 *
 * ## Measuring Bundle Size
 *
 * ```bash
 * # Generate a visual bundle treemap
 * ANALYZE=true npm run build
 *
 * # Check individual chunk sizes
 * ls -lhS dist/assets/*.js | head -20
 * ```
 */

// ─── Dynamic Import Wrappers for Heavy Libraries ────────────────────────────

/**
 * Dynamically imports GSAP (GreenSock Animation Platform).
 * Use this instead of `import gsap from 'gsap'` to avoid bundling ~30 kB
 * in the initial chunk.
 *
 * @example
 * ```ts
 * const gsap = await loadGsap();
 * gsap.to(element, { opacity: 1, duration: 0.5 });
 * ```
 */
export async function loadGsap() {
  const { gsap } = await import('gsap');
  return gsap;
}

/**
 * Dynamically imports jsPDF for PDF generation.
 * Only loaded when the user triggers a PDF export (~50 kB saved).
 *
 * @example
 * ```ts
 * const jsPDF = await loadJsPdf();
 * const doc = new jsPDF();
 * doc.text('Hello', 10, 10);
 * doc.save('report.pdf');
 * ```
 */
export async function loadJsPdf() {
  const { jsPDF } = await import('jspdf');
  return jsPDF;
}

/**
 * Dynamically imports D3 visualization library.
 * Use for custom SVG chart rendering (~60 kB saved).
 *
 * @example
 * ```ts
 * const d3 = await loadD3();
 * d3.select('#chart').append('svg');
 * ```
 */
export async function loadD3() {
  const d3 = await import('d3');
  return d3;
}

/**
 * Dynamically imports ELK.js layout engine for topology graphs.
 * Only needed when user selects ELK layout algorithm (~35 kB saved).
 *
 * @example
 * ```ts
 * const ELK = await loadElk();
 * const elk = new ELK();
 * const layout = await elk.layout(graph);
 * ```
 */
export async function loadElk() {
  const ELK = await import('elkjs/lib/elk.bundled.js');
  return ELK.default;
}

/**
 * Dynamically imports Cytoscape core + layout plugins.
 * Use when rendering the 2D topology graph outside the lazy-loaded route.
 *
 * @example
 * ```ts
 * const { cytoscape, fcose } = await loadCytoscape();
 * cytoscape.use(fcose);
 * const cy = cytoscape({ container, elements });
 * ```
 */
export async function loadCytoscape() {
  const [cyModule, fcoseModule, dagreModule, colaModule] = await Promise.all([
    import('cytoscape'),
    import('cytoscape-fcose'),
    import('cytoscape-dagre'),
    import('cytoscape-cola'),
  ]);
  return {
    cytoscape: cyModule.default,
    fcose: fcoseModule.default,
    dagre: dagreModule.default,
    cola: colaModule.default,
  };
}

/**
 * Dynamically imports Monaco Editor React component.
 * The Monaco editor is ~400 kB gzipped; defer until the user opens
 * a YAML editor or resource edit view.
 *
 * @example
 * ```ts
 * const { Editor } = await loadMonacoEditor();
 * // Use <Editor language="yaml" value={yaml} onChange={setYaml} />
 * ```
 */
export async function loadMonacoEditor() {
  const { default: Editor } = await import('@monaco-editor/react');
  return { Editor };
}

/**
 * Dynamically imports CodeMirror modules for lightweight YAML editing.
 * Smaller alternative to Monaco (~90 kB combined).
 *
 * @example
 * ```ts
 * const cm = await loadCodeMirror();
 * // Use cm.yaml(), cm.oneDark, cm.EditorView, etc.
 * ```
 */
export async function loadCodeMirror() {
  const [viewModule, stateModule, yamlModule, themeModule, commandsModule] =
    await Promise.all([
      import('@codemirror/view'),
      import('@codemirror/state'),
      import('@codemirror/lang-yaml'),
      import('@codemirror/theme-one-dark'),
      import('@codemirror/commands'),
    ]);
  return {
    EditorView: viewModule.EditorView,
    EditorState: stateModule.EditorState,
    yaml: yamlModule.yaml,
    oneDark: themeModule.oneDark,
    ...commandsModule,
  };
}

// ─── Bundle Size Constants ──────────────────────────────────────────────────

/**
 * Approximate gzipped sizes for documentation/monitoring purposes.
 * Update these when upgrading major dependency versions.
 */
export const BUNDLE_SIZE_ESTIMATES = {
  'three + @react-three': '~180 kB',
  'cytoscape + plugins': '~120 kB',
  'monaco-editor': '~400 kB',
  '@codemirror/*': '~90 kB',
  recharts: '~80 kB',
  d3: '~60 kB',
  jspdf: '~50 kB',
  elkjs: '~35 kB',
  gsap: '~30 kB',
} as const;
