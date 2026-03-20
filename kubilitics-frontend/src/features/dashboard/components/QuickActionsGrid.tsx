/**
 * Quick Actions — Workloads, Events, Topology, Nodes, Deployments
 */
import React from "react";
import { Link } from "react-router-dom";
import { Layers, Activity, Network, Server, Box } from "lucide-react";
import { cn } from "@/lib/utils";

const TILES = [
  {
    key: "workloads",
    label: "Workloads",
    href: "/workloads",
    icon: Layers,
    description: "Pods, Deployments, StatefulSets",
    gradient: "from-violet-500/10 to-indigo-500/5",
    border: "border-violet-500/20 hover:border-violet-500/40",
    iconBg: "bg-violet-500/15",
    iconColor: "text-violet-600",
  },
  {
    key: "events",
    label: "Events",
    href: "/events",
    icon: Activity,
    description: "Cluster events and warnings",
    gradient: "from-amber-500/10 to-orange-500/5",
    border: "border-amber-500/20 hover:border-amber-500/40",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-600",
  },
  {
    key: "topology",
    label: "Topology",
    href: "/topology",
    icon: Network,
    description: "Resource relationships",
    gradient: "from-cyan-500/10 to-blue-500/5",
    border: "border-cyan-500/20 hover:border-cyan-500/40",
    iconBg: "bg-cyan-500/15",
    iconColor: "text-cyan-600",
  },
  {
    key: "nodes",
    label: "Nodes",
    href: "/nodes",
    icon: Server,
    description: "Cluster nodes and capacity",
    gradient: "from-blue-500/10 to-sky-500/5",
    border: "border-blue-500/20 hover:border-blue-500/40",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-600",
  },
  {
    key: "deployments",
    label: "Deployments",
    href: "/deployments",
    icon: Box,
    description: "Deployments and rollouts",
    gradient: "from-emerald-500/10 to-teal-500/5",
    border: "border-emerald-500/20 hover:border-emerald-500/40",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-600",
  },
];

export const QuickActionsGrid = () => {
  return (
    <div className="grid grid-cols-1 gap-3">
      {TILES.map(({ key, label, href, icon: Icon, description, gradient, border, iconBg, iconColor }) => (
        <Link
          key={key}
          to={href}
          className={cn(
            "flex items-center gap-4 p-5 rounded-xl border transition-all min-h-[88px]",
            "bg-gradient-to-br",
            gradient,
            border
          )}
        >
          <div className={cn("flex items-center justify-center w-12 h-12 rounded-lg shrink-0", iconBg, iconColor)}>
            <Icon className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-foreground">{label}</div>
            <div className="text-sm text-muted-foreground truncate">{description}</div>
          </div>
        </Link>
      ))}
    </div>
  );
};
