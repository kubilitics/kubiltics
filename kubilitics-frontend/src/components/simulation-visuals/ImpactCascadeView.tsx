/**
 * ImpactCascadeView — Component 1.
 *
 * SVG concentric rings showing wave-by-wave failure propagation.
 * Left panel: SVG with concentric rings (340x340px).
 * Right panel: expandable wave cards with resource lists.
 */
import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  COLORS,
  WAVE_COLORS,
  STATUS_COLORS,
  SIZES,
} from './design-tokens';
import { StatusDot } from './shared/StatusDot';
import type { Wave, WaveResource } from './types';

/* ── Props ──────────────────────────────────────────────────────── */

interface ImpactCascadeViewProps {
  waves: Wave[];
  originLabel?: string;
  className?: string;
}

/* ── Helpers ────────────────────────────────────────────────────── */

function waveColor(index: number): string {
  return WAVE_COLORS[Math.min(index, WAVE_COLORS.length - 1)];
}

function statusColorHex(status: WaveResource['status']): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS.degraded;
}

/* ── Legend item ─────────────────────────────────────────────────── */

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs" style={{ color: COLORS.textMuted }}>
        {label}
      </span>
    </div>
  );
}

/* ── Resource row inside an expanded wave card ──────────────────── */

function ResourceRow({
  resource,
  isHovered,
  onMouseEnter,
  onMouseLeave,
}: {
  resource: WaveResource;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="flex items-center justify-between rounded-md px-2.5 py-1.5 transition-colors"
      style={{
        backgroundColor: isHovered ? COLORS.cardHover : 'transparent',
      }}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={resource.status} />
        <span
          className="text-xs font-medium"
          style={{ color: COLORS.text }}
        >
          {resource.name}
        </span>
        <span
          className="rounded px-1.5 py-px text-[10px]"
          style={{ color: COLORS.textDim, backgroundColor: COLORS.bg }}
        >
          {resource.kind}
        </span>
        <span className="text-[10px]" style={{ color: COLORS.textDim }}>
          {resource.namespace}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-semibold uppercase"
          style={{ color: statusColorHex(resource.status) }}
        >
          {resource.status}
        </span>
        <span
          className="rounded px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums"
          style={{
            color: COLORS.textMuted,
            backgroundColor: COLORS.bg,
            minWidth: 36,
          }}
        >
          {resource.score}
        </span>
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────── */

export function ImpactCascadeView({
  waves,
  originLabel,
  className = '',
}: ImpactCascadeViewProps) {
  const [selectedWave, setSelectedWave] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const totalAffected = useMemo(
    () => waves.reduce((sum, w) => sum + w.count, 0),
    [waves],
  );

  const statusCounts = useMemo(() => {
    const counts = { removed: 0, unreachable: 0, degraded: 0 };
    for (const w of waves) {
      for (const r of w.resources) {
        counts[r.status] += 1;
      }
    }
    return counts;
  }, [waves]);

  const handleSelectWave = useCallback(
    (idx: number) => {
      setSelectedWave((prev) => (prev === idx ? null : idx));
    },
    [],
  );

  /* ── Origin label for center of SVG ─────────────────────────── */
  const origin = originLabel ?? waves[0]?.resources[0]?.name ?? 'ORIGIN';
  const originLines = origin.length > 8
    ? [origin.slice(0, Math.ceil(origin.length / 2)).toUpperCase(), origin.slice(Math.ceil(origin.length / 2)).toUpperCase()]
    : [origin.toUpperCase()];

  /* ── SVG center & viewport ──────────────────────────────────── */
  const cx = SIZES.ringCenter;
  const cy = SIZES.ringCenter;
  const vb = SIZES.ringViewBox;

  return (
    <div
      className={`rounded-xl p-6 ${className}`}
      style={{ backgroundColor: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: COLORS.text }}>
            Impact Cascade
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: COLORS.textMuted }}>
            Failure of{' '}
            <span className="font-semibold" style={{ color: '#ef4444' }}>
              {origin.toLowerCase()}
            </span>{' '}
            affects{' '}
            <span className="font-semibold" style={{ color: COLORS.text }}>
              {totalAffected} resources
            </span>{' '}
            across{' '}
            <span className="font-semibold" style={{ color: COLORS.text }}>
              {waves.length} waves
            </span>
          </p>
        </div>

        <div className="flex gap-4">
          <LegendItem
            color={STATUS_COLORS.removed}
            label={`Removed (${statusCounts.removed})`}
          />
          <LegendItem
            color={STATUS_COLORS.unreachable}
            label={`Unreachable (${statusCounts.unreachable})`}
          />
          <LegendItem
            color={STATUS_COLORS.degraded}
            label={`Degraded (${statusCounts.degraded})`}
          />
        </div>
      </div>

      {/* Body: ring + cards */}
      <div className="flex gap-6">
        {/* Left: SVG concentric rings */}
        <div className="flex shrink-0 items-center justify-center" style={{ width: 340 }}>
          <svg viewBox={`0 0 ${vb} ${vb}`} width={340} height={340}>
            {/* Render rings from outermost to innermost so inner rings paint on top */}
            {[...waves].reverse().map((wave, ri) => {
              const idx = waves.length - 1 - ri;
              const radius = SIZES.ringBaseRadius + idx * SIZES.ringGap;
              const color = waveColor(idx);
              const isSelected = selectedWave === idx;
              const baseOpacity =
                idx === 0
                  ? 1
                  : 0.15 + (0.6 / waves.length) * (waves.length - idx);

              return (
                <g
                  key={idx}
                  onClick={() => handleSelectWave(idx)}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  aria-label={`Wave ${idx}: ${wave.label}, ${wave.count} resources`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSelectWave(idx);
                  }}
                >
                  {/* Thick fill ring */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? SIZES.ringStrokeSelected : SIZES.ringStrokeDefault}
                    opacity={isSelected ? 0.5 : baseOpacity * 0.35}
                  />
                  {/* Thin outline ring */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={isSelected ? 1 : 0.6}
                    strokeDasharray={idx === 0 ? 'none' : '6 4'}
                  />
                  {/* Count label at top of ring */}
                  <text
                    x={cx}
                    y={cy - radius + 5}
                    textAnchor="middle"
                    fill={color}
                    fontSize={isSelected ? 14 : 11}
                    fontWeight={isSelected ? 700 : 500}
                    opacity={isSelected ? 1 : 0.8}
                  >
                    {wave.count}
                  </text>
                </g>
              );
            })}

            {/* Center origin */}
            <circle
              cx={cx}
              cy={cy}
              r={SIZES.ringOriginRadius}
              fill="#451a1a"
              stroke="#ef4444"
              strokeWidth={2}
            />
            {originLines.length === 1 ? (
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fill="#ef4444"
                fontSize={8}
                fontWeight={700}
              >
                {originLines[0]}
              </text>
            ) : (
              <>
                <text
                  x={cx}
                  y={cy - 3}
                  textAnchor="middle"
                  fill="#ef4444"
                  fontSize={9}
                  fontWeight={700}
                >
                  {originLines[0]}
                </text>
                <text
                  x={cx}
                  y={cy + 10}
                  textAnchor="middle"
                  fill="#ef4444"
                  fontSize={7}
                >
                  {originLines[1]}
                </text>
              </>
            )}
          </svg>
        </div>

        {/* Right: wave cards */}
        <div className="flex flex-1 flex-col gap-2">
          {waves.map((wave, idx) => {
            const color = waveColor(idx);
            const isOpen = selectedWave === idx;
            return (
              <div
                key={idx}
                onClick={() => handleSelectWave(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleSelectWave(idx);
                }}
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded-lg transition-all duration-150"
                style={{
                  backgroundColor: isOpen ? COLORS.cardHover : COLORS.card,
                  border: `1px solid ${isOpen ? color : COLORS.border}`,
                  padding: '10px 14px',
                }}
              >
                {/* Card header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                      style={{
                        backgroundColor: color + '22',
                        border: `2px solid ${color}`,
                        color,
                      }}
                    >
                      {wave.count}
                    </div>
                    <div>
                      <div
                        className="text-[13px] font-semibold"
                        style={{ color: COLORS.text }}
                      >
                        Wave {idx}: {wave.label}
                      </div>
                      <div className="text-[11px]" style={{ color: COLORS.textDim }}>
                        {wave.resources.length} resources shown &middot; {wave.count} total
                      </div>
                    </div>
                  </div>
                  <span className="text-lg" style={{ color: COLORS.textDim }}>
                    {isOpen ? '\u25BE' : '\u25B8'}
                  </span>
                </div>

                {/* Expanded resource list */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2.5 flex flex-col gap-1">
                        {wave.resources.map((r) => (
                          <ResourceRow
                            key={r.name}
                            resource={r}
                            isHovered={hoveredNode === r.name}
                            onMouseEnter={() => setHoveredNode(r.name)}
                            onMouseLeave={() => setHoveredNode(null)}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
