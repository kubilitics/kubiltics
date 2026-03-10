import type { ViewMode } from "../types/topology";

export interface ViewModeSelectProps {
  value?: ViewMode;
  onChange?: (mode: ViewMode) => void;
}

export function ViewModeSelect({ value = "namespace", onChange }: ViewModeSelectProps) {
  return (
    <select
      className="h-8 rounded-md border bg-background px-2 text-xs"
      value={value}
      onChange={(e) => onChange?.(e.target.value as ViewMode)}
    >
      <option value="cluster">Cluster</option>
      <option value="namespace">Namespace</option>
      <option value="workload">Workload</option>
      <option value="resource">Resource</option>
      <option value="rbac">RBAC</option>
    </select>
  );
}

