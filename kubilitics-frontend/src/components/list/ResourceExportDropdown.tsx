import { Download, FileText, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClusterStore } from '@/stores/clusterStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  escapeCsvCell,
  objectsToYaml,
  downloadBlob,
  buildCsv,
} from '@/lib/exportUtils';

export interface CsvColumn<T> {
  label: string;
  getValue: (item: T) => string | number;
}

export interface ResourceExportConfig<T> {
  /** e.g. 'pods' */
  filenamePrefix: string;
  /** e.g. 'pods' - for toast messages */
  resourceLabel: string;
  /** Build plain object for JSON/YAML data export */
  getExportData: (item: T) => Record<string, unknown>;
  /** Columns for CSV export */
  csvColumns: CsvColumn<T>[];
  /** Optional: build Kubernetes manifest YAML per item. If not provided, "Download as YAML — Kubernetes manifests" is hidden. */
  toK8sYaml?: (item: T) => string;
}

export interface ResourceExportDropdownProps<T> {
  items: T[];
  selectedKeys: Set<string>;
  getKey: (item: T) => string;
  config: ResourceExportConfig<T>;
  /** e.g. "Selected pods" or "All visible pods" */
  selectionLabel: string;
  onToast: (message: string, type?: 'success' | 'info') => void;
  /** Optional trigger label override, e.g. "Export (5)" */
  triggerLabel?: string;
  /** Cluster name for export filenames (e.g. "docker-desktop-pods-export.csv") */
  clusterName?: string;
  className?: string;
}

function sanitizeClusterName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || '';
}

export function ResourceExportDropdown<T>({
  items,
  selectedKeys,
  getKey,
  config,
  selectionLabel,
  onToast,
  triggerLabel,
  clusterName: clusterNameProp,
  className,
}: ResourceExportDropdownProps<T>) {
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusterName = clusterNameProp ?? activeCluster?.name;
  const filenamePrefix = clusterName ? `${sanitizeClusterName(clusterName)}-${config.filenamePrefix}` : config.filenamePrefix;
  const itemsToExport =
    selectedKeys.size > 0
      ? items.filter((i) => selectedKeys.has(getKey(i)))
      : items;

  const handleExportJson = () => {
    const data = itemsToExport.map(config.getExportData);
    if (data.length === 0) {
      onToast('No items to export', 'info');
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, `${filenamePrefix}-export.json`);
    onToast(`Exported ${data.length} ${config.resourceLabel}`);
  };

  const handleExportYaml = () => {
    const data = itemsToExport.map(config.getExportData);
    if (data.length === 0) {
      onToast('No items to export', 'info');
      return;
    }
    const yaml = objectsToYaml(data);
    const blob = new Blob([yaml], { type: 'text/yaml' });
    downloadBlob(blob, `${filenamePrefix}-export.yaml`);
    onToast(`Exported ${data.length} ${config.resourceLabel} as YAML`);
  };

  const handleExportCsv = () => {
    if (itemsToExport.length === 0) {
      onToast('No items to export', 'info');
      return;
    }
    const headers = ['S.No', ...config.csvColumns.map((c) => c.label)];
    const rows = itemsToExport.map((item, index) =>
      [escapeCsvCell(index + 1), ...config.csvColumns.map((col) => escapeCsvCell(col.getValue(item)))]
    );
    const csv = buildCsv(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, `${filenamePrefix}-export.csv`);
    onToast(`Exported ${itemsToExport.length} ${config.resourceLabel} as CSV`);
  };

  const handleExportK8sYaml = () => {
    if (itemsToExport.length === 0) {
      onToast('No items to export', 'info');
      return;
    }
    if (!config.toK8sYaml) return;
    const yamls = itemsToExport.map((item) => config.toK8sYaml!(item)).join('\n');
    const blob = new Blob([yamls], { type: 'text/yaml' });
    downloadBlob(blob, `${filenamePrefix}.yaml`);
    onToast(`Exported ${itemsToExport.length} ${config.resourceLabel} YAMLs`);
  };

  const hasK8sYaml = !!config.toK8sYaml;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className ?? 'gap-2'}>
          <Download className="h-4 w-4" />
          {triggerLabel ?? (selectedKeys.size > 0 ? `Export (${selectedKeys.size})` : 'Export')}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-muted-foreground font-normal text-xs">
          {selectionLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleExportJson} className="gap-2 cursor-pointer">
          <Download className="h-4 w-4 shrink-0" />
          Export as JSON — for reports or automation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportYaml} className="gap-2 cursor-pointer">
          <FileText className="h-4 w-4 shrink-0" />
          Export as YAML — for reports or automation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportCsv} className="gap-2 cursor-pointer">
          <FileSpreadsheet className="h-4 w-4 shrink-0" />
          Export as CSV — for spreadsheets
        </DropdownMenuItem>
        {hasK8sYaml && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportK8sYaml} className="gap-2 cursor-pointer">
              <FileText className="h-4 w-4 shrink-0" />
              Download as YAML — Kubernetes manifests
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
