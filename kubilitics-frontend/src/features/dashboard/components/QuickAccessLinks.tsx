/**
 * TASK-092: Quick Access — last 5 visited resource pages from localStorage.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Clock, FileCode } from "lucide-react";
import { useRecentlyVisitedReadOnly } from "@/hooks/useRecentlyVisited";

export const QuickAccessLinks = () => {
  const items = useRecentlyVisitedReadOnly();

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <Clock className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No recent pages yet</p>
        <p className="text-xs text-muted-foreground/80 mt-1">
          Navigate to resources to see them here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        Quick Access
      </h3>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.path}>
            <Link
              to={item.path}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted/60 transition-colors group"
            >
              <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate group-hover:text-primary">
                {item.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};
