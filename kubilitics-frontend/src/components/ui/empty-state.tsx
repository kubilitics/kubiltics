import * as React from "react";
import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import {
  ServerOff,
  Boxes,
  BarChart3,
  CalendarClock,
  Puzzle,
  WifiOff,
  SearchX,
  BrainCircuit,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* ── Types ── */

export interface EmptyStateAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export type EmptyStateSize = "sm" | "md" | "lg";

export interface EmptyStateProps {
  /** Lucide icon to display above the title */
  icon?: LucideIcon;
  /** Optional custom illustration (replaces the icon) */
  illustration?: React.ReactNode;
  /** Main heading */
  title: string;
  /** Secondary explanation text */
  description?: string;
  /** Primary call-to-action */
  primaryAction?: EmptyStateAction;
  /** Optional secondary action */
  secondaryAction?: EmptyStateAction;
  /** Controls spacing and icon sizing */
  size?: EmptyStateSize;
  /** Additional CSS classes */
  className?: string;
}

/* ── Size configuration ── */

const SIZE_CONFIG: Record<
  EmptyStateSize,
  { icon: string; wrapper: string; title: string; description: string; gap: string }
> = {
  sm: {
    icon: "h-8 w-8",
    wrapper: "p-4",
    title: "text-sm font-semibold",
    description: "text-xs",
    gap: "gap-2",
  },
  md: {
    icon: "h-12 w-12",
    wrapper: "p-8",
    title: "text-base font-semibold",
    description: "text-sm",
    gap: "gap-3",
  },
  lg: {
    icon: "h-16 w-16",
    wrapper: "p-12",
    title: "text-lg font-semibold",
    description: "text-sm",
    gap: "gap-4",
  },
};

/* ── Fade-in animation ── */

const fadeIn = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

/* ── Action button helper ── */

function ActionButton({
  action,
  variant,
}: {
  action: EmptyStateAction;
  variant: "default" | "outline";
}) {
  if (action.href) {
    return (
      <Button variant={variant} asChild>
        <a href={action.href}>{action.label}</a>
      </Button>
    );
  }

  return (
    <Button variant={variant} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

/* ── Core component ── */

/**
 * EmptyState -- Reusable empty / zero-data placeholder.
 *
 * Renders a centered card-like area with an icon or illustration, title,
 * optional description, and up to two action buttons. Supports three size
 * variants and includes a subtle fade-in animation via Framer Motion.
 */
export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  primaryAction,
  secondaryAction,
  size = "md",
  className,
}: EmptyStateProps) {
  const s = SIZE_CONFIG[size];

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      role="status"
      aria-label={title}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        s.wrapper,
        s.gap,
        className,
      )}
    >
      {/* Icon or custom illustration */}
      {illustration ?? (
        Icon && (
          <div
            className={cn(
              "flex items-center justify-center rounded-full",
              "bg-muted/60 dark:bg-muted/30",
              size === "sm" ? "p-2" : size === "md" ? "p-3" : "p-4",
            )}
            aria-hidden="true"
          >
            <Icon
              className={cn(
                s.icon,
                "text-muted-foreground/70 dark:text-muted-foreground/50",
              )}
              strokeWidth={1.5}
            />
          </div>
        )
      )}

      {/* Text content */}
      <div className={cn("flex flex-col", size === "sm" ? "gap-0.5" : "gap-1")}>
        <h3
          className={cn(
            s.title,
            "text-foreground dark:text-foreground",
          )}
        >
          {title}
        </h3>

        {description && (
          <p
            className={cn(
              s.description,
              "max-w-sm text-muted-foreground dark:text-muted-foreground",
            )}
          >
            {description}
          </p>
        )}
      </div>

      {/* Actions */}
      {(primaryAction || secondaryAction) && (
        <div className="mt-1 flex items-center gap-2">
          {primaryAction && (
            <ActionButton action={primaryAction} variant="default" />
          )}
          {secondaryAction && (
            <ActionButton action={secondaryAction} variant="outline" />
          )}
        </div>
      )}
    </motion.div>
  );
}

EmptyState.displayName = "EmptyState";

/* ═══════════════════════════════════════════════════════════════════════
   Pre-built empty states
   ═══════════════════════════════════════════════════════════════════════ */

type PresetProps = {
  /** Override the default primary action */
  primaryAction?: EmptyStateAction;
  /** Optional secondary action */
  secondaryAction?: EmptyStateAction;
  size?: EmptyStateSize;
  className?: string;
};

/** No clusters connected */
export function EmptyNoClusters({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={ServerOff}
      title="No clusters connected"
      description="Connect a Kubernetes cluster to start monitoring workloads, resources, and events."
      primaryAction={primaryAction ?? { label: "Connect Cluster" }}
      {...rest}
    />
  );
}
EmptyNoClusters.displayName = "EmptyNoClusters";

/** No workloads found */
export function EmptyNoWorkloads({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={Boxes}
      title="No workloads found"
      description="This cluster has no deployments, stateful sets, or daemon sets in the selected namespace."
      primaryAction={primaryAction ?? { label: "Deploy a workload" }}
      {...rest}
    />
  );
}
EmptyNoWorkloads.displayName = "EmptyNoWorkloads";

/** Metrics not available */
export function EmptyNoMetrics({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={BarChart3}
      title="Metrics not available"
      description="The metrics-server add-on is not installed on this cluster. Install it to view CPU and memory usage."
      primaryAction={primaryAction ?? { label: "Install metrics-server" }}
      {...rest}
    />
  );
}
EmptyNoMetrics.displayName = "EmptyNoMetrics";

/** No events */
export function EmptyNoEvents({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={CalendarClock}
      title="No events"
      description="Kubernetes events are short-lived and will appear here when the cluster reports warnings or changes."
      primaryAction={primaryAction}
      {...rest}
    />
  );
}
EmptyNoEvents.displayName = "EmptyNoEvents";

/** No add-ons installed */
export function EmptyNoAddons({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={Puzzle}
      title="No add-ons installed"
      description="Extend your cluster with monitoring, logging, networking, and security add-ons from the catalog."
      primaryAction={primaryAction ?? { label: "Browse Add-ons" }}
      {...rest}
    />
  );
}
EmptyNoAddons.displayName = "EmptyNoAddons";

/** Cluster disconnected */
export function EmptyDisconnected({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={WifiOff}
      title="Cluster disconnected"
      description="Unable to reach the cluster API server. Check your network connection and cluster status."
      primaryAction={primaryAction ?? { label: "Reconnect" }}
      {...rest}
    />
  );
}
EmptyDisconnected.displayName = "EmptyDisconnected";

/** No search results */
export function EmptyNoResults({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={SearchX}
      title="No results found"
      description="No resources match the current filters. Try adjusting your search or clearing all filters."
      primaryAction={primaryAction ?? { label: "Clear filters" }}
      {...rest}
    />
  );
}
EmptyNoResults.displayName = "EmptyNoResults";

/** AI not configured */
export function EmptyNoAI({ primaryAction, ...rest }: PresetProps) {
  return (
    <EmptyState
      icon={BrainCircuit}
      title="AI not configured"
      description="Connect an AI provider to unlock intelligent diagnostics, incident analysis, and natural-language queries."
      primaryAction={primaryAction ?? { label: "Configure AI" }}
      {...rest}
    />
  );
}
EmptyNoAI.displayName = "EmptyNoAI";
