/**
 * NamespaceSuperNode — Collapsed "super node" representing an entire namespace.
 *
 * Visual design:
 * - Rounded-rectangle with a wider, taller footprint than regular nodes (320x160)
 * - Color-coded health ring: green/amber/red based on pod health within namespace
 * - Shows: namespace name, total resource count, kind breakdown, health summary
 * - Single-click: expand inline (shows contained resources on canvas)
 * - Double-click: drill into namespace view (navigate to namespace detail)
 * - Styled distinctly: soft gradient background, bold namespace label, hexagonal shape cue
 *
 * Integration: Registered as "namespaceSuperNode" in node types.
 * Used by ProgressiveTopology when namespaces are collapsed.
 */
import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  A11Y,
  NODE_CARD,
  STATUS_COLORS,
} from "@/topology/constants/designTokens";
import type { HealthSummary } from "@/hooks/useProgressiveTopology";

// ─── Data shape ─────────────────────────────────────────────────────────────

export interface NamespaceSuperNodeData {
  namespace: string;
  resourceCount: number;
  health: HealthSummary;
  overallHealth: "healthy" | "warning" | "error" | "unknown";
  kindCounts: Record<string, number>;
  /** Whether this super-node is currently expanded (showing child resources) */
  isExpanded: boolean;
  /** Callback to toggle expand/collapse */
  onToggle?: (namespace: string) => void;
  /** Callback for drill-in navigation on double-click */
  onDrillIn?: (namespace: string) => void;
}

// ─── Health color mapping ───────────────────────────────────────────────────

const HEALTH_RING_COLORS: Record<string, { ring: string; bg: string; glow: string }> = {
  healthy: {
    ring: STATUS_COLORS.healthy,
    bg: "rgba(22, 163, 74, 0.06)",
    glow: "0 0 0 3px rgba(22, 163, 74, 0.15)",
  },
  warning: {
    ring: STATUS_COLORS.warning,
    bg: "rgba(234, 179, 8, 0.06)",
    glow: "0 0 0 3px rgba(234, 179, 8, 0.15)",
  },
  error: {
    ring: STATUS_COLORS.error,
    bg: "rgba(220, 38, 38, 0.06)",
    glow: "0 0 0 3px rgba(220, 38, 38, 0.15)",
  },
  unknown: {
    ring: STATUS_COLORS.unknown,
    bg: "rgba(156, 163, 175, 0.06)",
    glow: "0 0 0 3px rgba(156, 163, 175, 0.15)",
  },
};

// ─── Top-N kind breakdown ───────────────────────────────────────────────────

function topKinds(kindCounts: Record<string, number>, limit = 4): Array<{ kind: string; count: number }> {
  return Object.entries(kindCounts)
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ─── Component ──────────────────────────────────────────────────────────────

function NamespaceSuperNodeInner({ data, id }: NodeProps) {
  const d = data as unknown as NamespaceSuperNodeData;
  const colors = HEALTH_RING_COLORS[d.overallHealth] ?? HEALTH_RING_COLORS.unknown;
  const top = topKinds(d.kindCounts);
  const totalHealthy = d.health.healthy;
  const totalWarning = d.health.warning;
  const totalError = d.health.error;
  const totalResources = d.resourceCount;

  // Health bar percentages
  const healthyPct = totalResources > 0 ? (totalHealthy / totalResources) * 100 : 0;
  const warningPct = totalResources > 0 ? (totalWarning / totalResources) * 100 : 0;
  const errorPct = totalResources > 0 ? (totalError / totalResources) * 100 : 0;

  const handleClick = useCallback(() => {
    d.onToggle?.(d.namespace);
  }, [d]);

  const handleDoubleClick = useCallback(() => {
    d.onDrillIn?.(d.namespace);
  }, [d]);

  return (
    <div
      className={`
        ${NODE_CARD.rounding} border-2 cursor-pointer select-none
        ${A11Y.transition} ${A11Y.focusRing}
        hover:shadow-lg active:scale-[0.98]
      `}
      style={{
        width: 320,
        minHeight: 160,
        borderColor: colors.ring,
        backgroundColor: colors.bg,
        boxShadow: `${colors.glow}, 0 1px 3px rgba(0,0,0,0.08)`,
      }}
      role="treeitem"
      aria-roledescription="namespace super node"
      aria-label={`Namespace ${d.namespace}, ${d.resourceCount} resources, status ${d.overallHealth}. Click to ${d.isExpanded ? "collapse" : "expand"}.`}
      aria-expanded={d.isExpanded}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-gray-300 !border-white !border-2"
      />

      {/* Header */}
      <div
        className="flex items-center gap-2.5 rounded-t-lg px-4 py-2.5"
        style={{ backgroundColor: colors.ring }}
      >
        {/* Namespace icon — folder/hexagon shape */}
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-white/20 text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white truncate">{d.namespace}</div>
          <div className="text-[11px] text-white/70 font-medium">
            {d.resourceCount} resource{d.resourceCount !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Expand/collapse indicator */}
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-white">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${d.isExpanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        {/* Kind breakdown */}
        <div className="flex flex-wrap gap-1.5">
          {top.map(({ kind, count }) => (
            <span
              key={kind}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/60 text-gray-700 border border-gray-200/60"
            >
              {kind}
              <span className="font-bold text-gray-900">{count}</span>
            </span>
          ))}
          {Object.keys(d.kindCounts).length > 4 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] text-gray-500">
              +{Object.keys(d.kindCounts).length - 4} more
            </span>
          )}
        </div>

        {/* Health bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>Health</span>
            <span className="tabular-nums">
              {totalHealthy} ok / {totalWarning} warn / {totalError} err
            </span>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-200/60">
            {healthyPct > 0 && (
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${healthyPct}%`, backgroundColor: STATUS_COLORS.healthy }}
              />
            )}
            {warningPct > 0 && (
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${warningPct}%`, backgroundColor: STATUS_COLORS.warning }}
              />
            )}
            {errorPct > 0 && (
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${errorPct}%`, backgroundColor: STATUS_COLORS.error }}
              />
            )}
          </div>
        </div>

        {/* Action hint */}
        <div className="text-[10px] text-gray-400 text-center pt-0.5">
          Click to {d.isExpanded ? "collapse" : "expand"} &middot; Double-click to drill in
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-gray-300 !border-white !border-2"
      />
    </div>
  );
}

export const NamespaceSuperNode = memo(NamespaceSuperNodeInner);
