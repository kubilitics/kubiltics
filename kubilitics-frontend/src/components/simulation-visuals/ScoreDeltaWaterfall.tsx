/**
 * ScoreDeltaWaterfall — Component 3.
 *
 * 8-dimension before/after dual bars showing how each health dimension
 * changes after a simulation. Weighted contribution to overall score.
 */
import { useMemo } from 'react';
import { COLORS, SEVERITY_COLORS } from './design-tokens';
import { DeltaIndicator } from './shared/DeltaIndicator';
import type { ScoreDimension } from './types';

/* ── Props ──────────────────────────────────────────────────────── */

interface ScoreDeltaWaterfallProps {
  dimensions: ScoreDimension[];
  totalScoreBefore: number;
  totalScoreAfter: number;
  className?: string;
}

/* ── After-bar color based on delta severity ────────────────────── */

function afterBarColor(delta: number): string {
  if (delta < -20) return SEVERITY_COLORS.critical + '80';
  if (delta < 0) return SEVERITY_COLORS.high + '60';
  return SEVERITY_COLORS.info + '40';
}

/* ── Main component ─────────────────────────────────────────────── */

export function ScoreDeltaWaterfall({
  dimensions,
  totalScoreBefore,
  totalScoreAfter,
  className = '',
}: ScoreDeltaWaterfallProps) {
  const totalDelta = useMemo(
    () => totalScoreAfter - totalScoreBefore,
    [totalScoreBefore, totalScoreAfter],
  );

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
            Health Score Breakdown
          </h2>
          <p
            className="mt-1 text-[13px]"
            style={{ color: COLORS.textMuted }}
          >
            Before vs After simulation &middot; Weighted contribution to overall
            health
          </p>
        </div>

        {/* Total scores */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div
              className="text-[11px] uppercase"
              style={{ color: COLORS.textMuted }}
            >
              Before
            </div>
            <div
              className="text-[28px] font-bold tabular-nums leading-none"
              style={{ color: COLORS.text }}
            >
              {totalScoreBefore}
            </div>
          </div>

          <span
            className="text-2xl"
            style={{ color: SEVERITY_COLORS.critical }}
          >
            &rarr;
          </span>

          <div className="text-center">
            <div
              className="text-[11px] uppercase"
              style={{ color: COLORS.textMuted }}
            >
              After
            </div>
            <div
              className="text-[28px] font-bold tabular-nums leading-none"
              style={{ color: SEVERITY_COLORS.critical }}
            >
              {totalScoreAfter}
            </div>
          </div>

          {/* Delta badge */}
          <div
            className="rounded-md px-3 py-1 text-base font-bold"
            style={{
              backgroundColor: SEVERITY_COLORS.criticalBg,
              color: SEVERITY_COLORS.critical,
            }}
          >
            {totalDelta} pts
          </div>
        </div>
      </div>

      {/* Dimension rows */}
      <div className="flex flex-col gap-2">
        {dimensions.map((d) => {
          const isChanged = d.delta !== 0;
          return (
            <div
              key={d.name}
              className="grid items-center gap-3 rounded-md px-3 py-2"
              style={{
                gridTemplateColumns: '160px 40px 1fr 60px',
                backgroundColor: isChanged ? COLORS.card : 'transparent',
                border: isChanged
                  ? `1px solid ${COLORS.border}`
                  : '1px solid transparent',
              }}
            >
              {/* Dimension name + weight */}
              <div>
                <span
                  className="text-xs font-medium"
                  style={{
                    color: isChanged ? COLORS.text : COLORS.textDim,
                  }}
                >
                  {d.name}
                </span>
                <span
                  className="ml-1.5 text-[10px]"
                  style={{ color: COLORS.textDim }}
                >
                  ({d.weight}%)
                </span>
              </div>

              {/* Before score */}
              <span
                className="text-right text-xs tabular-nums"
                style={{ color: COLORS.textMuted }}
              >
                {d.before}
              </span>

              {/* Dual bars */}
              <div className="relative h-5">
                {/* Before bar */}
                <div
                  className="absolute left-0 top-0.5 h-[7px] rounded-sm"
                  style={{
                    width: `${d.before}%`,
                    backgroundColor: SEVERITY_COLORS.info + '40',
                  }}
                />
                {/* After bar */}
                <div
                  className="absolute left-0 rounded-sm"
                  style={{
                    top: 11,
                    height: 7,
                    width: `${d.after}%`,
                    backgroundColor: afterBarColor(d.delta),
                  }}
                />
                {/* Delta zone */}
                {isChanged && (
                  <div
                    className="absolute top-0"
                    style={{
                      left: `${Math.min(d.before, d.after)}%`,
                      width: `${Math.abs(d.delta)}%`,
                      height: 20,
                      backgroundColor: SEVERITY_COLORS.critical + '15',
                      borderLeft: `2px dashed ${SEVERITY_COLORS.critical}50`,
                      borderRight: `2px dashed ${SEVERITY_COLORS.critical}50`,
                    }}
                  />
                )}
              </div>

              {/* Delta */}
              <div className="text-right">
                {isChanged ? (
                  <DeltaIndicator delta={d.delta} />
                ) : (
                  <span
                    className="text-xs"
                    style={{ color: COLORS.textDim }}
                  >
                    &mdash;
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
