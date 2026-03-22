import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface SummaryNodeData {
  kind: string;
  name: string;
  namespace?: string;
  category: string;
  status: "healthy" | "warning" | "error" | "unknown";
  statusReason?: string;
  deploymentCount?: number;
  podCount?: number;
  serviceCount?: number;
  jobCount?: number;
  healthyCount?: number;
  warningCount?: number;
  errorCount?: number;
  monthlyCost?: number;
}

/**
 * SummaryNode: Used in Cluster View as a namespace overview node.
 * Shows aggregated counts per resource type and health summary.
 * 220x120px.
 */
function SummaryNodeComponent({ data }: NodeProps) {
  const d = data as unknown as SummaryNodeData;
  return (
    <div
      className="rounded-lg border bg-background shadow-sm"
      style={{ width: 220, minHeight: 120 }}
      role="group"
      aria-label={`Namespace ${d.name}, ${d.podCount ?? 0} pods, status ${d.status}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />

      {/* Header */}
      <div className="flex items-center justify-between rounded-t-lg bg-slate-600 px-3 py-1.5 text-white dark:bg-slate-500">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span>{"📁"}</span>
          <span className="truncate">{d.name}</span>
        </div>
        <div
          className={`h-2.5 w-2.5 rounded-full ${
            d.status === "healthy" ? "bg-green-500" :
            d.status === "warning" ? "bg-yellow-500" :
            d.status === "error" ? "bg-red-500" : "bg-gray-400"
          }`}
        />
      </div>

      {/* Resource Counts */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 px-3 py-2 text-[10px]">
        {d.deploymentCount != null && (
          <CountRow label="Deployments" count={d.deploymentCount} />
        )}
        {d.podCount != null && (
          <CountRow label="Pods" count={d.podCount} />
        )}
        {d.serviceCount != null && (
          <CountRow label="Services" count={d.serviceCount} />
        )}
        {d.jobCount != null && (
          <CountRow label="Jobs" count={d.jobCount} />
        )}
      </div>

      {/* Health Summary */}
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-[10px]">
        {d.healthyCount != null && d.healthyCount > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {d.healthyCount} healthy
          </span>
        )}
        {d.warningCount != null && d.warningCount > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
            {d.warningCount} warning
          </span>
        )}
        {d.errorCount != null && d.errorCount > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            {d.errorCount} error
          </span>
        )}
      </div>

      {/* Cost */}
      {d.monthlyCost != null && (
        <div className="border-t px-3 py-1 text-[10px] text-gray-600 dark:text-gray-400 font-medium">
          Cost: ${d.monthlyCost.toFixed(2)}/mo
        </div>
      )}
    </div>
  );
}

function CountRow({ label, count }: { label: string; count: number }) {
  return (
    <>
      <span className="text-gray-600 dark:text-gray-400">{label}:</span>
      <span className="font-medium">{count}</span>
    </>
  );
}

export const SummaryNode = memo(SummaryNodeComponent);
