/**
 * Dashboard — Hero (Health + Pod Status), Resources, Efficiency + Quick actions, Pod health, Alerts at bottom.
 */
import React from "react";
import { ClusterHealthWidget } from "./ClusterHealthWidget";
import { PodHealthSummary } from "./PodHealthSummary";
import { AlertsStrip } from "./AlertsStrip";
import { QuickActionsGrid } from "./QuickActionsGrid";
import { PodStatusDistribution } from "./PodStatusDistribution";
import { ClusterEfficiencyCard } from "@/components/dashboard/ClusterEfficiencyCard";
import { MetricCardsGrid } from "./MetricCardsGrid";

export const DashboardLayout = () => {
  return (
    <div className="h-full w-full flex flex-col min-h-0 bg-background text-foreground animate-fade-in">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 pb-28 scroll-smooth w-full">
        <div className="w-full space-y-6">
          {/* Page Title for A11y & Semantics */}
          <h1 className="sr-only">Dashboard</h1>

          {/* Row 1: Hero — Cluster Health | Pod Status Distribution */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-4 flex flex-col">
              <ClusterHealthWidget />
            </div>
            <div className="lg:col-span-8 flex flex-col min-h-[28rem]">
              <PodStatusDistribution />
            </div>
          </section>

          {/* Row 2: Resource count cards */}
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">Resources</h2>
            <MetricCardsGrid />
          </section>

          {/* Row 3: Cluster efficiency | Quick actions — 2 columns */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            <div className="min-h-[24rem] flex flex-col">
              <ClusterEfficiencyCard />
            </div>
            <div className="min-h-[24rem] flex flex-col rounded-xl border border-border/60 bg-card p-6">
              <h2 className="text-sm font-medium text-muted-foreground mb-4 shrink-0">Quick actions</h2>
              <QuickActionsGrid />
            </div>
          </section>

          {/* Row 4: Pod health & utilization */}
          <section>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Pod health & utilization</h2>
            <PodHealthSummary />
          </section>

          {/* Row 5: Alerts & warnings — bottom */}
          <section>
            <AlertsStrip />
          </section>
        </div>
      </div>
    </div>
  );
};
