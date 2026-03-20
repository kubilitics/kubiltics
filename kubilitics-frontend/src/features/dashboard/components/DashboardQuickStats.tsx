/**
 * TASK-092: Quick Stats — namespace count, service count, storage usage (PVC count).
 */
import React from "react";
import { Link } from "react-router-dom";
import { FolderKanban, Globe, HardDrive } from "lucide-react";
import { useResourceCounts } from "@/hooks/useResourceCounts";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";

const STATS = [
  {
    label: "Namespaces",
    href: "/namespaces",
    icon: FolderKanban,
    getValue: (c: ReturnType<typeof useResourceCounts>["counts"]) => c.namespaces ?? 0,
  },
  {
    label: "Services",
    href: "/services",
    icon: Globe,
    getValue: (c) => c.services ?? 0,
  },
  {
    label: "PVCs",
    href: "/persistentvolumeclaims",
    icon: HardDrive,
    getValue: (c) => c.persistentvolumeclaims ?? 0,
  },
];

export const DashboardQuickStats = () => {
  const { isConnected } = useConnectionStatus();
  const { counts } = useResourceCounts();

  return (
    <div className="flex flex-wrap gap-4 items-center">
      {STATS.map((s) => (
        <Link
          key={s.label}
          to={s.href}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted/50 transition-colors text-sm"
        >
          <s.icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{s.label}:</span>
          <span className="font-semibold tabular-nums">
            {isConnected ? s.getValue(counts) : "—"}
          </span>
        </Link>
      ))}
    </div>
  );
};
