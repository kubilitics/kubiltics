/**
 * TASK-OBS-006: Audit Log Export (Frontend)
 *
 * Export button with format selection (JSON/CSV),
 * filter controls (date range, user, resource type, action),
 * streaming download progress indicator,
 * and rate limit display (1 export per minute).
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  FileJson,
  FileSpreadsheet,
  Filter,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Calendar,
  User,
  Box,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { downloadBlob } from '@/lib/exportUtils';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

type ExportFormat = 'json' | 'csv';

interface ExportFilters {
  dateFrom: string;
  dateTo: string;
  user: string;
  resourceType: string;
  action: string;
}

type ExportState = 'idle' | 'exporting' | 'done' | 'error' | 'rate-limited';

// ─── Rate Limiter ────────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 60_000; // 1 export per minute

function useRateLimiter() {
  const lastExport = useRef<number>(0);

  const canExport = useCallback((): boolean => {
    return Date.now() - lastExport.current >= RATE_LIMIT_MS;
  }, []);

  const remainingMs = useCallback((): number => {
    const elapsed = Date.now() - lastExport.current;
    return Math.max(0, RATE_LIMIT_MS - elapsed);
  }, []);

  const markExport = useCallback(() => {
    lastExport.current = Date.now();
  }, []);

  return { canExport, remainingMs, markExport };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AuditLogExport({ className }: { className?: string }) {
  const [format, setFormat] = useState<ExportFormat>('json');
  const [filters, setFilters] = useState<ExportFilters>({
    dateFrom: '',
    dateTo: '',
    user: '',
    resourceType: '',
    action: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);
  const { canExport, remainingMs, markExport } = useRateLimiter();
  const abortRef = useRef<AbortController | null>(null);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.dateFrom) count++;
    if (filters.dateTo) count++;
    if (filters.user) count++;
    if (filters.resourceType) count++;
    if (filters.action) count++;
    return count;
  }, [filters]);

  // Countdown timer for rate limit
  const startCountdown = useCallback(() => {
    const remaining = remainingMs();
    if (remaining <= 0) return;
    setCountdown(Math.ceil(remaining / 1000));
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          setExportState('idle');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingMs]);

  const handleExport = useCallback(async () => {
    if (!canExport()) {
      setExportState('rate-limited');
      startCountdown();
      toast.error('Rate limited: 1 export per minute');
      return;
    }

    setExportState('exporting');
    setProgress(0);

    abortRef.current = new AbortController();

    try {
      // Build query params
      const params = new URLSearchParams({ format });
      if (filters.dateFrom) params.set('from', filters.dateFrom);
      if (filters.dateTo) params.set('to', filters.dateTo);
      if (filters.user) params.set('user', filters.user);
      if (filters.resourceType) params.set('resource_type', filters.resourceType);
      if (filters.action) params.set('action', filters.action);

      const res = await fetch(`${baseUrl}/api/v1/audit/export?${params}`, {
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      // Stream the response for progress tracking
      const contentLength = parseInt(res.headers.get('Content-Length') ?? '0', 10);
      const reader = res.body?.getReader();

      if (!reader) {
        // Fallback: non-streaming
        const blob = await res.blob();
        const ext = format === 'json' ? 'json' : 'csv';
        const timestamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
        downloadBlob(blob, `audit-log-${timestamp}.${ext}`);
        markExport();
        setExportState('done');
        setProgress(100);
        toast.success('Audit log exported successfully');
        setTimeout(() => setExportState('idle'), 3000);
        return;
      }

      // Streaming download with progress
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength > 0) {
          setProgress(Math.round((received / contentLength) * 100));
        } else {
          // Unknown total: show indeterminate progress
          setProgress(Math.min(90, received / 1024));
        }
      }

      const blob = new Blob(chunks, {
        type: format === 'json' ? 'application/json' : 'text/csv',
      });
      const ext = format === 'json' ? 'json' : 'csv';
      const timestamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 19);
      downloadBlob(blob, `audit-log-${timestamp}.${ext}`);

      markExport();
      setExportState('done');
      setProgress(100);
      toast.success(`Audit log exported (${(received / 1024).toFixed(1)} KB)`);
      setTimeout(() => setExportState('idle'), 3000);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setExportState('idle');
        toast.info('Export cancelled');
      } else {
        setExportState('error');
        toast.error(`Export failed: ${String(err)}`);
        setTimeout(() => setExportState('idle'), 3000);
      }
    }
  }, [baseUrl, format, filters, canExport, markExport, startCountdown]);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const clearFilters = () => {
    setFilters({ dateFrom: '', dateTo: '', user: '', resourceType: '', action: '' });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-4', className)}
    >
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-indigo-500" />
              <CardTitle className="text-sm">Export Audit Logs</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {/* Rate limit indicator */}
              {countdown > 0 && (
                <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 dark:text-amber-400">
                  <Clock className="h-3 w-3" />
                  {countdown}s
                </Badge>
              )}
              {/* Filter toggle */}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-3 w-3" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="h-4 w-4 p-0 flex items-center justify-center text-[9px]">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs">
            Export audit log entries as JSON or CSV. Limited to 1 export per minute.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filters Panel */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border p-3 space-y-3 bg-slate-50/50 dark:bg-slate-800/30">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Export Filters</p>
                    {activeFilterCount > 0 && (
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={clearFilters}>
                        <X className="h-3 w-3" />
                        Clear
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        From Date
                      </Label>
                      <Input
                        type="datetime-local"
                        value={filters.dateFrom}
                        onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        To Date
                      </Label>
                      <Input
                        type="datetime-local"
                        value={filters.dateTo}
                        onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1">
                        <User className="h-3 w-3" />
                        User
                      </Label>
                      <Input
                        value={filters.user}
                        onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
                        placeholder="Filter by user..."
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1">
                        <Box className="h-3 w-3" />
                        Resource Type
                      </Label>
                      <Select
                        value={filters.resourceType || '__all__'}
                        onValueChange={(v) => setFilters((f) => ({ ...f, resourceType: v === '__all__' ? '' : v }))}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="All types" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All Types</SelectItem>
                          <SelectItem value="pod">Pods</SelectItem>
                          <SelectItem value="deployment">Deployments</SelectItem>
                          <SelectItem value="service">Services</SelectItem>
                          <SelectItem value="node">Nodes</SelectItem>
                          <SelectItem value="configmap">ConfigMaps</SelectItem>
                          <SelectItem value="secret">Secrets</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        Action
                      </Label>
                      <Input
                        value={filters.action}
                        onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                        placeholder="e.g. restart, scale, delete"
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Format Selection + Export Button */}
          <div className="flex items-center gap-3">
            {/* Format Toggle */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              <button
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  format === 'json'
                    ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100'
                    : 'text-muted-foreground',
                )}
                onClick={() => setFormat('json')}
              >
                <FileJson className="h-3 w-3" />
                JSON
              </button>
              <button
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  format === 'csv'
                    ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100'
                    : 'text-muted-foreground',
                )}
                onClick={() => setFormat('csv')}
              >
                <FileSpreadsheet className="h-3 w-3" />
                CSV
              </button>
            </div>

            {/* Export / Cancel Button */}
            <div className="flex-1" />
            {exportState === 'exporting' ? (
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={handleCancel}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleExport}
                disabled={exportState === 'rate-limited' || exportState === 'done'}
              >
                {exportState === 'done' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Exported
                  </>
                ) : exportState === 'error' ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5" />
                    Retry Export
                  </>
                ) : exportState === 'rate-limited' ? (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    Wait {countdown}s
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" />
                    Export {format.toUpperCase()}
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Progress Bar */}
          <AnimatePresence>
            {exportState === 'exporting' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-1"
              >
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Exporting audit logs...
                  </span>
                  <span className="tabular-nums">{progress}%</span>
                </div>
                <Progress value={progress} className="h-1.5" />
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default AuditLogExport;
