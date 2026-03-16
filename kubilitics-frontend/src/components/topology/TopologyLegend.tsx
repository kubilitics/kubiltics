/**
 * TopologyLegend — Compact, embeddable legend for topology exports
 *
 * Shows node category colors/shapes and relationship type labels.
 * Designed for horizontal layout when embedded in export images,
 * with full dark-mode support for on-screen display.
 */
import { NODE_COLORS, RELATIONSHIP_CONFIG } from '@/topology-engine';

// ─── Node categories with display-friendly labels ────────────────────────────

const NODE_CATEGORIES: Array<{ kind: string; label: string }> = [
  { kind: 'Deployment', label: 'Deployment' },
  { kind: 'StatefulSet', label: 'StatefulSet' },
  { kind: 'DaemonSet', label: 'DaemonSet' },
  { kind: 'ReplicaSet', label: 'ReplicaSet' },
  { kind: 'Pod', label: 'Pod' },
  { kind: 'Service', label: 'Service' },
  { kind: 'Ingress', label: 'Ingress' },
  { kind: 'ConfigMap', label: 'ConfigMap' },
  { kind: 'Secret', label: 'Secret' },
  { kind: 'PersistentVolumeClaim', label: 'PVC' },
  { kind: 'PersistentVolume', label: 'PV' },
  { kind: 'StorageClass', label: 'StorageClass' },
  { kind: 'Node', label: 'Node' },
  { kind: 'Namespace', label: 'Namespace' },
  { kind: 'Job', label: 'Job' },
  { kind: 'CronJob', label: 'CronJob' },
];

// ─── Relationship types from the engine config ───────────────────────────────

const RELATIONSHIP_TYPES = Object.entries(RELATIONSHIP_CONFIG).map(([key, cfg]) => ({
  type: key,
  label: cfg.label,
  color: cfg.color,
  style: cfg.style as 'solid' | 'dashed' | 'dotted',
}));

// ─── Subcomponents ───────────────────────────────────────────────────────────

function NodeLegendItem({ kind, label }: { kind: string; label: string }) {
  const colors = NODE_COLORS[kind] ?? { bg: '#6b7280', border: '#4b5563' };
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div
        className="w-3 h-3 rounded-full border-[1.5px] shrink-0"
        style={{ backgroundColor: colors.bg, borderColor: colors.border }}
      />
      <span className="text-[10px] font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

function EdgeLegendItem({ label, color, style }: { label: string; color: string; style: string }) {
  const dashArray = style === 'dashed' ? '4 3' : style === 'dotted' ? '2 2' : 'none';
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <svg width="20" height="8" className="shrink-0">
        <line
          x1="0" y1="4" x2="16" y2="4"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={dashArray}
        />
        <polygon points="16,1 20,4 16,7" fill={color} />
      </svg>
      <span className="text-[10px] font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

// ─── Public Component ────────────────────────────────────────────────────────

export interface TopologyLegendProps {
  /** Render mode: 'inline' for on-screen overlay, 'export' for embedded in export images */
  mode?: 'inline' | 'export';
  /** Additional CSS class */
  className?: string;
}

export function TopologyLegend({ mode = 'inline', className = '' }: TopologyLegendProps) {
  const isExport = mode === 'export';

  return (
    <div
      className={`${className} ${
        isExport
          ? 'bg-white p-4 border-t border-slate-200'
          : 'bg-white/90 dark:bg-slate-900/90 backdrop-blur-md rounded-xl border border-border shadow-lg p-3'
      }`}
      data-testid="topology-legend"
    >
      {/* Nodes section */}
      <div className="mb-2.5">
        <h4
          className={`font-bold uppercase tracking-wider mb-1.5 ${
            isExport
              ? 'text-[11px] text-slate-500'
              : 'text-[10px] text-muted-foreground'
          }`}
        >
          Resources
        </h4>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {NODE_CATEGORIES.map((cat) => (
            <NodeLegendItem key={cat.kind} kind={cat.kind} label={cat.label} />
          ))}
        </div>
      </div>

      {/* Edges section */}
      <div>
        <h4
          className={`font-bold uppercase tracking-wider mb-1.5 ${
            isExport
              ? 'text-[11px] text-slate-500'
              : 'text-[10px] text-muted-foreground'
          }`}
        >
          Relationships
        </h4>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {RELATIONSHIP_TYPES.map((rel) => (
            <EdgeLegendItem
              key={rel.type}
              label={rel.label}
              color={rel.color}
              style={rel.style}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
