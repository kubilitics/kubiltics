import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const isTauriBuild = process.env.TAURI_BUILD === 'true';

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
  // Use relative paths for Tauri desktop builds (absolute paths don't work with tauri:// protocol)
  base: isTauriBuild ? './' : '/',
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
        configure: (proxy: { on: (ev: string, fn: () => void) => void }) => {
          proxy.on("error", () => {
            // Suppress proxy error logging (e.g. ECONNREFUSED when backend is down).
            // Frontend backs off polling when backend is unreachable; start backend with: make restart
          });
        },
      });
      return {
        "/api": proxyOptions("/api"),
        "/health": proxyOptions("/health"),
      };
    })(),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Only strip crossorigin in Tauri desktop builds
    isTauriBuild && removeCrossOriginPlugin(),
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
      // Only mock Tauri APIs when running in browser (not in real Tauri desktop builds).
      // TAURI_BUILD=true means we're building for the actual desktop app — use real @tauri-apps/api.
      ...(isTauriBuild ? {} : {
        "@tauri-apps/api/core": path.resolve(__dirname, "./src/mocks/tauri-core.ts"),
      }),
    },
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: mode !== "production",
    rollupOptions: {
      output: {
        // For Tauri builds: disable chunk splitting entirely to avoid circular ES module
        // import issues in WKWebView that cause React.forwardRef to be undefined.
        // For browser builds: split into vendor chunks for better caching.
        ...(isTauriBuild ? {} : {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('lucide-react')) return 'vendor-icons';
              if (id.includes('framer-motion')) return 'vendor-animation';
              if (id.includes('@radix-ui')) return 'vendor-ui';
              if (id.includes('cytoscape') || id.includes('elkjs')) return 'vendor-graph';
              return 'vendor';
            }
          },
        }),
      },
    },
  },
}));
