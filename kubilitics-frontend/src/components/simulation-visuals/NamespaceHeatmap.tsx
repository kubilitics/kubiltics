/**
 * NamespaceHeatmap — Component 2.
 *
 * Variable-sized blocks representing namespaces.
 * Block size proportional to sqrt(totalResources) x base factor.
 * Color by severity. Fill bar from bottom showing affected %.
 * Hover detail panel with namespace stats.
 */
import { useState, useMemo, useCallback } from 'react';
import {
  COLORS,
  SEVERITY_COLORS,
  STATUS_COLORS,
  SIZES,
} from './design-tokens';
import { Stat } from './shared/Stat';
import type { NamespaceImpact } from './types';

/* ── Props ──────────────────────────────────────────────────────── */

interface NamespaceHeatmapProps {
  namespaces: NamespaceImpact[];
  className?: string;
}

/* ── Severity classification ────────────────────────────────────── */

function namespaceSeverityColor(ns: NamespaceImpact): string {
  const pct = ns.totalResources > 0 ? ns.affectedResources / ns.totalResources : 0;
  if (ns.removedCount > 0 || pct > 0.7) return SEVERITY_COLORS.critical;
  if (ns.unreachableCount > 0 || pct > 0.4) return SEVERITY_COLORS.high;
  if (pct > 0.1) return SEVERITY_COLORS.medium;
  if (pct > 0) return SEVERITY_COLORS.info;
  return SEVERITY_COLORS.safe;
}

/* ── Main component ─────────────────────────────────────────────── */

export function NamespaceHeatmap({
  namespaces,
  className = '',
}: NamespaceHeatmapProps) {
  const [hoveredNs, setHoveredNs] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...namespaces].sort((a, b) => b.totalResources - a.totalResources),
    [namespaces],
  );

  const handleMouseEnter = useCallback((ns: string) => setHoveredNs(ns), []);
  const handleMouseLeave = useCallback(() => setHoveredNs(null), []);

  const hoveredData = useMemo(
    () => (hoveredNs ? sorted.find((n) => n.namespace === hoveredNs) : null),
    [hoveredNs, sorted],
  );

  return (
    <div
      className={`rounded-xl p-6 ${className}`}
      style={{ backgroundColor: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Header */}
      <h2
        className="mb-1 text-xl font-semibold"
        style={{ color: COLORS.text }}
      >
        Namespace Impact Map
      </h2>
      <p
        className="mb-5 text-[13px]"
        style={{ color: COLORS.textMuted }}
      >
        Block size = resource count &middot; Color = impact severity &middot;
        Hover to drill into namespace detail
      </p>

      {/* Heatmap blocks */}
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((ns) => {
          const w = Math.max(
            SIZES.heatmapMinW,
            Math.sqrt(ns.totalResources) * SIZES.heatmapScaleW,
          );
          const h = Math.max(
            SIZES.heatmapMinH,
            Math.sqrt(ns.totalResources) * SIZES.heatmapScaleH,
          );
          const col = namespaceSeverityColor(ns);
          const isHovered = hoveredNs === ns.namespace;
          const pct =
            ns.totalResources > 0
              ? Math.round((ns.affectedResources / ns.totalResources) * 100)
              : 0;

          return (
            <div
              key={ns.namespace}
              onMouseEnter={() => handleMouseEnter(ns.namespace)}
              onMouseLeave={handleMouseLeave}
              className="relative cursor-pointer overflow-hidden rounded-lg transition-all duration-150"
              style={{
                width: w,
                height: h,
                backgroundColor: isHovered ? col + '30' : col + '18',
                border: `2px solid ${isHovered ? col : col + '60'}`,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
              role="button"
              tabIndex={0}
              aria-label={`${ns.namespace}: ${pct}% affected`}
            >
              {/* Fill bar from bottom */}
              <div
                className="absolute bottom-0 left-0 right-0 transition-[height] duration-300"
                style={{
                  height: `${pct}%`,
                  backgroundColor: col + '20',
                }}
              />

              {/* Top: namespace + resource count */}
              <div className="relative z-10">
                <div
                  className="text-xs font-semibold"
                  style={{ color: COLORS.text }}
                >
                  {ns.namespace}
                </div>
                <div className="text-[10px]" style={{ color: COLORS.textDim }}>
                  {ns.totalResources} resources
                </div>
              </div>

              {/* Bottom: percentage + health delta */}
              <div className="relative z-10 flex items-end justify-between">
                <span
                  className="text-lg font-bold"
                  style={{ color: col }}
                >
                  {pct > 0 ? `${pct}%` : 'OK'}
                </span>
                {ns.affectedResources > 0 && (
                  <span
                    className="text-[10px]"
                    style={{ color: COLORS.textMuted }}
                  >
                    {ns.healthScoreBefore} &rarr; {ns.healthScoreAfter}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hover detail panel */}
      {hoveredData && (
        <div
          className="mt-4 flex items-center gap-6 rounded-lg p-3.5"
          style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <div>
            <div
              className="text-sm font-semibold"
              style={{ color: COLORS.text }}
            >
              {hoveredData.namespace}
            </div>
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              {hoveredData.totalResources} total resources
            </div>
          </div>

          <div className="flex gap-4">
            {hoveredData.removedCount > 0 && (
              <Stat
                label="Removed"
                value={hoveredData.removedCount}
                color={STATUS_COLORS.removed}
              />
            )}
            {hoveredData.unreachableCount > 0 && (
              <Stat
                label="Unreachable"
                value={hoveredData.unreachableCount}
                color={STATUS_COLORS.unreachable}
              />
            )}
            {hoveredData.degradedCount > 0 && (
              <Stat
                label="Degraded"
                value={hoveredData.degradedCount}
                color={STATUS_COLORS.degraded}
              />
            )}
            <Stat
              label="Unaffected"
              value={hoveredData.totalResources - hoveredData.affectedResources}
              color={SEVERITY_COLORS.safe}
            />
          </div>

          <div className="ml-auto">
            <div
              className="text-[11px]"
              style={{ color: COLORS.textMuted }}
            >
              Health Score
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="text-base font-semibold"
                style={{ color: COLORS.text }}
              >
                {hoveredData.healthScoreBefore}
              </span>
              <span style={{ color: COLORS.textDim }}>&rarr;</span>
              <span
                className="text-base font-semibold"
                style={{
                  color:
                    hoveredData.healthScoreAfter <
                    hoveredData.healthScoreBefore * 0.5
                      ? SEVERITY_COLORS.critical
                      : hoveredData.healthScoreAfter <
                          hoveredData.healthScoreBefore * 0.8
                        ? SEVERITY_COLORS.high
                        : COLORS.text,
                }}
              >
                {hoveredData.healthScoreAfter}
              </span>
              <span
                className="text-xs font-semibold"
                style={{ color: SEVERITY_COLORS.critical }}
              >
                ({hoveredData.healthScoreAfter - hoveredData.healthScoreBefore})
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
