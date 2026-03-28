/**
 * MetricCardsGrid — Insightful resource tiles for the dashboard.
 *
 * Each tile shows:
 *   1. Official K8s icon in a gradient well + resource label + count
 *   2. Segmented health bar showing proportional status
 *   3. Status dot legend with breakdown counts
 *
 * Grouped into Infrastructure / Networking / Configuration categories.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import k8sIconMap from "@/topology/icons/k8sIconMap";
import { useResourceCounts } from "@/hooks/useResourceCounts";
import { useDashboardResourceHealth, type HealthSegment } from "@/hooks/useDashboardResourceHealth";
import { useProjectStore } from "@/stores/projectStore";
import { cn } from "@/lib/utils";

/* ─── Constants ───────────────────────────────────────────────────────────── */

const CLUSTER_WIDE = new Set(["Nodes"]);

interface TileDef {
  title: string;
  kind: string;       // k8sIconMap key
  countKey: string;    // key in ResourceCounts
  healthKey: string;   // key in health record
  href: string;
  gradient: string;    // icon well gradient
  shadowTint: string;  // subtle shadow color for the well
}

interface CategoryDef {
  label: string;
  tiles: TileDef[];
}

const CATEGORIES: CategoryDef[] = [
  {
    label: "Infrastructure",
    tiles: [
      { title: "Nodes", kind: "node", countKey: "nodes", healthKey: "nodes", href: "/nodes", gradient: "from-blue-100 to-blue-200 dark:from-blue-500/20 dark:to-blue-600/15", shadowTint: "shadow-blue-200/40 dark:shadow-blue-500/10" },
      { title: "Pods", kind: "pod", countKey: "pods", healthKey: "pods", href: "/pods", gradient: "from-indigo-100 to-indigo-200 dark:from-indigo-500/20 dark:to-indigo-600/15", shadowTint: "shadow-indigo-200/40 dark:shadow-indigo-500/10" },
      { title: "Deployments", kind: "deployment", countKey: "deployments", healthKey: "deployments", href: "/deployments", gradient: "from-violet-100 to-violet-200 dark:from-violet-500/20 dark:to-violet-600/15", shadowTint: "shadow-violet-200/40 dark:shadow-violet-500/10" },
    ],
  },
  {
    label: "Networking",
    tiles: [
      { title: "Services", kind: "service", countKey: "services", healthKey: "services", href: "/services", gradient: "from-cyan-100 to-cyan-200 dark:from-cyan-500/20 dark:to-cyan-600/15", shadowTint: "shadow-cyan-200/40 dark:shadow-cyan-500/10" },
      { title: "DaemonSets", kind: "daemonset", countKey: "daemonsets", healthKey: "daemonsets", href: "/daemonsets", gradient: "from-teal-100 to-teal-200 dark:from-teal-500/20 dark:to-teal-600/15", shadowTint: "shadow-teal-200/40 dark:shadow-teal-500/10" },
      { title: "Namespaces", kind: "namespace", countKey: "namespaces", healthKey: "namespaces", href: "/namespaces", gradient: "from-sky-100 to-sky-200 dark:from-sky-500/20 dark:to-sky-600/15", shadowTint: "shadow-sky-200/40 dark:shadow-sky-500/10" },
    ],
  },
  {
    label: "Configuration",
    tiles: [
      { title: "ConfigMaps", kind: "configmap", countKey: "configmaps", healthKey: "configmaps", href: "/configmaps", gradient: "from-amber-100 to-amber-200 dark:from-amber-500/20 dark:to-amber-600/15", shadowTint: "shadow-amber-200/40 dark:shadow-amber-500/10" },
      { title: "Secrets", kind: "secret", countKey: "secrets", healthKey: "secrets", href: "/secrets", gradient: "from-rose-100 to-rose-200 dark:from-rose-500/20 dark:to-rose-600/15", shadowTint: "shadow-rose-200/40 dark:shadow-rose-500/10" },
      { title: "CronJobs", kind: "cronjob", countKey: "cronjobs", healthKey: "cronjobs", href: "/cronjobs", gradient: "from-orange-100 to-orange-200 dark:from-orange-500/20 dark:to-orange-600/15", shadowTint: "shadow-orange-200/40 dark:shadow-orange-500/10" },
    ],
  },
];

/* ─── K8s Icon ────────────────────────────────────────────────────────────── */

function K8sIcon({ kind, className }: { kind: string; className?: string }) {
  const url = k8sIconMap[kind];
  if (!url) return null;
  return <img src={url} alt="" aria-hidden="true" draggable={false} className={className} />;
}

/* ─── Health Bar ──────────────────────────────────────────────────────────── */

function HealthBar({ segments, total }: { segments: HealthSegment[]; total: number }) {
  if (!segments.length || total === 0) {
    return (
      <div className="h-[3px] rounded-full bg-slate-200/60 dark:bg-white/[0.06]" />
    );
  }

  return (
    <div className="h-[3px] rounded-full bg-slate-200/60 dark:bg-white/[0.06] overflow-hidden flex">
      {segments.map((s, i) => (
        <div
          key={s.label}
          className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-500"
          style={{
            width: `${(s.count / total) * 100}%`,
            backgroundColor: s.barColor,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Status Legend ───────────────────────────────────────────────────────── */

function StatusLegend({ segments }: { segments: HealthSegment[] }) {
  if (!segments.length) {
    return (
      <span className="text-[10.5px] text-muted-foreground/50">No data</span>
    );
  }

  return (
    <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap">
      {segments.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground whitespace-nowrap">
          <span className={cn("h-[5px] w-[5px] rounded-full shrink-0", s.color)} />
          {s.count} {s.label}
        </span>
      ))}
    </div>
  );
}

/* ─── Main Component ──────────────────────────────────────────────────────── */

export const MetricCardsGrid = () => {
  const { counts } = useResourceCounts();
  const { health } = useDashboardResourceHealth();
  const activeProject = useProjectStore((s) => s.activeProject);
  const isProjectScope = !!activeProject;

  let globalIndex = 0;

  return (
    <div className="space-y-5">
      {CATEGORIES.map((cat) => (
        <div key={cat.label}>
          {/* Category label */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60 mb-2.5 pl-1">
            {cat.label}
          </p>

          {/* Tiles row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cat.tiles.map((tile) => {
              const idx = globalIndex++;
              const countFromHook = (counts as any)[tile.countKey] ?? 0;
              const rh = health[tile.healthKey];
              const segments = rh?.segments ?? [];
              // Prefer health total (fetches with limit:500) over count hook (limit:100, may undercount)
              const count = rh?.total ?? countFromHook;
              const total = rh?.total ?? count;
              const scopeTag = isProjectScope
                ? CLUSTER_WIDE.has(tile.title) ? "Cluster" : "Project"
                : null;

              return (
                <Link
                  key={tile.title}
                  to={tile.href}
                  className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 rounded-2xl"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div
                    className={cn(
                      /* Surface */
                      "relative rounded-2xl overflow-hidden",
                      "bg-white dark:bg-[hsl(225,15%,12%)]",
                      "border border-slate-200/80 dark:border-white/[0.06]",
                      /* Layered shadow */
                      "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]",
                      "dark:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_4px_12px_rgba(0,0,0,0.15)]",
                      /* Layout */
                      "p-4 flex flex-col gap-3",
                      /* Hover — spring lift */
                      "transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]",
                      "hover:-translate-y-[2px]",
                      "hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.06)]",
                      "dark:hover:shadow-[0_2px_4px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.2)]",
                      "hover:border-slate-300/80 dark:hover:border-white/[0.1]",
                      "active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
                    )}
                  >
                    {/* Row 1: Icon + Label/Count + Chevron */}
                    <div className="flex items-center gap-3">
                      {/* Icon well */}
                      <div
                        className={cn(
                          "h-11 w-11 rounded-[13px] flex items-center justify-center shrink-0",
                          "bg-gradient-to-br", tile.gradient,
                          "shadow-sm", tile.shadowTint,
                          "transition-transform duration-500 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
                          "group-hover:scale-110",
                        )}
                      >
                        <K8sIcon kind={tile.kind} className="h-6 w-6" />
                      </div>

                      {/* Text: label on top, count below */}
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-semibold text-muted-foreground leading-tight truncate">
                            {tile.title}
                          </span>
                          {scopeTag && (
                            <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                              {scopeTag}
                            </span>
                          )}
                        </div>
                        <span className="text-[24px] font-extrabold tracking-tight text-foreground tabular-nums leading-none mt-0.5">
                          {count}
                        </span>
                      </div>

                      {/* Chevron */}
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground/25 group-hover:text-muted-foreground/50 transition-all duration-300 group-hover:translate-x-0.5"
                        strokeWidth={2.5}
                      />
                    </div>

                    {/* Row 2: Health bar */}
                    <HealthBar segments={segments} total={total} />

                    {/* Row 3: Status legend */}
                    <StatusLegend segments={segments} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
