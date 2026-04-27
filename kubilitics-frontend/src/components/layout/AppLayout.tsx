import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useScrollRestoration } from './KeepAlive';
import { motion } from 'framer-motion';
import { useReducedMotion } from 'framer-motion';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { ConnectionLostBanner } from '@/components/ConnectionLostBanner';
import { useDemoStore } from '@/stores/demoStore';
import { useRecentlyVisited } from '@/hooks/useRecentlyVisited';
import { analyticsService } from '@/services/analyticsService';
import { isTauri } from '@/lib/tauri';
import { RouteErrorBoundary } from '@/components/GlobalErrorBoundary';
import { useSidebarAutoCollapse, useUIStore } from '@/stores/uiStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { RouteAnnouncer } from '@/components/a11y/RouteAnnouncer';
import { usePrefetchResources } from '@/hooks/usePrefetchResources';
import { useMemoryMonitor } from '@/hooks/useMemoryMonitor';
import { ProductionBanner } from './ProductionBanner';
import { KeyboardShortcutsOverlay } from '@/components/KeyboardShortcutsOverlay';
import { useKeyboardShortcuts, type KeyboardShortcut } from '@/hooks/useKeyboardShortcuts';
import { UpdateBanner } from '@/components/UpdateBanner';
import { useClusterWatcher } from '@/hooks/useClusterWatcher';
import { useInsightNotifications } from '@/hooks/useInsightNotifications';
import { ChatPanel } from '@/components/ai/ChatPanel';
import { useChatHotkey } from '@/hooks/useChatHotkey';
import { useChatStore } from '@/stores/chatStore';

export function AppLayout() {
  useRecentlyVisited();
  useDocumentTitle(); // Auto-set page title from route
  // Poll cluster resources every 30s and create notifications on state changes
  // useClusterWatcher(); // Temporarily disabled — investigating hooks crash
  // PERF: Prefetch critical K8s resources on cluster connect so every page loads instantly from cache
  usePrefetchResources();
  // Pipe Events Intelligence insights into the in-app notification center
  useInsightNotifications();
  // PERF Area 7: Monitor memory and trim stale caches during long sessions
  useMemoryMonitor();
  // P0-005-T02: Auto-collapse sidebar at < 1280px, re-expand when viewport grows
  useSidebarAutoCollapse();
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const isDemo = useDemoStore((s) => s.isDemo);
  // PERF Area 2: Restore scroll position when navigating back to a previously visited page
  const mainRef = useRef<HTMLElement>(null);
  useScrollRestoration(mainRef);
  const isShellOpen = useUIStore((s) => s.isShellOpen);
  const shellHeightPx = useUIStore((s) => s.shellHeightPx);

  // -- Chat panel: Cmd+I / Ctrl+I toggles right-side AI assistant --
  const toggleChatPanel = useChatStore((s) => s.togglePanel);
  // chatPanelOpen / width are no longer needed here — the chat panel
  // overlays the main content (position: fixed) and the AppLayout
  // doesn't reserve horizontal space for it. See ChatPanel.tsx.
  useChatHotkey(() => toggleChatPanel());

  // -- Global keyboard shortcuts overlay --
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);
  const openShortcutsOverlay = useCallback(() => setShortcutsOverlayOpen(true), []);
  const closeShortcutsOverlay = useCallback(() => setShortcutsOverlayOpen(false), []);

  // Register global shortcuts via the central registry (supports two-key sequences like "g d").
  // This replaces the old manual keydown handler for g+p, g+n, / — they now go through
  // useKeyboardShortcuts which already handles sequence detection and input filtering.
  const globalShortcuts = useMemo<KeyboardShortcut[]>(() => [
    { id: 'global-help', keys: '?', description: 'Show keyboard shortcuts', handler: openShortcutsOverlay, group: 'General' },
    { id: 'go-dashboard', keys: 'g d', description: 'Go to Dashboard', handler: () => navigate('/dashboard'), group: 'Navigation' },
    { id: 'go-topology', keys: 'g t', description: 'Go to Topology', handler: () => navigate('/topology'), group: 'Navigation' },
    { id: 'go-pods', keys: 'g p', description: 'Go to Pods', handler: () => navigate('/pods'), group: 'Navigation' },
    { id: 'go-nodes', keys: 'g n', description: 'Go to Nodes', handler: () => navigate('/nodes'), group: 'Navigation' },
    { id: 'go-settings', keys: 'g s', description: 'Go to Settings', handler: () => navigate('/settings'), group: 'Navigation' },
    { id: 'focus-search', keys: '/', description: 'Focus search', handler: () => window.dispatchEvent(new CustomEvent('openGlobalSearch')), group: 'Navigation' },
  ], [navigate, openShortcutsOverlay]);
  useKeyboardShortcuts(globalShortcuts);

  // Track app start
  useEffect(() => {
    if (isTauri()) {
      analyticsService.trackAppStart();
    }
  }, []);

  // Listen for the sidebar "Keyboard Shortcuts" button click
  useEffect(() => {
    const handler = () => setShortcutsOverlayOpen(true);
    window.addEventListener('openKeyboardShortcuts', handler);
    return () => window.removeEventListener('openKeyboardShortcuts', handler);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <a
        href="#main-content"
        className="absolute left-0 top-0 -translate-x-full focus:translate-x-0 focus:z-[100] px-4 py-2 bg-primary text-primary-foreground rounded-br focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-transform duration-200"
      >
        Skip to main content
      </a>
      <RouteAnnouncer />
      <UpdateBanner />
      <ProductionBanner />
      <Header />
      {isDemo && (
        <div
          className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 text-sm font-medium"
          role="status"
          aria-live="polite"
        >
          <span>Demo Mode — showing sample data.</span>
          <Link
            to="/clusters"
            className="underline font-semibold hover:no-underline focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
          >
            Connect a real cluster
          </Link>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main
          ref={mainRef}
          id="main-content"
          className={cn(
            "flex-1 p-4 sm:p-6 sm:pr-3 overflow-auto flex flex-col gap-4 relative ease-out",
          )}
          style={{
            paddingBottom: isShellOpen ? `${shellHeightPx + 24}px` : '24px',
            // Main content stays full-width AT ALL TIMES. The chat
            // panel overlays from the right (with backdrop) instead of
            // squeezing the main work area — same pattern as Cursor /
            // Claude / ChatGPT desktop. Trade-off accepted: the right
            // edge of dashboards may be partially covered while the
            // panel is open, but the cost of ALWAYS losing 380-560px
            // of horizontal real estate to the chat is worse for SREs
            // scanning wide tables and topology graphs.
          }}
          role="main"
          aria-label="Main content"
        >
          <OfflineIndicator />
          <ConnectionLostBanner />
          <div
            className="flex flex-col gap-4 min-h-0 flex-1"
          >
            <motion.div
              key={location.pathname}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
              className="flex flex-col gap-4 min-h-0 flex-1 relative"
            >
              <RouteErrorBoundary
                routeName={location.pathname.split('/').pop()?.replace(/-/g, ' ')}
                onGoBack={() => navigate(-1)}
              >
                <Outlet />
              </RouteErrorBoundary>
            </motion.div>
          </div>
        </main>
        {/* Right-side AI Assistant chat panel (renders null when closed) */}
        <ChatPanel />
      </div>

      {/* Global keyboard shortcuts overlay — triggered by pressing ? */}
      <KeyboardShortcutsOverlay visible={shortcutsOverlayOpen} onClose={closeShortcutsOverlay} />
    </div>
  );
}
