/**
 * FleetComparisonRadar — Component 5.
 *
 * Recharts RadarChart comparing two clusters across 8 structural dimensions.
 * Side-by-side delta list with bar overlays and severity-colored deltas.
 */
import { useMemo } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { COLORS, SEVERITY_COLORS, SIZES } from './design-tokens';
import type { ClusterDimension } from './types';

/* ── Props ──────────────────────────────────────────────────────── */

interface FleetComparisonRadarProps {
  dimensions: ClusterDimension[];
  clusterALabel?: string;
  clusterBLabel?: string;
  clusterAScore?: number;
  clusterBScore?: number;
  className?: string;
}

/* ── Delta severity color ───────────────────────────────────────── */

function deltaSeverityColor(delta: number): string {
  const abs = Math.abs(delta);
  if (abs > 20) return SEVERITY_COLORS.critical;
  if (abs > 10) return SEVERITY_COLORS.high;
  if (abs > 0) return SEVERITY_COLORS.medium;
  return SEVERITY_COLORS.safe;
}

/* ── Main component ─────────────────────────────────────────────── */

export function FleetComparisonRadar({
  dimensions,
  clusterALabel = 'Cluster A',
  clusterBLabel = 'Cluster B',
  clusterAScore,
  clusterBScore,
  className = '',
}: FleetComparisonRadarProps) {
  /* Recharts needs a flat array with all keys */
  const radarData = useMemo(
    () =>
      dimensions.map((d) => ({
        dimension: d.name,
        clusterA: d.clusterAValue,
        clusterB: d.clusterBValue,
      })),
    [dimensions],
  );

  const aLabel = clusterAScore !== undefined
    ? `${clusterALabel} (${clusterAScore})`
    : clusterALabel;
  const bLabel = clusterBScore !== undefined
    ? `${clusterBLabel} (${clusterBScore})`
    : clusterBLabel;

  return (
    <div
      className={`rounded-xl p-6 ${className}`}
      style={{ backgroundColor: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2
          className="text-xl font-semibold"
          style={{ color: COLORS.text }}
        >
          Fleet Structural Comparison
        </h2>

        <div className="flex gap-4">
          {/* Cluster A legend */}
          <div className="flex items-center gap-1.5">
            <div
              className="h-[3px] w-3 rounded-sm"
              style={{ backgroundColor: SEVERITY_COLORS.info }}
            />
            <span className="text-xs" style={{ color: COLORS.textMuted }}>
              {aLabel}
            </span>
          </div>
          {/* Cluster B legend */}
          <div className="flex items-center gap-1.5">
            <div
              className="h-[3px] w-3 rounded-sm"
              style={{ backgroundColor: SEVERITY_COLORS.high }}
            />
            <span className="text-xs" style={{ color: COLORS.textMuted }}>
              {bLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Radar chart */}
        <div style={{ width: SIZES.radarW, height: SIZES.radarH }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke={COLORS.border} />
              <PolarAngleAxis
                dataKey="dimension"
                tick={{ fill: COLORS.textMuted, fontSize: 10 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tick={{ fill: COLORS.textDim, fontSize: 9 }}
              />
              <Radar
                name={clusterALabel}
                dataKey="clusterA"
                stroke={SEVERITY_COLORS.info}
                fill={SEVERITY_COLORS.info}
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Radar
                name={clusterBLabel}
                dataKey="clusterB"
                stroke={SEVERITY_COLORS.high}
                fill={SEVERITY_COLORS.high}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Delta list */}
        <div className="flex flex-1 flex-col gap-1.5">
          {dimensions.map((d) => {
            const severity = deltaSeverityColor(d.delta);
            const highlight = Math.abs(d.delta) > 15;
            return (
              <div
                key={d.name}
                className="grid items-center gap-2 rounded-md px-2.5 py-1.5"
                style={{
                  gridTemplateColumns: '140px 60px 60px 1fr 50px',
                  backgroundColor: highlight ? severity + '10' : 'transparent',
                }}
              >
                <span
                  className="text-xs"
                  style={{ color: COLORS.text }}
                >
                  {d.name}
                </span>
                <span
                  className="text-center text-xs font-semibold tabular-nums"
                  style={{ color: SEVERITY_COLORS.info }}
                >
                  {d.clusterAValue}
                </span>
                <span
                  className="text-center text-xs font-semibold tabular-nums"
                  style={{ color: SEVERITY_COLORS.high }}
                >
                  {d.clusterBValue}
                </span>

                {/* Overlapping bar */}
                <div
                  className="relative h-1.5 overflow-hidden rounded-sm"
                  style={{ backgroundColor: COLORS.card }}
                >
                  <div
                    className="absolute left-0 top-0 h-full rounded-sm"
                    style={{
                      width: `${d.clusterAValue}%`,
                      backgroundColor: SEVERITY_COLORS.info + '60',
                    }}
                  />
                  <div
                    className="absolute left-0 top-0 h-full rounded-sm"
                    style={{
                      width: `${d.clusterBValue}%`,
                      backgroundColor: SEVERITY_COLORS.high + '40',
                      borderRight: `2px solid ${SEVERITY_COLORS.high}`,
                    }}
                  />
                </div>

                <span
                  className="text-right text-[11px] font-semibold tabular-nums"
                  style={{ color: severity }}
                >
                  {d.delta > 0 ? '+' : ''}
                  {d.delta}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
