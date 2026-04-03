/**
 * Simulation Visual System — barrel exports.
 *
 * 6 purpose-built visualization components for Kubilitics Pillars 3, 4, 5.
 * See specs/Simulation-Visual-System-Design.md for full design rationale.
 */

/* ── Components ─────────────────────────────────────────────────── */
export { ImpactCascadeView } from './ImpactCascadeView';
export { NamespaceHeatmap } from './NamespaceHeatmap';
export { ScoreDeltaWaterfall } from './ScoreDeltaWaterfall';
export { SPOFDiffPanel } from './SPOFDiffPanel';
export { FleetComparisonRadar } from './FleetComparisonRadar';
export { AutoPilotMatrix } from './AutoPilotMatrix';

/* ── Shared micro-components ────────────────────────────────────── */
export { Stat } from './shared/Stat';
export { SeverityBadge } from './shared/SeverityBadge';
export { DeltaIndicator } from './shared/DeltaIndicator';
export { StatusDot } from './shared/StatusDot';

/* ── Types ──────────────────────────────────────────────────────── */
export type {
  Wave,
  WaveResource,
  NamespaceImpact,
  ScoreDimension,
  SPOFEntry,
  SPOFDiff,
  ClusterDimension,
  AutoPilotFinding,
} from './types';

/* ── Design tokens ──────────────────────────────────────────────── */
export {
  COLORS,
  SEVERITY_COLORS,
  STATUS_COLORS,
  WAVE_COLORS,
  FONTS,
  SIZES,
  SEVERITY_Y,
  severityColor,
} from './design-tokens';

export type { SeverityLevel, StatusType } from './design-tokens';
