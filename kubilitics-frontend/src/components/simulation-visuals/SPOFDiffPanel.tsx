/**
 * SPOFDiffPanel — Component 4.
 *
 * Three sections: new SPOFs (red), resolved SPOFs (green), existing SPOFs (gray).
 * Header with before -> after count badges + "+N new" indicator.
 */
import { COLORS, SEVERITY_COLORS } from './design-tokens';
import type { SPOFDiff } from './types';

/* ── Props ──────────────────────────────────────────────────────── */

interface SPOFDiffPanelProps {
  diff: SPOFDiff;
  className?: string;
}

/* ── Main component ─────────────────────────────────────────────── */

export function SPOFDiffPanel({ diff, className = '' }: SPOFDiffPanelProps) {
  const newCount = diff.newSPOFs.length;

  return (
    <div
      className={`rounded-xl p-6 ${className}`}
      style={{ backgroundColor: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h2
          className="text-xl font-semibold"
          style={{ color: COLORS.text }}
        >
          SPOF Analysis
        </h2>

        <div className="flex items-center gap-2">
          {/* Before badge */}
          <div
            className="rounded-md px-3 py-1"
            style={{
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <span className="text-[11px]" style={{ color: COLORS.textMuted }}>
              Before:{' '}
            </span>
            <span
              className="text-sm font-bold"
              style={{ color: COLORS.text }}
            >
              {diff.beforeCount}
            </span>
          </div>

          <span
            className="text-xl leading-7"
            style={{ color: SEVERITY_COLORS.critical }}
          >
            &rarr;
          </span>

          {/* After badge */}
          <div
            className="rounded-md px-3 py-1"
            style={{
              backgroundColor: SEVERITY_COLORS.criticalBg,
              border: `1px solid ${SEVERITY_COLORS.critical}40`,
            }}
          >
            <span
              className="text-[11px]"
              style={{ color: SEVERITY_COLORS.critical }}
            >
              After:{' '}
            </span>
            <span
              className="text-sm font-bold"
              style={{ color: SEVERITY_COLORS.critical }}
            >
              {diff.afterCount}
            </span>
          </div>

          {/* +N new */}
          {newCount > 0 && (
            <div
              className="rounded-md px-3 py-1 text-[13px] font-bold"
              style={{
                backgroundColor: SEVERITY_COLORS.criticalBg,
                color: SEVERITY_COLORS.critical,
              }}
            >
              +{newCount} new
            </div>
          )}
        </div>
      </div>

      {/* ── New SPOFs ─────────────────────────────────────────── */}
      {newCount > 0 && (
        <section className="mb-4">
          <h3
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: SEVERITY_COLORS.critical, letterSpacing: 1 }}
          >
            New SPOFs Created by Simulation
          </h3>
          <div className="flex flex-col gap-1.5">
            {diff.newSPOFs.map((s) => (
              <div
                key={`${s.namespace}/${s.name}`}
                className="grid items-start gap-3 rounded-lg p-3"
                style={{
                  gridTemplateColumns: '1fr 80px 80px',
                  backgroundColor: SEVERITY_COLORS.criticalBg,
                  border: `1px solid ${SEVERITY_COLORS.critical}30`,
                }}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-base"
                      style={{ color: SEVERITY_COLORS.critical }}
                    >
                      &#x26A0;
                    </span>
                    <span
                      className="text-[13px] font-semibold"
                      style={{ color: COLORS.text }}
                    >
                      {s.name}
                    </span>
                    <span
                      className="rounded px-1.5 py-px text-[10px]"
                      style={{
                        color: COLORS.textDim,
                        backgroundColor: COLORS.bg,
                      }}
                    >
                      {s.namespace}
                    </span>
                  </div>
                  {s.reason && (
                    <div
                      className="ml-6 mt-1 text-[11px]"
                      style={{ color: COLORS.textMuted }}
                    >
                      {s.reason}
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <div
                    className="text-[10px]"
                    style={{ color: COLORS.textMuted }}
                  >
                    Fan-In
                  </div>
                  <div
                    className="text-sm font-semibold"
                    style={{ color: COLORS.text }}
                  >
                    {s.fanIn}
                  </div>
                </div>

                <div className="text-center">
                  <div
                    className="text-[10px]"
                    style={{ color: COLORS.textMuted }}
                  >
                    Blast
                  </div>
                  <div
                    className="text-sm font-semibold"
                    style={{
                      color:
                        s.blastRadius > 60
                          ? SEVERITY_COLORS.critical
                          : SEVERITY_COLORS.high,
                    }}
                  >
                    {s.blastRadius}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Resolved SPOFs ────────────────────────────────────── */}
      {diff.resolvedSPOFs.length > 0 && (
        <section className="mb-4">
          <h3
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: SEVERITY_COLORS.safe, letterSpacing: 1 }}
          >
            Resolved SPOFs
          </h3>
          <div className="flex flex-col gap-1.5">
            {diff.resolvedSPOFs.map((s) => (
              <div
                key={`${s.namespace}/${s.name}`}
                className="flex items-center gap-2 rounded-lg p-3"
                style={{
                  backgroundColor: SEVERITY_COLORS.lowBg,
                  border: `1px solid ${SEVERITY_COLORS.safe}30`,
                }}
              >
                <span
                  className="text-base"
                  style={{ color: SEVERITY_COLORS.safe }}
                >
                  &#x2713;
                </span>
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: COLORS.text }}
                >
                  {s.name}
                </span>
                <span
                  className="rounded px-1.5 py-px text-[10px]"
                  style={{
                    color: COLORS.textDim,
                    backgroundColor: COLORS.bg,
                  }}
                >
                  {s.namespace}
                </span>
                {s.reason && (
                  <span
                    className="ml-auto text-[11px]"
                    style={{ color: COLORS.textMuted }}
                  >
                    {s.reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Existing SPOFs ────────────────────────────────────── */}
      {diff.existingSPOFs.length > 0 && (
        <section>
          <h3
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: COLORS.textDim, letterSpacing: 1 }}
          >
            Pre-Existing SPOFs (unchanged)
          </h3>
          <div className="flex flex-wrap gap-2">
            {diff.existingSPOFs.map((s) => (
              <div
                key={`${s.namespace}/${s.name}`}
                className="flex items-center gap-2.5 rounded-lg px-3.5 py-2"
                style={{
                  backgroundColor: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <span
                  className="text-sm"
                  style={{ color: SEVERITY_COLORS.high }}
                >
                  &#x26A0;
                </span>
                <span
                  className="text-xs"
                  style={{ color: COLORS.text }}
                >
                  {s.name}
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: COLORS.textDim }}
                >
                  {s.namespace}
                </span>
                <span
                  className="text-[10px]"
                  style={{
                    color: COLORS.textMuted,
                    borderLeft: `1px solid ${COLORS.border}`,
                    paddingLeft: 8,
                  }}
                >
                  blast: {s.blastRadius}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
