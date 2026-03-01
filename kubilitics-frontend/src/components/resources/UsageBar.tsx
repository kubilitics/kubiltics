import { useId, useState, useEffect, useRef, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

export type UsageBarKind = 'cpu' | 'memory';

/** Parse CPU string (e.g. "200m", "1") to millicores number. */
export function parseCpu(value: string): number | null {
  if (!value || value === '-') return null;
  const s = value.trim();
  if (s.endsWith('m')) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * 1000 : null;
}

/** Parse memory string (e.g. "256Mi", "1Gi", "1048576") to Mi. */
export function parseMemory(value: string): number | null {
  if (!value || value === '-') return null;
  const s = value.trim();
  if (s.endsWith('Ki')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n / 1024 : null;
  }
  if (s.endsWith('Mi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  if (s.endsWith('Gi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) ? n * 1024 : null;
  }
  // Raw number is bytes in metrics-server, convert to Mi
  const n = parseFloat(s);
  return Number.isFinite(n) ? n / (1024 * 1024) : null;
}

/**
 * Format CPU for display in cores with full precision (no rounding).
 * Reference: "0", "0.01", "0.015" — small values never rounded to zero.
 */
function formatCpuDisplay(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const millicores = parseCpu(value);
  if (millicores === null) return value;
  if (millicores === 0) return '0';
  const cores = millicores / 1000;
  const fixed = cores >= 1 ? cores.toFixed(2) : cores.toFixed(3);
  return fixed.replace(/\.?0+$/, '') || '0';
}

/**
 * Format memory for display with 3 decimal precision (no rounding).
 * Reference: "19.746 Mi", "18.004 Mi".
 */
function formatMemoryDisplay(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const s = value.trim();
  let num: number;
  let unit: string;
  if (s.endsWith('Ki')) {
    num = parseFloat(s.slice(0, -2));
    unit = 'Ki';
  } else if (s.endsWith('Mi')) {
    num = parseFloat(s.slice(0, -2));
    unit = 'Mi';
  } else if (s.endsWith('Gi')) {
    num = parseFloat(s.slice(0, -2));
    unit = 'Gi';
  } else {
    const mi = parseMemory(value);
    if (mi === null) return value;
    return `${mi.toFixed(3)} Mi`;
  }
  if (!Number.isFinite(num)) return value;
  return `${num.toFixed(3)} ${unit}`;
}

/** CPU in cores with 2–3 decimals (e.g. 0.12, 0.003). Never round non-zero usage to zero. */
function formatCpuCompact(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const millicores = parseCpu(value);
  if (millicores === null) return value;
  if (millicores === 0) return '0';
  const cores = millicores / 1000;
  const fixed = cores >= 1 ? cores.toFixed(2) : cores.toFixed(3);
  return fixed.replace(/\.?0+$/, '') || '0';
}

/** Memory with 2–3 decimals (e.g. 15.55 Mi, 0.36 Mi). Never round non-zero usage to zero. */
function formatMemoryCompact(value: string): string {
  if (!value || value.trim() === '-') return '-';
  const mi = parseMemory(value);
  if (mi === null) return value;
  if (mi === 0) return '0 Mi';
  if (mi >= 1024) {
    const gi = mi / 1024;
    const fixed = gi >= 1 ? gi.toFixed(2) : gi.toFixed(3);
    return `${fixed.replace(/\.?0+$/, '') || '0'} Gi`;
  }
  const fixed = mi >= 1 ? mi.toFixed(2) : mi.toFixed(3);
  return `${fixed.replace(/\.?0+$/, '') || '0'} Mi`;
}

function formatUsageDisplay(value: string, kind: UsageBarKind, displayFormat: 'full' | 'compact' = 'full'): string {
  if (!value || value.trim() === '-') return '-';
  if (displayFormat === 'compact') return kind === 'cpu' ? formatCpuCompact(value) : formatMemoryCompact(value);
  return kind === 'cpu' ? formatCpuDisplay(value) : formatMemoryDisplay(value);
}

/** Fixed scale: 1 core and 2 Gi so bar length is consistent across the app. */
const CPU_DEFAULT_MAX = 1000; // millicores (1 core = full bar)
const MEMORY_DEFAULT_MAX = 1024; // Mi (1 Gi = full bar)

/** Calculate max CPU/Memory from pod container resources (limits or requests * 1.5) */
export function calculatePodResourceMax(
  containers: Array<{ resources?: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } } }>,
  kind: 'cpu' | 'memory'
): number | undefined {
  if (!containers || containers.length === 0) return undefined;

  let totalMax = 0;
  let hasResources = false;

  for (const container of containers) {
    const resources = container.resources;
    if (!resources) continue;

    const limit = kind === 'cpu' ? resources.limits?.cpu : resources.limits?.memory;
    const request = kind === 'cpu' ? resources.requests?.cpu : resources.requests?.memory;

    if (limit) {
      const parsed = kind === 'cpu' ? parseCpu(limit) : parseMemory(limit);
      if (parsed !== null) {
        totalMax += parsed;
        hasResources = true;
      }
    } else if (request) {
      // Use request * 1.5 as estimated max if no limit
      const parsed = kind === 'cpu' ? parseCpu(request) : parseMemory(request);
      if (parsed !== null) {
        totalMax += parsed * 1.5;
        hasResources = true;
      }
    }
  }

  return hasResources ? totalMax : undefined;
}

/** Below this ratio we show no fill (only grey track). */
const MIN_RATIO = 0.005;
/** Minimum fill size in px so small non-zero values are visible. */
const MIN_FILL_PX = 4;

export type UsageBarVariant = 'bar' | 'sparkline';

export interface UsageBarProps {
  /** Display value e.g. "200m", "256Mi", or "-" when no metrics. */
  value: string;
  kind: UsageBarKind;
  /** bar = flat solid fill; sparkline when dataPoints provided. */
  variant?: UsageBarVariant;
  /** Optional max for bar length (cpu: millicores, memory: Mi). */
  max?: number;
  /** Bar width in pixels. */
  width?: number;
  /** Time-series for sparkline (current value repeated or real history). When provided with variant=sparkline, draws line + dot (CPU) or filled area + dot (Memory). */
  dataPoints?: number[];
  /** 'compact' = CPU as "45m", Memory as "128 Mi"; 'full' = CPU as "0.045" cores, memory with decimals. */
  displayFormat?: 'full' | 'compact';
  className?: string;
  /** Enable animations (default: true) */
  animated?: boolean;
  /** Show mini sparkline (default: true) */
  showSparkline?: boolean;
  /** Show color thresholds (default: true) */
  showThresholds?: boolean;
  /** Pulse animation for high usage (default: true) */
  pulseOnHigh?: boolean;
}

/** Generate subtle sparkline data with variation around current value */
function generateSparklineData(currentValue: number, maxValue: number, seed: number = 0): number[] {
  const variation = Math.max(currentValue * 0.1, maxValue * 0.05); // 10% variation or 5% of max
  return Array.from({ length: 14 }, (_, i) => { // Slightly more points for smoother look
    const time = Date.now() / 1000 + seed;
    const offset = Math.sin(time * 0.4 + i * 0.4) * variation;
    return Math.max(0, Math.min(maxValue, currentValue + offset));
  });
}

/** Get color based on usage threshold with world-class palette */
function getUsageColor(ratio: number, kind: 'cpu' | 'memory'): string {
  if (ratio < 0.2) {
    // Quiet/Idle: Cool Vibrant blue (CPU) or Teal (Memory)
    return kind === 'cpu' ? 'hsl(217, 91%, 60%)' : 'hsl(174, 90%, 41%)';
  } else if (ratio < 0.75) {
    // Healthy: Balanced green (CPU) or Emerald (Memory)
    return kind === 'cpu' ? 'hsl(142, 70%, 45%)' : 'hsl(142, 72%, 29%)';
  } else if (ratio < 0.9) {
    // Warning: Amber/Orange
    return 'hsl(38, 92%, 50%)';
  } else {
    // High/Critical: Deep red pulsing
    return 'hsl(346, 84%, 61%)';
  }
}

/** Get gradient stops based on usage threshold */
function getGradientStops(ratio: number, kind: 'cpu' | 'memory', isSparkline: boolean): Array<{ offset: string; color: string; opacity: number }> {
  const baseColor = getUsageColor(ratio, kind);

  if (isSparkline) {
    return [
      { offset: '0%', color: baseColor, opacity: 0.4 },
      { offset: '100%', color: baseColor, opacity: 0 },
    ];
  }

  return [
    { offset: '0%', color: baseColor, opacity: 1 },
    { offset: '100%', color: baseColor, opacity: 0.85 },
  ];
}

export function UsageBar({
  value,
  kind,
  variant = 'bar',
  max = kind === 'cpu' ? CPU_DEFAULT_MAX : MEMORY_DEFAULT_MAX,
  width = 72, // Increased default width
  dataPoints,
  displayFormat = 'full',
  className,
  animated = true,
  showSparkline = true,
  showThresholds = true,
  pulseOnHigh = true,
}: UsageBarProps) {
  const uniqueId = useId();
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animated && !reducedMotion;
  const [isHovered, setIsHovered] = useState(false);
  const prevValueRef = useRef<string>(value);
  const seedRef = useRef(Math.random() * 1000);

  const valueStr = typeof value === 'string' ? value : '-';
  const numeric = kind === 'cpu' ? parseCpu(valueStr) : parseMemory(valueStr);
  const hasValue = numeric !== null && numeric >= 0;
  const displayValue = formatUsageDisplay(valueStr, kind, displayFormat);
  const effectiveMax = max ?? (kind === 'cpu' ? CPU_DEFAULT_MAX : MEMORY_DEFAULT_MAX);

  const isCpu = kind === 'cpu';
  const ratio = hasValue && effectiveMax > 0 ? Math.min(numeric! / effectiveMax, 1) : 0;
  const showFill = hasValue && ratio >= MIN_RATIO;
  const effectiveRatio = showFill ? ratio : 0;

  // Threshold-based colors
  const fillColor = showThresholds && hasValue ? getUsageColor(ratio, kind) : (isCpu ? 'hsl(217, 91%, 60%)' : 'hsl(174, 90%, 41%)');
  const isHighUsage = ratio >= 0.85;

  const barW = width;
  const barH = 20; // Slightly taller
  const fillWidthRaw = showFill ? Math.max(effectiveRatio * barW, MIN_FILL_PX) : 0;
  const fillWidth = Math.min(barW, Math.round(fillWidthRaw));

  // Generate sparkline data if not provided
  const [sparklineState, setSparklineState] = useState<number[]>([]);
  useEffect(() => {
    if (hasValue && numeric !== null && showSparkline) {
      if (dataPoints && dataPoints.length > 1) {
        setSparklineState(dataPoints);
      } else {
        setSparklineState(generateSparklineData(numeric, effectiveMax, seedRef.current));
      }
    }
  }, [hasValue, numeric, effectiveMax, dataPoints, showSparkline]);

  // Handle live updates to sparkline state for a "live" feel
  useEffect(() => {
    if (!hasValue || !showSparkline || (dataPoints && dataPoints.length > 1)) return;

    const interval = setInterval(() => {
      setSparklineState(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const variation = Math.max(last * 0.05, effectiveMax * 0.02);
        const nextValue = Math.max(0, Math.min(effectiveMax, last + (Math.random() - 0.5) * variation));
        return [...prev.slice(1), nextValue];
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [hasValue, showSparkline, dataPoints, effectiveMax]);

  // Trend detection
  const trend: 'up' | 'down' | 'stable' = useMemo(() => {
    if (sparklineState.length < 5) return 'stable';
    const recent = sparklineState.slice(-4);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const threshold = effectiveMax * 0.02;
    if (last > first + threshold) return 'up';
    if (last < first - threshold) return 'down';
    return 'stable';
  }, [sparklineState, effectiveMax]);

  // Track value changes for animation
  const valueChanged = prevValueRef.current !== value;
  useEffect(() => {
    prevValueRef.current = value;
  }, [value]);

  const useRealSparkline = variant === 'sparkline' && sparklineState.length > 1;
  const points = useRealSparkline
    ? (() => {
      const scaleMax = effectiveMax > 0 ? effectiveMax : Math.max(...sparklineState, 1);
      return sparklineState.map((v, i) => ({
        x: (i / (sparklineState.length - 1)) * barW,
        y: barH - Math.min((v / scaleMax), 1) * barH,
      }));
    })()
    : [];

  // Custom Cardinal spline-like path generator for smoother sparklines
  const pathD = points.length > 0
    ? points.reduce((acc, p, i, arr) => {
      if (i === 0) return `M ${p.x},${p.y}`;
      const prev = arr[i - 1];
      const cp1x = prev.x + (p.x - prev.x) / 2;
      return `${acc} C ${cp1x},${prev.y} ${cp1x},${p.y} ${p.x},${p.y}`;
    }, '')
    : '';

  const areaD = points.length > 0
    ? `${pathD} L ${barW},${barH} L 0,${barH} Z`
    : '';

  const lastPoint = points.length > 0 ? points[points.length - 1] : null;

  const gradientId = `usage-gradient-${isCpu ? 'cpu' : 'memory'}-${uniqueId.replace(/:/g, '-')}`;
  const sparklineGradientId = `usage-sparkline-${isCpu ? 'cpu' : 'memory'}-${uniqueId.replace(/:/g, '-')}`;
  const gradientStops = getGradientStops(ratio, kind, false);
  const sparklineStops = getGradientStops(ratio, kind, true);

  const tooltipContent = hasValue ? (
    <div className="space-y-2 p-1">
      <div className="flex items-center justify-between border-b border-border/40 pb-1">
        <span className="font-semibold text-sm">{isCpu ? 'CPU Usage' : 'Memory Usage'}</span>
        <Badge variant={ratio > 0.85 ? 'destructive' : 'outline'} className="text-[10px] font-bold h-5 uppercase">
          {Math.round(ratio * 100)}%
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Current:</span>
        <span className="font-medium text-right">{displayValue}</span>
        {effectiveMax > 0 && (
          <>
            <span className="text-muted-foreground">Capacity:</span>
            <span className="font-medium text-right">{formatUsageDisplay(effectiveMax.toString(), kind, 'compact')}</span>
          </>
        )}
        <span className="text-muted-foreground">Trend:</span>
        <span className={cn(
          "font-medium text-right flex items-center justify-end gap-1",
          trend === 'up' ? "text-destructive" : trend === 'down' ? "text-emerald-500" : "text-muted-foreground"
        )}>
          {trend === 'up' && <ArrowUpIcon className="h-3 w-3" />}
          {trend === 'down' && <ArrowDownIcon className="h-3 w-3" />}
          {trend === 'stable' && <MinusIcon className="h-3 w-3" />}
          {trend.charAt(0).toUpperCase() + trend.slice(1)}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground italic pt-1 opacity-70">
        Source: metrics-server
      </p>
    </div>
  ) : (
    <div className="p-1">
      <p className="font-medium text-sm mb-1">{isCpu ? 'CPU' : 'Memory'} Metrics</p>
      <p className="text-xs text-muted-foreground">
        Metrics are currently unavailable. Please ensure `metrics-server` is deployed in your cluster.
      </p>
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          className={cn('flex items-center gap-2 cursor-help group', className)}
          role="presentation"
          whileHover={{ x: 2 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className="flex-shrink-0 overflow-hidden rounded-md bg-muted/40 relative border border-border/10"
            style={{ width: barW, height: barH }}
          >
            {hasValue ? (
              useRealSparkline ? (
                <svg width={barW} height={barH} className="overflow-visible">
                  <defs>
                    <linearGradient id={sparklineGradientId} x1="0" x2="0" y1="0" y2="1">
                      {sparklineStops.map((stop, i) => (
                        <stop key={i} offset={stop.offset} stopColor={fillColor} stopOpacity={stop.opacity} />
                      ))}
                    </linearGradient>
                  </defs>

                  <motion.path
                    d={areaD}
                    fill={`url(#${sparklineGradientId})`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1 }}
                  />

                  <motion.path
                    d={pathD}
                    fill="none"
                    stroke={fillColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.2, ease: "easeInOut" }}
                  />

                  {lastPoint && (
                    <motion.circle
                      cx={lastPoint.x}
                      cy={lastPoint.y}
                      r="3"
                      fill={fillColor}
                      stroke="white"
                      strokeWidth="1"
                      animate={{
                        scale: isHighUsage && pulseOnHigh ? [1, 1.5, 1] : 1,
                        opacity: isHighUsage && pulseOnHigh ? [0.8, 1, 0.8] : 1,
                      }}
                      transition={isHighUsage && pulseOnHigh ? { duration: 1, repeat: Infinity } : { duration: 0.3 }}
                    />
                  )}
                </svg>
              ) : (
                <div className="h-full w-full relative">
                  <motion.div
                    className="h-full rounded-r-sm"
                    style={{
                      width: fillWidth,
                      background: fillColor,
                      boxShadow: isHighUsage && pulseOnHigh ? `0 0 8px ${fillColor}` : 'none'
                    }}
                    initial={shouldAnimate ? { width: 0 } : false}
                    animate={{
                      width: fillWidth,
                      filter: isHighUsage && pulseOnHigh ? 'brightness(1.1)' : 'none'
                    }}
                    transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                  />
                  {isHighUsage && pulseOnHigh && (
                    <motion.div
                      className="absolute inset-0 bg-white/20"
                      animate={{ opacity: [0, 0.4, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </div>
              )
            ) : (
              <div className="h-full w-full bg-muted/20 flex items-center justify-center">
                <div className="w-1/2 h-[1px] bg-muted-foreground/30" />
              </div>
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1">
              <motion.span
                key={displayValue}
                className={cn(
                  'text-[11px] font-bold tabular-nums tracking-tight',
                  hasValue ? 'text-foreground/90' : 'text-muted-foreground'
                )}
                initial={shouldAnimate && valueChanged ? { opacity: 0, y: -2 } : false}
                animate={{ opacity: 1, y: 0 }}
              >
                {displayValue}
              </motion.span>
              {hasValue && (
                <div className={cn(
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  trend === 'up' ? "text-destructive" : trend === 'down' ? "text-emerald-500" : "text-muted-foreground"
                )}>
                  {trend === 'up' && <ArrowUpIcon className="h-2.5 w-2.5" />}
                  {trend === 'down' && <ArrowDownIcon className="h-2.5 w-2.5" />}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent side="top" className="w-48 p-0 overflow-hidden shadow-xl border-border/50 backdrop-blur-md">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

/** Standard icons for trend/tooltip */
function ArrowUpIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m5 12 7-7 7 7" /><path d="M12 19V5" />
    </svg>
  );
}

function ArrowDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
    </svg>
  );
}

function MinusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12h14" />
    </svg>
  );
}

