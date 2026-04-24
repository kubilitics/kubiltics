import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { cn } from '@/lib/utils';
import { LiveSignalStrip } from '@/components/dashboard/LiveSignalStrip';
import { DashboardHero } from '@/components/dashboard/DashboardHero';
import { IntelligencePanel } from '@/components/dashboard/IntelligencePanel';
import { ClusterOverviewPanel } from '@/features/dashboard/components/ClusterOverviewPanel';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { WorkloadCapacitySnapshot } from '@/components/dashboard/WorkloadCapacitySnapshot';
import { HealthScoreCard } from '@/components/dashboard/HealthScoreCard';
import { ClusterDetailsPanel } from '@/components/dashboard/ClusterDetailsPanel';
import { DashboardTour, useDashboardTour } from '@/components/onboarding/DashboardTour';
import { useClusterOverview } from '@/hooks/useClusterOverview';
import { RecentEventsCard } from '@/components/events/RecentEventsCard';
import { InsightsBanner } from '@/components/events/InsightsBanner';
import { useActiveInsights, useDismissInsight } from '@/hooks/useEventsIntelligence';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const activeCluster = useActiveCluster();
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const { showTour, completeTour, skipTour } = useDashboardTour();
  const { data: insights } = useActiveInsights();
  const dismissInsight = useDismissInsight();

  // Test cluster accessibility - redirect to connect if cluster is invalid
  const overviewQuery = useClusterOverview(currentClusterId || undefined);

  useEffect(() => {
    // If cluster overview fails with 404/503, redirect to connect page
    if (overviewQuery.error && overviewQuery.isError) {
      const error = overviewQuery.error as unknown as Record<string, unknown>;
      if ((error?.status) === 404 || (error?.status) === 503 || (error?.status) === 500) {
        console.warn(`[Dashboard] Cluster ${currentClusterId} is not accessible (${error.status}). Redirecting to connect page.`);
        navigate('/clusters', { replace: true });
      }
    }
  }, [overviewQuery.error, overviewQuery.isError, currentClusterId, navigate]);

  if (!activeCluster) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No cluster selected</h2>
        <p className="text-muted-foreground">Please connect to a cluster to view the dashboard.</p>
        <Button onClick={() => navigate('/clusters')} variant="default">
          Connect Cluster
        </Button>
      </div>
    );
  }

  // Key the entire dashboard on clusterId so switching clusters forces a full
  // remount. This guarantees every child query starts fresh for the new cluster,
  // loading states render correctly, and framer-motion animations replay.
  const dashboardKey = currentClusterId ?? activeCluster.id;

  return (
    <>
      {showTour && (
        <DashboardTour onComplete={completeTour} onSkip={skipTour} />
      )}
      <div key={dashboardKey} className="dashboard-page p-4 md:p-6 -m-2" data-tour="dashboard" role="main" aria-label="Dashboard">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="space-y-5 md:space-y-6"
        >
          {/* Zone 1: Page header with live indicator */}
          <motion.div variants={item} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 }}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--ring))] shadow-lg shadow-[hsl(var(--ring)/0.25)]"
              >
                <Zap className="h-5 w-5 text-white" aria-hidden />
              </motion.div>
              <div>
                <motion.h1
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                  className="font-h2 text-foreground tracking-tight"
                >
                  Gateway
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.35, delay: 0.3 }}
                  className="font-caption text-muted-foreground mt-0.5"
                >
                  Command center for <span className="font-medium text-foreground">{activeCluster.name}</span>
                </motion.p>
              </div>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[hsl(var(--success)/0.08)] border border-[hsl(var(--success)/0.2)]"
              role="status"
              aria-label="Live data"
              aria-live="polite"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--success))] opacity-50" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[hsl(var(--success))]" />
              </span>
              <span className="text-xs font-medium text-[hsl(var(--success))]">Live</span>
            </div>
          </motion.div>

          {/* Zone 2: Health Pulse Strip */}
          <motion.div variants={item}>
            <LiveSignalStrip />
          </motion.div>

          {/* Zone 3: Hero health gauge + AI insight */}
          <motion.div variants={item}>
            <DashboardHero />
          </motion.div>

          {/* Insights Banner */}
          {insights && insights.length > 0 && (
            <motion.div variants={item}>
              <InsightsBanner
                insights={insights}
                onDismiss={(id) => dismissInsight.mutate(id)}
                isDismissing={dismissInsight.isPending}
              />
            </motion.div>
          )}

          {/* Zone 4: Three-column command surface */}
          <motion.div
            variants={item}
            className={cn(
              'grid gap-4 md:gap-5',
              'grid-cols-1 lg:grid-cols-[minmax(0,30%)_1fr_minmax(0,25%)]',
              'min-h-0'
            )}
            style={{ minHeight: 'min(460px, 52vh)' }}
          >
            {/* Left: AI Insights Panel (~30%) */}
            <section
              className="min-h-[300px] lg:min-h-[420px] flex flex-col order-2 lg:order-1"
              aria-label="AI Insights"
            >
              <IntelligencePanel />
            </section>

            {/* Center: Cluster overview — operational insights, health, capacity */}
            <section
              className="min-h-[340px] flex flex-col order-1 lg:order-2"
              aria-label="Cluster overview"
            >
              <ClusterOverviewPanel />
            </section>

            {/* Right: Activity Feed & Quick Actions (~25%) */}
            <section
              className="min-h-[300px] flex flex-col order-3"
              aria-label="Activity feed and quick actions"
            >
              <ActivityFeed />
            </section>
          </motion.div>

          {/* Zone 5: Workload + Health detail row */}
          <motion.div
            variants={item}
            className="grid gap-4 md:gap-5 grid-cols-1 lg:grid-cols-2"
          >
            <WorkloadCapacitySnapshot />
            <HealthScoreCard />
          </motion.div>

          {/* Zone 5b: Recent Events */}
          <motion.div variants={item}>
            <RecentEventsCard />
          </motion.div>

          {/* Zone 6: Cluster details strip */}
          <motion.div variants={item}>
            <ClusterDetailsPanel />
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
