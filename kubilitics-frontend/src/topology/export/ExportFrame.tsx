import { memo } from "react";
import { CATEGORY_COLORS, EDGE_COLORS, EDGE_STYLES, STATUS_COLORS, type EdgeStyleConfig } from "../constants/designTokens";
import { K8sIcon } from "../icons/K8sIcon";

interface ExportFrameProps {
  title: string;
  subtitle?: string;
  nodeCount: number;
  edgeCount: number;
  includeTitle?: boolean;
  includeLegend?: boolean;
}

// Resource categories with representative kinds
const CATEGORY_KINDS: Array<{ category: string; kind: string; label: string }> = [
  { category: "workload", kind: "Deployment", label: "Workload" },
  { category: "networking", kind: "Service", label: "Networking" },
  { category: "config", kind: "ConfigMap", label: "Config" },
  { category: "storage", kind: "PersistentVolume", label: "Storage" },
  { category: "rbac", kind: "Role", label: "RBAC" },
  { category: "scaling", kind: "HorizontalPodAutoscaler", label: "Scaling" },
  { category: "cluster", kind: "Node", label: "Infrastructure" },
];

// Edge relationship categories
const EDGE_CATEGORIES: Array<{ category: string; label: string }> = [
  { category: "ownership", label: "Ownership" },
  { category: "networking", label: "Network" },
  { category: "configuration", label: "Config" },
  { category: "storage", label: "Storage" },
  { category: "rbac", label: "RBAC" },
  { category: "scaling", label: "Scaling" },
];

function EdgeStylePreview({ category, style }: { category: string; style: EdgeStyleConfig }) {
  const color = EDGE_COLORS[category] ?? EDGE_COLORS.containment;
  return (
    <svg width="24" height="8" viewBox="0 0 24 8" className="shrink-0">
      <line
        x1="0" y1="4" x2="24" y2="4"
        stroke={color}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.dashArray ?? "none"}
        opacity={0.9}
      />
    </svg>
  );
}

/**
 * ExportFrame: Injected into the topology viewport during PNG/SVG export.
 * Provides a professional title block, legend, and metadata footer.
 * Removed after capture.
 */
function ExportFrameInner({
  title,
  subtitle,
  nodeCount,
  edgeCount,
  includeTitle = true,
  includeLegend = true,
}: ExportFrameProps) {
  const now = new Date().toLocaleString();

  return (
    <div className="pointer-events-none select-none" style={{ position: "absolute", inset: 0, zIndex: 100 }}>
      {/* Title block — top-left */}
      {includeTitle && (
        <div className="absolute top-4 left-4 rounded-lg bg-white/95 border border-gray-200 px-4 py-3 shadow-sm">
          <div className="text-sm font-bold text-gray-900">{title}</div>
          {subtitle && <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>}
          <div className="text-[10px] text-gray-400 mt-1">{now}</div>
        </div>
      )}

      {/* Legend — bottom-left */}
      {includeLegend && (
        <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-white/95 border border-gray-200 px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-start gap-6">
            {/* Resource categories */}
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Resources</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {CATEGORY_KINDS.map(({ category, kind, label }) => (
                  <div key={category} className="flex items-center gap-1.5">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[category]?.accent ?? "#6366F1" }}
                    />
                    <K8sIcon kind={kind} size={12} />
                    <span className="text-[10px] text-gray-600">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Relationship types */}
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Relationships</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {EDGE_CATEGORIES.map(({ category, label }) => {
                  const style = EDGE_STYLES[category];
                  if (!style) return null;
                  return (
                    <div key={category} className="flex items-center gap-1.5">
                      <EdgeStylePreview category={category} style={style} />
                      <span className="text-[10px] text-gray-600">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Status */}
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Status</div>
              <div className="flex gap-3">
                {(["healthy", "warning", "error", "unknown"] as const).map((status) => (
                  <div key={status} className="flex items-center gap-1">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[status] }}
                    />
                    <span className="text-[10px] text-gray-600 capitalize">{status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-[9px] text-gray-400">
            <span>{nodeCount} resources · {edgeCount} connections</span>
            <span>Generated by Kubilitics</span>
          </div>
        </div>
      )}
    </div>
  );
}

export const ExportFrame = memo(ExportFrameInner);
