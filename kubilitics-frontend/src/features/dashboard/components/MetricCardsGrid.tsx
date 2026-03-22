/**
 * MetricCardsGrid — 3 × 3 resource count tiles.
 *
 * Each card has:
 *   • A solid visible border + default shadow for card definition
 *   • A thin 2px left accent stripe for colour identity (grouped palette)
 *   • A tinted icon container matching the accent
 *   • Bold count as the hero element
 *
 * Colour palette grouped by function:
 *   Infrastructure (Nodes, Pods, Deployments)  → blue family
 *   Networking     (Services, DS, Namespaces)  → teal/cyan family
 *   Configuration  (ConfigMaps, Secrets, CJ)   → warm amber/rose family
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  Server,
  Activity,
  Layers,
  Globe,
  Shield,
  FolderKanban,
  FileText,
  KeyRound,
  Timer,
  ArrowUpRight,
} from "lucide-react";
import { useResourceCounts } from "@/hooks/useResourceCounts";
import { useProjectStore } from "@/stores/projectStore";
import { cn } from "@/lib/utils";

const CLUSTER_WIDE = new Set(["Nodes"]);

interface CardConfig {
  title: string;
  value: number;
  href: string;
  icon: typeof Server;
  /** Left accent stripe */
  accent: string;
  /** Tinted icon background */
  iconBg: string;
  /** Icon stroke */
  iconColor: string;
  /** Hover border tint */
  hoverBorder: string;
}

export const MetricCardsGrid = () => {
  const { counts } = useResourceCounts();
  const activeProject = useProjectStore((s) => s.activeProject);
  const isProjectScope = !!activeProject;

  const cards: CardConfig[] = [
    // ── Infrastructure ──────────────────────────────
    {
      title: "Nodes",
      value: counts.nodes,
      href: "/nodes",
      icon: Server,
      accent: "bg-blue-400",
      iconBg: "bg-blue-50 dark:bg-blue-500/10",
      iconColor: "text-blue-500 dark:text-blue-400",
      hoverBorder: "hover:border-blue-200 dark:hover:border-blue-900",
    },
    {
      title: "Pods",
      value: counts.pods,
      href: "/pods",
      icon: Activity,
      accent: "bg-indigo-400",
      iconBg: "bg-indigo-50 dark:bg-indigo-500/10",
      iconColor: "text-indigo-500 dark:text-indigo-400",
      hoverBorder: "hover:border-indigo-200 dark:hover:border-indigo-900",
    },
    {
      title: "Deployments",
      value: counts.deployments,
      href: "/deployments",
      icon: Layers,
      accent: "bg-violet-400",
      iconBg: "bg-violet-50 dark:bg-violet-500/10",
      iconColor: "text-violet-500 dark:text-violet-400",
      hoverBorder: "hover:border-violet-200 dark:hover:border-violet-900",
    },
    // ── Networking & Organisation ────────────────────
    {
      title: "Services",
      value: counts.services,
      href: "/services",
      icon: Globe,
      accent: "bg-cyan-400",
      iconBg: "bg-cyan-50 dark:bg-cyan-500/10",
      iconColor: "text-cyan-600 dark:text-cyan-400",
      hoverBorder: "hover:border-cyan-200 dark:hover:border-cyan-900",
    },
    {
      title: "DaemonSets",
      value: counts.daemonsets,
      href: "/daemonsets",
      icon: Shield,
      accent: "bg-teal-400",
      iconBg: "bg-teal-50 dark:bg-teal-500/10",
      iconColor: "text-teal-600 dark:text-teal-400",
      hoverBorder: "hover:border-teal-200 dark:hover:border-teal-900",
    },
    {
      title: "Namespaces",
      value: counts.namespaces,
      href: "/namespaces",
      icon: FolderKanban,
      accent: "bg-sky-400",
      iconBg: "bg-sky-50 dark:bg-sky-500/10",
      iconColor: "text-sky-600 dark:text-sky-400",
      hoverBorder: "hover:border-sky-200 dark:hover:border-sky-900",
    },
    // ── Configuration & Security ────────────────────
    {
      title: "ConfigMaps",
      value: counts.configmaps,
      href: "/configmaps",
      icon: FileText,
      accent: "bg-amber-400",
      iconBg: "bg-amber-50 dark:bg-amber-500/10",
      iconColor: "text-amber-600 dark:text-amber-400",
      hoverBorder: "hover:border-amber-200 dark:hover:border-amber-900",
    },
    {
      title: "Secrets",
      value: counts.secrets,
      href: "/secrets",
      icon: KeyRound,
      accent: "bg-rose-400",
      iconBg: "bg-rose-50 dark:bg-rose-500/10",
      iconColor: "text-rose-500 dark:text-rose-400",
      hoverBorder: "hover:border-rose-200 dark:hover:border-rose-900",
    },
    {
      title: "CronJobs",
      value: counts.cronjobs,
      href: "/cronjobs",
      icon: Timer,
      accent: "bg-orange-400",
      iconBg: "bg-orange-50 dark:bg-orange-500/10",
      iconColor: "text-orange-600 dark:text-orange-400",
      hoverBorder: "hover:border-orange-200 dark:hover:border-orange-900",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
      {cards.map((c, i) => {
        const scopeTag = isProjectScope
          ? CLUSTER_WIDE.has(c.title) ? "Cluster" : "Project"
          : null;

        return (
          <Link
            key={c.title}
            to={c.href}
            className="group block focus-visible:outline-none focus-glow"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div
              className={cn(
                /* Card — visible border + resting shadow */
                "relative bg-white dark:bg-[hsl(228,14%,11%)]",
                "border border-slate-200 dark:border-slate-700",
                "rounded-2xl overflow-hidden",
                "shadow",
                /* Layout — taller cards with more padding */
                "flex items-center gap-5",
                "py-6 pl-0 pr-6",
                /* Hover */
                "transition-all duration-300",
                c.hoverBorder,
                "hover:shadow-[var(--shadow-3)] hover:-translate-y-[2px]",
                "active:translate-y-0 active:shadow",
              )}
              style={{ transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
            >
              {/* ── Left accent stripe ── */}
              <div className={cn("w-[4px] self-stretch rounded-r-full shrink-0", c.accent)} />

              {/* ── Icon — larger ── */}
              <div
                className={cn(
                  "h-14 w-14 rounded-xl flex items-center justify-center shrink-0",
                  "transition-transform duration-500",
                  "group-hover:scale-110",
                  c.iconBg,
                )}
                style={{ transitionTimingFunction: "cubic-bezier(0.175,0.885,0.32,1.275)" }}
              >
                <c.icon className={cn("h-6 w-6", c.iconColor)} strokeWidth={1.75} />
              </div>

              {/* ── Content — larger numbers ── */}
              <div className="flex flex-col min-w-0">
                <span className="text-3xl font-extrabold tracking-tight text-foreground tabular-nums leading-none">
                  {c.value}
                </span>
                <span className="text-sm font-medium text-muted-foreground mt-1.5 leading-tight truncate">
                  {c.title}
                </span>
                {scopeTag && (
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">
                    {scopeTag}
                  </span>
                )}
              </div>

              {/* ── Navigate chevron ── */}
              <ArrowUpRight
                className="ml-auto h-4.5 w-4.5 shrink-0 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                strokeWidth={2}
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
};
