/**
 * AutoPilotMatrix — Component 6.
 *
 * SVG scatter plot with Y-axis = severity bands, X-axis = blast radius.
 * "FIX FIRST" dashed zone in top-right. Hover syncs with companion list below.
 */
import { useState, useCallback, useMemo } from 'react';
import {
  COLORS,
  SEVERITY_COLORS,
  SEVERITY_Y,
  SIZES,
} from './design-tokens';
import { SeverityBadge } from './shared/SeverityBadge';
import type { AutoPilotFinding } from './types';

/* ── Props ──────────────────────────────────────────────────────── */

interface AutoPilotMatrixProps {
  findings: AutoPilotFinding[];
  className?: string;
}

/* ── Severity color lookup ──────────────────────────────────────── */

const SEV_COLOR: Record<string, string> = {
  critical: SEVERITY_COLORS.critical,
  high: SEVERITY_COLORS.high,
  medium: SEVERITY_COLORS.medium,
  low: SEVERITY_COLORS.safe,
};

/* ── Severity counts ────────────────────────────────────────────── */

type SeverityKey = 'critical' | 'high' | 'medium' | 'low';

/* ── Main component ─────────────────────────────────────────────── */

export function AutoPilotMatrix({
  findings,
  className = '',
}: AutoPilotMatrixProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleHover = useCallback((id: string | null) => setHoveredId(id), []);

  const severityCounts = useMemo(() => {
    const counts: Record<SeverityKey, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const f of findings) {
      counts[f.severity] += 1;
    }
    return counts;
  }, [findings]);

  const severityKeys: SeverityKey[] = ['critical', 'high', 'medium', 'low'];

  return (
    <div
      className={`rounded-xl p-6 ${className}`}
      style={{ backgroundColor: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h2
            className="text-xl font-semibold"
            style={{ color: COLORS.text }}
          >
            Auto-Pilot Priority Matrix
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: COLORS.textMuted }}>
            Y-axis = severity &middot; X-axis = blast radius &middot; Top-right
            = fix first
          </p>
        </div>

        <div className="flex gap-2">
          {severityKeys.map((s) => (
            <SeverityBadge key={s} severity={s} count={severityCounts[s]} />
          ))}
        </div>
      </div>

      {/* Scatter + companion list */}
      <div className="flex gap-6">
        {/* SVG scatter plot */}
        <svg
          viewBox={`0 0 ${SIZES.scatterW} ${SIZES.scatterH}`}
          width={SIZES.scatterW}
          height={SIZES.scatterH}
          className="overflow-visible"
          role="img"
          aria-label="Findings scatter plot by severity and blast radius"
        >
          {/* Vertical grid lines */}
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line
                x1={v * 4.8 + 20}
                y1={10}
                x2={v * 4.8 + 20}
                y2={290}
                stroke={COLORS.border}
                strokeWidth={0.5}
              />
              <text
                x={v * 4.8 + 20}
                y={298}
                textAnchor="middle"
                fill={COLORS.textDim}
                fontSize={9}
              >
                {v}
              </text>
            </g>
          ))}

          {/* Severity bands */}
          {severityKeys.map((s) => (
            <g key={s}>
              <rect
                x={0}
                y={SEVERITY_Y[s] - 10}
                width={500}
                height={60}
                fill={SEV_COLOR[s] + '08'}
                rx={4}
              />
              <text
                x={8}
                y={SEVERITY_Y[s] + 24}
                fill={SEV_COLOR[s]}
                fontSize={9}
                fontWeight={600}
                opacity={0.6}
                transform={`rotate(-90, 8, ${SEVERITY_Y[s] + 24})`}
              >
                {s.toUpperCase()}
              </text>
            </g>
          ))}

          {/* Fix-first zone */}
          <rect
            x={260}
            y={0}
            width={240}
            height={140}
            fill={SEVERITY_COLORS.critical + '08'}
            rx={8}
            stroke={SEVERITY_COLORS.critical}
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.4}
          />
          <text
            x={380}
            y={136}
            textAnchor="middle"
            fill={SEVERITY_COLORS.critical}
            fontSize={9}
            opacity={0.5}
          >
            FIX FIRST
          </text>

          {/* Dots */}
          {findings.map((f, i) => {
            const x = f.blastRadius * 4.8 + 20;
            const y = SEVERITY_Y[f.severity] + 20 + (i % 3) * 12;
            const isHovered = hoveredId === f.id;
            const dotR = isHovered ? SIZES.dotRadiusHover : SIZES.dotRadius;
            const col = SEV_COLOR[f.severity] ?? SEVERITY_COLORS.info;
            const shortName = f.targetName.split('-')[0];

            return (
              <g
                key={f.id}
                onMouseEnter={() => handleHover(f.id)}
                onMouseLeave={() => handleHover(null)}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={`${f.targetName} — ${f.severity}, blast ${f.blastRadius}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ')
                    handleHover(hoveredId === f.id ? null : f.id);
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={dotR}
                  fill={col + '40'}
                  stroke={col}
                  strokeWidth={isHovered ? 2.5 : 1.5}
                />
                <text
                  x={x}
                  y={y + 3.5}
                  textAnchor="middle"
                  fill={COLORS.text}
                  fontSize={isHovered ? 8 : 7}
                  fontWeight={500}
                >
                  {shortName}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Companion list */}
        <div className="flex flex-1 flex-col gap-1">
          {findings.map((f) => {
            const col = SEV_COLOR[f.severity] ?? SEVERITY_COLORS.info;
            const isHovered = hoveredId === f.id;
            return (
              <div
                key={f.id}
                onMouseEnter={() => handleHover(f.id)}
                onMouseLeave={() => handleHover(null)}
                className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 transition-colors"
                style={{
                  backgroundColor: isHovered ? COLORS.cardHover : 'transparent',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: col }}
                  />
                  <span
                    className="text-xs"
                    style={{ color: COLORS.text }}
                  >
                    {f.targetName}
                  </span>
                  <span
                    className="text-[10px]"
                    style={{ color: COLORS.textDim }}
                  >
                    {f.ruleName}
                  </span>
                </div>
                <div
                  className="rounded px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    backgroundColor: col + '20',
                    color: col,
                  }}
                >
                  {f.description}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
