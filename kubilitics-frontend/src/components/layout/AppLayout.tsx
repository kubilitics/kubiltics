import { useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useReducedMotion } from 'framer-motion';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ConnectionRequiredBanner } from './ConnectionRequiredBanner';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { useClusterStore } from '@/stores/clusterStore';
// AIAssistant is rendered globally in App.tsx
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useRecentlyVisited } from '@/hooks/useRecentlyVisited';
import { useOfflineMode } from '@/hooks/useOfflineMode';
import { analyticsService } from '@/services/analyticsService';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';
import { RouteErrorBoundary } from '@/components/GlobalErrorBoundary';

export function AppLayout() {
  useRecentlyVisited();
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const isDemo = useClusterStore((s) => s.isDemo);
  const { isConnected } = useConnectionStatus();
  const { isOffline, aiBackendReachable } = useOfflineMode();
  const gPendingRef = useRef(false);
  const gTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track app start
  useEffect(() => {
    if (isTauri()) {
      analyticsService.trackAppStart();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (inInput) return;

      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        gPendingRef.current = true;
        if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
        gTimeoutRef.current = setTimeout(() => {
          gPendingRef.current = false;
          gTimeoutRef.current = null;
        }, 800);
        return;
      }
      if (e.key === 'p' && gPendingRef.current) {
        e.preventDefault();
        gPendingRef.current = false;
        navigate('/pods');
        return;
      }
      if (e.key === 'n' && gPendingRef.current) {
        e.preventDefault();
        gPendingRef.current = false;
        navigate('/nodes');
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('openGlobalSearch'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
    };
  }, [navigate]);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <a
        href="#main-content"
        className="absolute left-0 top-0 -translate-x-full focus:translate-x-0 focus:z-[100] px-4 py-2 bg-primary text-primary-foreground rounded-br focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-transform duration-200"
      >
        Skip to main content
      </a>
      <Header />
      {isDemo && (
        <div
          className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 text-sm font-medium"
          role="status"
          aria-live="polite"
        >
          <span>Demo Mode — showing sample data.</span>
          <Link
            to="/connect"
            className="underline font-semibold hover:no-underline focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
          >
            Connect a real cluster
          </Link>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar />
        <main id="main-content" className="flex-1 p-6 pb-28 pr-3 overflow-auto flex flex-col gap-4" role="main" aria-label="Main content">
          <OfflineIndicator />
          <ConnectionRequiredBanner />
          <div
            className={cn(
              'flex flex-col gap-4 min-h-0 flex-1 transition-opacity duration-200',
              !isConnected && 'opacity-50 pointer-events-none select-none relative'
            )}
            aria-hidden={!isConnected}
          >
            {!isConnected && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-auto">
                <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg p-6 shadow-lg text-center max-w-md">
                  <p className="text-sm font-medium text-foreground mb-2">Not connected to cluster</p>
                  <p className="text-xs text-muted-foreground mb-4">Please connect to a cluster to view content.</p>
                  <Link
                    to="/connect"
                    className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Connect Cluster
                  </Link>
                </div>
              </div>
            )}
            <motion.div
              key={location.pathname}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
              className="flex flex-col gap-4 min-h-0 flex-1"
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
      </div>
    </div>
  );
}
