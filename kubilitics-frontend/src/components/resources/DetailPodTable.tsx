/**
 * DetailPodTable — Shared pod table for resource detail pages (Deployment, ReplicaSet,
 * StatefulSet, DaemonSet, etc.). Provides:
 *  - Checkbox selection with select-all
 *  - CPU / Memory columns with per-pod metrics
 *  - Per-row action dropdown (View Details, View Logs, Exec Shell, Download YAML, Export JSON, Delete)
 *  - Bulk action bar (Restart selected, Delete selected)
 *  - Search / pagination integration
 */
import { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box, Search, ChevronDown, MoreHorizontal, FileText, Terminal,
  Download, Trash2, RotateCcw, Copy,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useDeleteK8sResource, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';
import { getPodMetrics, type BackendDeploymentMetrics } from '@/services/backendApiClient';
import { CopyNameDropdownItem } from '@/components/list/CopyNameDropdownItem';
import { AgeCell } from '@/components/list';
import { ListPagination, PAGE_SIZE_OPTIONS } from '@/components/list';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { cn } from '@/lib/utils';
import { objectsToYaml, downloadBlob, downloadResourceJson } from '@/lib/exportUtils';

/* ---------- Types ---------- */

export interface DetailPod {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  status?: {
    phase?: string;
    podIP?: string;
    containerStatuses?: Array<{
      ready?: boolean;
      restartCount?: number;
      state?: {
        waiting?: { reason?: string };
        running?: { startedAt?: string };
        terminated?: { reason?: string; exitCode?: number };
      };
    }>;
  };
  spec?: {
    nodeName?: string;
  };
}

export interface DetailPodTableProps {
  /** The list of pods to display (already filtered by parent selector) */
  pods: DetailPod[];
  /** Parent namespace for fallback */
  namespace: string;
  /** Aggregate workload metrics (optional — per-pod metrics used as fallback) */
  workloadMetrics?: BackendDeploymentMetrics | null;
  /** Extra columns to render before the actions column */
  extraColumns?: Array<{
    header: string;
    render: (pod: DetailPod, podName: string) => React.ReactNode;
  }>;
  /** Hide Ready / Restarts columns (e.g. for DaemonSet simplified view) */
  compact?: boolean;
  /** Custom empty message */
  emptyMessage?: string;
  /** CSS className for outer wrapper */
  className?: string;
}

/* ---------- Helpers ---------- */

/** Normalize pod metrics — backend may return CPU/Memory or cpu/memory */
function normalizePodMetric(p: Record<string, unknown>): { cpu: string; memory: string } {
  const cpu = (p.CPU as string) ?? (p.cpu as string) ?? '–';
  const memory = (p.Memory as string) ?? (p.memory as string) ?? '–';
  return { cpu, memory };
}

/** Map pod phase / container status to a semantic color class */
function getPodStatusStyle(phase: string): { className: string; dotColor: string } {
  const lower = phase.toLowerCase();
  if (lower === 'running' || lower === 'succeeded') {
    return { className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20', dotColor: 'bg-emerald-500' };
  }
  if (lower === 'pending' || lower === 'init:0/1' || lower.includes('init')) {
    return { className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20', dotColor: 'bg-amber-500' };
  }
  if (lower === 'containercreating' || lower === 'podinitialized' || lower.includes('creating')) {
    return { className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20', dotColor: 'bg-blue-500 animate-pulse' };
  }
  if (lower === 'terminating' || lower.includes('terminating')) {
    return { className: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/20', dotColor: 'bg-orange-500 animate-pulse' };
  }
  if (lower === 'failed' || lower === 'crashloopbackoff' || lower === 'error' || lower.includes('backoff') || lower.includes('error')) {
    return { className: 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20', dotColor: 'bg-red-500' };
  }
  if (lower === 'unknown') {
    return { className: 'bg-muted text-muted-foreground border border-border', dotColor: 'bg-muted-foreground' };
  }
  // Default fallback
  return { className: 'bg-muted text-muted-foreground border border-border', dotColor: 'bg-muted-foreground' };
}

/** Derive a more detailed pod status from containerStatuses when available */
function derivePodDisplayPhase(pod: DetailPod): string {
  const phase = pod.status?.phase ?? 'Unknown';
  const containerStatuses = pod.status?.containerStatuses ?? [];
  for (const cs of containerStatuses) {
    if (cs.state?.waiting?.reason) {
      return cs.state.waiting.reason; // CrashLoopBackOff, ContainerCreating, ImagePullBackOff, etc.
    }
    if (cs.state?.terminated?.reason) {
      return cs.state.terminated.reason; // OOMKilled, Completed, Error, etc.
    }
  }
  return phase;
}

/* ---------- Component ---------- */

export function DetailPodTable({
  pods,
  namespace,
  workloadMetrics: _wm,
  extraColumns,
  compact = false,
  emptyMessage = 'No pods found.',
  className,
}: DetailPodTableProps) {
  const navigate = useNavigate();
  const deleteResource = useDeleteK8sResource('pods');

  /* -- Backend config for individual metrics fallback -- */
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId) ?? null;

  /* -- Search -- */
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return pods;
    const q = search.trim().toLowerCase();
    return pods.filter(
      (pod) =>
        (pod.metadata?.name ?? '').toLowerCase().includes(q) ||
        (pod.spec?.nodeName ?? '').toLowerCase().includes(q)
    );
  }, [pods, search]);

  /* -- Pagination -- */
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const page = useMemo(() => filtered.slice(start, start + pageSize), [filtered, start, pageSize]);

  const rangeLabel =
    filtered.length > 0
      ? `Showing ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`
      : 'No pods';

  /* -- Per-pod metrics via useQueries (proven pattern from NodeDetail) -- */
  const podMetricsQueries = useQueries({
    queries: page.slice(0, 50).map((pod) => ({
      queryKey: ['pod-metrics-detail', clusterId, pod.metadata?.namespace ?? namespace, pod.metadata?.name],
      queryFn: () => getPodMetrics(backendBaseUrl!, clusterId!, pod.metadata?.namespace ?? namespace, pod.metadata?.name ?? ''),
      enabled: !!(isBackendConfigured() && clusterId && pod.metadata?.name),
      staleTime: 15_000,
      refetchInterval: 60_000,
    })),
  });

  /** Final metrics map keyed by pod name */
  const metricsMap = useMemo(() => {
    const map: Record<string, { cpu: string; memory: string }> = {};
    page.slice(0, 50).forEach((pod, i) => {
      const podName = pod.metadata?.name ?? '';
      if (!podName) return;
      const data = i < podMetricsQueries.length && podMetricsQueries[i].data
        ? podMetricsQueries[i].data
        : null;
      if (data) {
        map[podName] = normalizePodMetric(data as unknown as Record<string, unknown>);
      }
    });
    return map;
  }, [page, podMetricsQueries]);

  /* -- Selection -- */
  const [selectedPods, setSelectedPods] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((key: string) => {
    setSelectedPods((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedPods.size === filtered.length && filtered.length > 0) {
      setSelectedPods(new Set());
    } else {
      setSelectedPods(new Set(filtered.map((p) => `${p.metadata?.namespace ?? namespace}/${p.metadata?.name ?? ''}`)));
    }
  }, [filtered, selectedPods.size, namespace]);

  const isAllSelected = filtered.length > 0 && selectedPods.size === filtered.length;
  const isSomeSelected = selectedPods.size > 0 && selectedPods.size < filtered.length;

  /* -- Delete dialog -- */
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; podKey: string | null; bulk: boolean }>({
    open: false,
    podKey: null,
    bulk: false,
  });

  const handleDelete = async () => {
    if (deleteDialog.bulk && selectedPods.size > 0) {
      for (const key of selectedPods) {
        const [ns, n] = key.split('/');
        await deleteResource.mutateAsync({ name: n, namespace: ns });
      }
      toast.success(`Deleted ${selectedPods.size} pods`);
      setSelectedPods(new Set());
    } else if (deleteDialog.podKey) {
      const [ns, n] = deleteDialog.podKey.split('/');
      await deleteResource.mutateAsync({ name: n, namespace: ns });
      toast.success(`Deleted pod ${n}`);
    }
    setDeleteDialog({ open: false, podKey: null, bulk: false });
  };

  /* -- Row actions -- */
  const handleViewLogs = (ns: string, name: string) => navigate(`/pods/${ns}/${name}?tab=logs`);
  const handleExecShell = (ns: string, name: string) => navigate(`/pods/${ns}/${name}?tab=exec`);

  const handleDownloadYaml = (pod: DetailPod) => {
    const podName = pod.metadata?.name ?? 'pod';
    const podNs = pod.metadata?.namespace ?? namespace;
    const data: Record<string, unknown> = {
      name: podName,
      namespace: podNs,
      status: pod.status?.phase,
      node: pod.spec?.nodeName,
    };
    const yaml = objectsToYaml([data]);
    downloadBlob(new Blob([yaml], { type: 'text/yaml' }), `${podNs}-${podName}.yaml`);
    toast.success('YAML downloaded');
  };

  const handleDownloadJson = (pod: DetailPod) => {
    downloadResourceJson(pod as KubernetesResource, `${pod.metadata?.namespace ?? namespace}-${pod.metadata?.name ?? 'pod'}.json`);
    toast.success('JSON downloaded');
  };

  const handleBulkRestart = () => {
    toast.info(`Restarting ${selectedPods.size} pods…`);
    setSelectedPods(new Set());
  };

  /* -- Render -- */
  if (pods.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Toolbar: Search + Bulk actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by pod name or node…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPageIndex(0); }}
            className="pl-9 h-9 text-sm"
            aria-label="Search pods"
          />
        </div>

        {selectedPods.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedPods.size} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Actions
                  <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleBulkRestart} className="gap-2 cursor-pointer">
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  Restart selected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => setDeleteDialog({ open: true, podKey: null, bulk: true })}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedPods(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pods match the search.</p>
      ) : (
        <>
          {/* Table */}
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="w-10 p-3">
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all pods"
                      className={cn(isSomeSelected && 'data-[state=checked]:bg-primary/50')}
                    />
                  </th>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  {!compact && <th className="text-left p-3 font-medium">Ready</th>}
                  {!compact && <th className="text-left p-3 font-medium">Restarts</th>}
                  <th className="text-left p-3 font-medium">Node</th>
                  <th className="text-left p-3 font-medium">CPU</th>
                  <th className="text-left p-3 font-medium">Memory</th>
                  {extraColumns?.map((col) => (
                    <th key={col.header} className="text-left p-3 font-medium">{col.header}</th>
                  ))}
                  <th className="text-left p-3 font-medium">Age</th>
                  <th className="w-12 p-3" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence mode="popLayout">
                {page.map((pod) => {
                  const podName = pod.metadata?.name ?? '';
                  const podNs = pod.metadata?.namespace ?? namespace;
                  const podKey = `${podNs}/${podName}`;
                  const isSelected = selectedPods.has(podKey);

                  const displayPhase = derivePodDisplayPhase(pod);
                  const statusStyle = getPodStatusStyle(displayPhase);
                  const containerStatuses = pod.status?.containerStatuses ?? [];
                  const readyCount = containerStatuses.filter((c) => c.ready).length;
                  const totalContainers = containerStatuses.length || 1;
                  const readyStr = `${readyCount}/${totalContainers}`;
                  const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);
                  const nodeName = pod.spec?.nodeName ?? '–';
                  const metrics = metricsMap[podName];
                  const age = pod.metadata?.creationTimestamp ? calculateAge(pod.metadata.creationTimestamp) : '–';

                  return (
                    <motion.tr
                      key={podKey}
                      layout
                      initial={{ opacity: 0, backgroundColor: 'hsl(var(--primary) / 0.08)' }}
                      animate={{ opacity: 1, backgroundColor: 'transparent' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className={cn(
                        'border-t hover:bg-muted/20 cursor-pointer transition-colors',
                        isSelected && 'bg-primary/5'
                      )}
                      onClick={() => navigate(`/pods/${podNs}/${podName}`)}
                    >
                      <td className="w-10 p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(podKey)}
                          aria-label={`Select ${podName}`}
                        />
                      </td>
                      <td className="p-3">
                        <Link
                          to={`/pods/${podNs}/${podName}`}
                          className="text-primary hover:underline font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {podName}
                        </Link>
                      </td>
                      <td className="p-3">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', statusStyle.className)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusStyle.dotColor)} />
                          {displayPhase}
                        </span>
                      </td>
                      {!compact && <td className="p-3 font-mono text-xs">{readyStr}</td>}
                      {!compact && (
                        <td className="p-3 font-mono text-xs">
                          <span className={cn(
                            restarts > 5 && 'text-destructive font-medium',
                            restarts > 0 && restarts <= 5 && 'text-warning font-medium'
                          )}>
                            {restarts}
                          </span>
                        </td>
                      )}
                      <td className="p-3 font-mono text-xs truncate max-w-[140px]" title={nodeName}>{nodeName}</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{metrics?.cpu ?? '–'}</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{metrics?.memory ?? '–'}</td>
                      {extraColumns?.map((col) => (
                        <td key={col.header} className="p-3">{col.render(pod, podName)}</td>
                      ))}
                      <td className="p-3">
                        <AgeCell age={age} timestamp={pod.metadata?.creationTimestamp} />
                      </td>
                      <td className="w-12 p-3" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                              aria-label="Pod actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <CopyNameDropdownItem name={podName} namespace={podNs} />
                            <DropdownMenuItem onClick={() => navigate(`/pods/${podNs}/${podName}`)} className="gap-2">
                              <Box className="h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleViewLogs(podNs, podName)} className="gap-2">
                              <FileText className="h-4 w-4" />
                              View Logs
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExecShell(podNs, podName)} className="gap-2">
                              <Terminal className="h-4 w-4" />
                              Exec Shell
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleDownloadYaml(pod)} className="gap-2">
                              <Download className="h-4 w-4" />
                              Download YAML
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownloadJson(pod)} className="gap-2">
                              <Download className="h-4 w-4" />
                              Export as JSON
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="gap-2 text-destructive"
                              onClick={() => setDeleteDialog({ open: true, podKey, bulk: false })}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </motion.tr>
                  );
                })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{rangeLabel}</span>
            </div>
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    {pageSize} per page
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <DropdownMenuItem
                      key={size}
                      onClick={() => { setPageSize(size); setPageIndex(0); }}
                      className={cn(pageSize === size && 'bg-accent')}
                    >
                      {size} per page
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <ListPagination
                hasPrev={safePageIndex > 0}
                hasNext={start + pageSize < filtered.length}
                onPrev={() => setPageIndex((i) => Math.max(0, i - 1))}
                onNext={() => setPageIndex((i) => Math.min(totalPages - 1, i + 1))}
                rangeLabel={undefined}
                currentPage={safePageIndex + 1}
                totalPages={totalPages}
                onPageChange={(p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1)))}
              />
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation */}
      <DeleteConfirmDialog
        open={deleteDialog.open}
        onOpenChange={(open) => { if (!open) setDeleteDialog({ open: false, podKey: null, bulk: false }); }}
        onConfirm={handleDelete}
        resourceName={
          deleteDialog.bulk
            ? `${selectedPods.size} selected pods`
            : deleteDialog.podKey?.split('/')[1] ?? ''
        }
        resourceType="Pod"
      />
    </div>
  );
}
