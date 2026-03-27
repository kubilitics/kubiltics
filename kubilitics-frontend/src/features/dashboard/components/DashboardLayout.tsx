/**
 * Dashboard — The main control surface.
 *
 * Layout hierarchy:
 *   1. Hero band       — Cluster Health + Cluster Capacity (tallest, most prominent)
 *   2. Resource shelf   — 3×3 metric tiles inside a subtle container panel
 *   2b. Pod distribution — Pod Status Distribution (moved below resources)
 *   3. Intelligence row — Resource Intelligence + Quick Actions (equal columns)
 *   4. Pod health       — Utilisation stacked bar
 *   5. Alerts           — Warning / critical event stream
 *
 * Each section is wrapped in a <section> with a consistent heading style.
 * Spacing uses an 8px rhythm (gap-6 = 24px between sections).
 */
import React from "react";
import { Boxes, Activity, HeartPulse, AlertTriangle } from "lucide-react";
import { ClusterHealthWidget } from "./ClusterHealthWidget";
import { PodHealthSummary } from "./PodHealthSummary";
import { AlertsStrip } from "./AlertsStrip";
import { RecentActivityPanel } from "./RecentActivityPanel";
import { PodStatusDistribution } from "./PodStatusDistribution";
import { ClusterCapacity } from "./ClusterCapacity";
import { ClusterResourceIntelligence } from "@/components/dashboard/ClusterEfficiencyCard";
import { MetricCardsGrid } from "./MetricCardsGrid";

/* ─── Shared section-header component ─────────────────────────────────────── */

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="h-7 w-7 rounded-lg bg-muted/80 dark:bg-muted/40 flex items-center justify-center">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <h2 className="text-sm font-semibold text-foreground/80 tracking-wide uppercase">
        {title}
      </h2>
    </div>
  );
}

export const DashboardLayout = () => {
  return (
    <div className="h-full w-full flex flex-col min-h-0 bg-background text-foreground animate-fade-in">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 pb-6 scroll-smooth w-full">
        <div className="w-full space-y-6">
          {/* Page Title for A11y & Semantics */}
          <h1 className="sr-only">Dashboard</h1>

          {/* ────────────────── Row 1: Hero band ────────────────── */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-4 flex flex-col">
              <ClusterHealthWidget />
            </div>
            <div className="lg:col-span-8 flex flex-col min-h-[28rem]">
              <ClusterCapacity />
            </div>
          </section>

          {/* ────────────────── Row 2: Resource shelf ────────────────── */}
          <section>
            <SectionHeader icon={Boxes} title="Resources" />
            <MetricCardsGrid />
          </section>

          {/* ────────────────── Row 2b: Pod Status Distribution ────────────────── */}
          <section>
            <PodStatusDistribution />
          </section>

          {/* ────────────────── Row 3: Intelligence + Quick Actions ────────────────── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            <div className="min-h-[24rem] flex flex-col">
              <ClusterResourceIntelligence />
            </div>
            <div className="min-h-[24rem] flex flex-col rounded-2xl border border-border/60 bg-card p-6 shadow">
              <SectionHeader icon={Activity} title="Recent Activity" />
              <RecentActivityPanel />
            </div>
          </section>

          {/* ────────────────── Row 4: Pod health & utilisation ────────────────── */}
          <section>
            <SectionHeader icon={HeartPulse} title="Pod Health & Utilization" />
            <PodHealthSummary />
          </section>

          {/* ────────────────── Row 5: Alerts & warnings ────────────────── */}
          <section>
            <AlertsStrip />
          </section>
        </div>
      </div>
    </div>
  );
};
