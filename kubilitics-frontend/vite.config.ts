import { defineConfig, createLogger, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";
import { readFileSync } from "fs";
import type { Server as HttpProxyServer } from "http-proxy";
import type { IncomingMessage } from "http";
import type { Socket } from "net";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

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
    __VITE_APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
  server: {
    host: "::",
    // Use 5173 only; fail if port is in use instead of trying another
    port: 5173,
    strictPort: true,
    // Proxy API, WebSocket, and health to the backend (port 8190).
    // Override with VITE_BACKEND_PORT env var if main backend runs on a different port.
    proxy: (() => {
      const port = process.env.VITE_BACKEND_PORT || "8190";
      const target = `http://127.0.0.1:${port}`;
      const proxyOptions = (path: string) => ({
        target,
        changeOrigin: true,
        ...(path === "/api" ? { ws: true } : {}),
        configure: (proxy: HttpProxyServer) => {
          // Suppress ECONNREFUSED / EPIPE proxy errors — frontend handles reconnect itself.
          proxy.on("error", () => {});
          // Suppress "ws proxy socket error: write EPIPE" — emitted when the browser
          // closes the WebSocket connection (e.g. navigating away) while the backend is
          // still writing. Harmless in dev; backend sees a closed socket and stops writing.
          proxy.on("proxyReqWs", (_proxyReq: IncomingMessage, _req: IncomingMessage, socket: Socket) => {
            socket.on("error", () => {});
          });
        },
      });
      return {
        "/api": proxyOptions("/api"),
        // /healthz (not /health — the SPA owns /health for the Health Dashboard route).
        "/healthz": proxyOptions("/healthz"),
        "/ws": { target, changeOrigin: true, ws: true, configure: (proxy: HttpProxyServer) => { proxy.on("error", () => {}); } },
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
    // Split heavy vendor libraries into dedicated chunks. Only libraries that are
    // self-contained (no React internals at init time) are safe to separate.
    // React/Radix are NOT split here — that caused cross-chunk useLayoutEffect/
    // createContext failures. Vite's natural code-splitting handles those correctly.
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Monaco Editor core (~3.5MB) — self-contained, no React dependency
          if (id.includes('monaco-editor') && !id.includes('@monaco-editor/react')) {
            return 'vendor-monaco';
          }
          // Monaco React wrapper (~15KB) — thin wrapper, safe to separate
          if (id.includes('@monaco-editor/react')) {
            return 'vendor-monaco-react';
          }
          // xterm terminal emulator (~150KB) — no React dependency
          if (id.includes('@xterm/xterm') || id.includes('@xterm/addon-fit')) {
            return 'vendor-terminal';
          }
          // recharts (~200KB) — isolate so list pages don't pay chart cost
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts';
          }
          // elkjs layout engine (~200KB) — only used by topology
          if (id.includes('elkjs')) {
            return 'vendor-elk';
          }
          // jsPDF (~100KB) — only used for PDF export
          if (id.includes('jspdf')) {
            return 'vendor-pdf';
          }
          // CodeMirror (~90KB) — YAML editor alternative
          if (id.includes('@codemirror') || id.includes('@lezer')) {
            return 'vendor-codemirror';
          }
        },
      },
    },
  },
}));
