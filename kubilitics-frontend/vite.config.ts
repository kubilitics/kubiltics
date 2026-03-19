import { defineConfig, createLogger, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";

const isTauriBuild = process.env.TAURI_BUILD === 'true';
// Tauri sets TAURI_ENV_PLATFORM during both `cargo tauri dev` and `cargo tauri build`.
// When present, we're running inside a real Tauri webview — do NOT mock the Tauri API.
const isTauriDev = !!process.env.TAURI_ENV_PLATFORM;

// Suppress noisy "ws proxy socket error: write EPIPE" messages that flood the
// console when the backend isn't running. These are harmless in dev — the
// frontend handles reconnection itself.
const logger = createLogger();
const originalError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (typeof msg === 'string' && msg.includes('ws proxy socket error')) return;
  originalError(msg, options);
};

// Tauri's tauri:// custom-protocol does not send CORS headers for its own assets.
// Vite emits <script type="module" crossorigin> and <link crossorigin> tags which
// instruct the browser to make CORS-mode requests — these are blocked by the WebView
// and the page renders blank. This plugin strips the crossorigin attribute from all
// tags in the emitted index.html when building for Tauri, and also reorders
// modulepreload hints so React (vendor-react) always loads before Radix UI (vendor-ui).
function removeCrossOriginPlugin(): Plugin {
  return {
    name: 'remove-crossorigin-for-tauri',
    apply: 'build',
    transformIndexHtml(html) {
      // Step 1: Remove crossorigin attribute (with or without a value) from all tags
      let result = html.replace(/\s+crossorigin(?:="[^"]*")?/gi, '');

      // Step 2: Reorder modulepreload hints so vendor-react comes before vendor-ui.
      // Tauri's WKWebView evaluates preloaded modules in the order they appear in HTML,
      // so React must be loaded before Radix UI (which calls React.forwardRef at init time).
      const preloadRegex = /(<link rel="modulepreload"[^>]*>)/g;
      const preloads: string[] = [];
      result = result.replace(preloadRegex, (match) => {
        preloads.push(match);
        return '%%PRELOAD%%';
      });

      // Sort: vendor-react first, then vendor (other deps), then vendor-ui, rest last
      const priority = (tag: string) => {
        if (tag.includes('vendor-react')) return 0;
        if (tag.includes('vendor-B') || (tag.includes('vendor') && !tag.includes('vendor-ui') && !tag.includes('vendor-icon') && !tag.includes('vendor-graph') && !tag.includes('vendor-anim'))) return 1;
        if (tag.includes('vendor-ui')) return 2;
        if (tag.includes('vendor-icon')) return 3;
        if (tag.includes('vendor-anim')) return 4;
        if (tag.includes('vendor-graph')) return 5;
        return 6;
      };
      preloads.sort((a, b) => priority(a) - priority(b));

      let i = 0;
      result = result.replace(/%%PRELOAD%%/g, () => preloads[i++]);
      return result;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  customLogger: logger,
  // Use relative paths for Tauri desktop builds (absolute paths don't work with tauri:// protocol)
  base: isTauriBuild ? './' : '/',
  // Bake build-time constants into the JS bundle so they are available at runtime
  // without any timing-dependent runtime checks (e.g. __TAURI_INTERNALS__ injection race).
  define: {
    // __VITE_IS_TAURI_BUILD__ is true when TAURI_BUILD=true was set during `npm run build`.
    // Use this instead of isTauri() / import.meta.env.DEV for URL routing decisions so
    // the correct backend URL is always used, even before __TAURI_INTERNALS__ is injected.
    __VITE_IS_TAURI_BUILD__: JSON.stringify(isTauriBuild),
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'jsdom',
  },
  server: {
    host: "::",
    // Use 5173 only; fail if port is in use instead of trying another
    port: 5173,
    strictPort: true,
    // Proxy API, WebSocket, and health to the MAIN backend (port 819).
    // The AI backend (port 8081) is called directly via absolute URLs (AI_BASE_URL in aiService.ts)
    // so no proxy entry is needed for it — that also avoids CORS issues in production.
    // Override with VITE_BACKEND_PORT env var if main backend runs on a different port.
    proxy: (() => {
      const port = process.env.VITE_BACKEND_PORT || "819";
      const target = `http://127.0.0.1:${port}`;
      const proxyOptions = (path: string) => ({
        target,
        changeOrigin: true,
        ...(path === "/api" ? { ws: true } : {}),
        configure: (proxy: any) => {
          // Suppress ECONNREFUSED / EPIPE proxy errors — frontend handles reconnect itself.
          proxy.on("error", () => {});
          // Suppress "ws proxy socket error: write EPIPE" — emitted when the browser
          // closes the WebSocket connection (e.g. navigating away) while the backend is
          // still writing. Harmless in dev; backend sees a closed socket and stops writing.
          proxy.on("proxyReqWs", (_proxyReq: any, _req: any, socket: any) => {
            socket.on("error", () => {});
          });
        },
      });
      return {
        "/api": proxyOptions("/api"),
        "/health": proxyOptions("/health"),
        "/ws": { target, changeOrigin: true, ws: true, configure: (proxy: any) => { proxy.on("error", () => {}); } },
      };
    })(),
  },
  plugins: [
    react(),
    // Only strip crossorigin in Tauri desktop builds
    isTauriBuild && removeCrossOriginPlugin(),
    // Bundle analysis — generates stats.html when ANALYZE=true
    process.env.ANALYZE === 'true' && visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@stores": path.resolve(__dirname, "./src/stores"),
      "@services": path.resolve(__dirname, "./src/services"),
      "@types": path.resolve(__dirname, "./src/types"),
      "@utils": path.resolve(__dirname, "./src/utils"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@i18n": path.resolve(__dirname, "./src/i18n"),
      // Only mock Tauri APIs when running in browser without Tauri.
      // In `cargo tauri dev` (TAURI_ENV_PLATFORM set) or production builds (TAURI_BUILD=true),
      // use the real @tauri-apps/api so IPC calls go to the Rust backend.
      ...((isTauriBuild || isTauriDev) ? {} : {
        "@tauri-apps/api/core": path.resolve(__dirname, "./src/mocks/tauri-core.ts"),
      }),
    },
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: mode !== "production",
    // Manual chunk splitting disabled — Vite/Rollup handles code splitting
    // automatically via dynamic import() boundaries. Manual manualChunks caused
    // cross-chunk React import failures (useLayoutEffect, createContext undefined)
    // due to nested dependencies (e.g. zustand inside @react-three/fiber) being
    // placed in chunks where React wasn't initialized during module evaluation.
    // Lazy-loaded routes still get their own chunks via dynamic import().
  },
}));
