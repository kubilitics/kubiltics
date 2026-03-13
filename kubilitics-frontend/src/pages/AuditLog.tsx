/**
 * AuditLog page — E-PLAT-003
 *
 * Shows the full AI action audit trail from /api/v1/persistence/audit.
 * Allows filtering by resource, action, user, and date range.
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardList,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  User,
  Box,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAuditLog, type AuditRecord } from '@/hooks/usePersistence';

const PAGE_SIZE = 25;

const RESULT_STYLES: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
  blocked: 'bg-amber-100 text-amber-700',
  pending: 'bg-amber-100 text-amber-700',
};

const RESULT_ICONS: Record<string, React.FC<{ className?: string }>> = {
  success: CheckCircle2,
  approved: CheckCircle2,
  rejected: XCircle,
  failed: XCircle,
  error: XCircle,
  blocked: AlertCircle,
  pending: Clock,
};

function resultClass(result: string): string {
  const lower = result?.toLowerCase?.() ?? '';
  return RESULT_STYLES[lower] ?? 'bg-slate-100 text-slate-600';
}

function ResultIcon({ result, className }: { result: string; className?: string }) {
  const lower = result?.toLowerCase?.() ?? '';
  const Icon = RESULT_ICONS[lower] ?? Clock;
  return <Icon className={className} />;
}

function AuditRow({ record }: { record: AuditRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors cursor-pointer"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-3">
        {/* Event + description */}
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 truncate">{record.event_type}</span>
            {record.action && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-mono border border-indigo-100 shrink-0">
                {record.action}
              </span>
            )}
          </div>
          {record.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{record.description}</p>
          )}
        </div>

        {/* Resource */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-slate-500 min-w-[100px]">
          <Box className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono max-w-[120px]">{record.resource || '—'}</span>
        </div>

        {/* User */}
        <div className="hidden md:flex items-center gap-1 text-xs text-slate-500 min-w-[80px]">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[80px]">{record.user_id || 'system'}</span>
        </div>

        {/* Result badge */}
        <div className="shrink-0">
          {record.result && (
            <span className={cn('inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full', resultClass(record.result))}>
              <ResultIcon result={record.result} className="h-3 w-3" />
              {record.result}
            </span>
          )}
        </div>

        {/* Timestamp */}
        <div className="shrink-0 text-xs text-slate-400 text-right min-w-[100px] hidden lg:block">
          {record.timestamp ? new Date(record.timestamp).toLocaleString() : '—'}
        </div>
      </div>

      {/* Expanded metadata */}
      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {record.correlation_id && (
            <div className="rounded-lg bg-slate-100 px-3 py-2 space-y-0.5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Correlation ID</p>
              <p className="text-xs font-mono text-slate-700 break-all">{record.correlation_id}</p>
            </div>
          )}
          {record.timestamp && (
            <div className="rounded-lg bg-slate-100 px-3 py-2 space-y-0.5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Timestamp</p>
              <p className="text-xs font-mono text-slate-700">{new Date(record.timestamp).toISOString()}</p>
            </div>
          )}
          {record.metadata && record.metadata !== '{}' && record.metadata !== 'null' && (
            <div className="sm:col-span-2 rounded-lg bg-slate-100 px-3 py-2 space-y-0.5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Metadata</p>
              <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {(() => {
                  try { return JSON.stringify(JSON.parse(record.metadata), null, 2); }
                  catch { return record.metadata; }
                })()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AuditLog() {
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({
    resource: '',
    action: '',
    user_id: '',
    result_filter: 'all',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');

  const query = useMemo(() => ({
    resource: filters.resource || undefined,
    action: filters.action || undefined,
    user_id: filters.user_id || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [filters, page]);

  const { events, total, loading, error, refresh } = useAuditLog(query);

  // Client-side search & result filter
  const filtered = useMemo(() => {
    let list = events;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.event_type ?? '').toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q) ||
        (e.resource ?? '').toLowerCase().includes(q) ||
        (e.action ?? '').toLowerCase().includes(q) ||
        (e.user_id ?? '').toLowerCase().includes(q),
      );
    }
    if (filters.result_filter !== 'all') {
      list = list.filter(e => (e.result ?? '').toLowerCase() === filters.result_filter);
    }
    return list;
  }, [events, search, filters.result_filter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6 max-w-5xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-100">
            <ClipboardList className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
            <p className="text-sm text-muted-foreground">
              Complete history of AI actions, approvals, and system events
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowFilters(v => !v)}
          >
            <Filter className="h-4 w-4" />
            Filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Events', value: total, icon: ClipboardList, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'This Page', value: filtered.length, icon: Zap, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Current Page', value: `${page + 1} / ${Math.max(1, totalPages)}`, icon: Filter, color: 'text-slate-600', bg: 'bg-slate-100' },
          { label: 'Page Size', value: PAGE_SIZE, icon: Clock, color: 'text-slate-500', bg: 'bg-slate-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`rounded-xl border border-slate-200 p-3 flex items-center gap-3 ${bg}`}>
            <Icon className={`h-4 w-4 shrink-0 ${color}`} />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className={`text-lg font-black leading-tight ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Filter Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Resource</Label>
                <Input
                  placeholder="e.g. pods/nginx"
                  value={filters.resource}
                  onChange={(e) => { setFilters(f => ({ ...f, resource: e.target.value })); setPage(0); }}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Action</Label>
                <Input
                  placeholder="e.g. restart, scale"
                  value={filters.action}
                  onChange={(e) => { setFilters(f => ({ ...f, action: e.target.value })); setPage(0); }}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">User</Label>
                <Input
                  placeholder="e.g. default, admin"
                  value={filters.user_id}
                  onChange={(e) => { setFilters(f => ({ ...f, user_id: e.target.value })); setPage(0); }}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Result</Label>
                <Select
                  value={filters.result_filter}
                  onValueChange={(v) => setFilters(f => ({ ...f, result_filter: v }))}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All results</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search events, resources, actions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Event table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              Events
              {filtered.length > 0 && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {filtered.length}
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">Click a row to expand details</p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2 border-b border-slate-100 bg-slate-50/60">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Event</span>
            <span className="hidden sm:block text-xs font-bold uppercase tracking-widest text-slate-500 min-w-[100px]">Resource</span>
            <span className="hidden md:block text-xs font-bold uppercase tracking-widest text-slate-500 min-w-[80px]">User</span>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 shrink-0">Result</span>
            <span className="hidden lg:block text-xs font-bold uppercase tracking-widest text-slate-500 text-right min-w-[100px]">Time</span>
          </div>

          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm font-medium text-red-600">Failed to load audit log</p>
              <p className="text-xs text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={refresh} className="gap-1.5 mt-2">
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ClipboardList className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No audit events found</p>
              <p className="text-xs text-muted-foreground">
                {search || filters.resource || filters.action || filters.user_id
                  ? 'Try adjusting your filters'
                  : 'AI actions will appear here when they are executed'}
              </p>
            </div>
          ) : (
            filtered.map((record) => (
              <AuditRow key={record.id} record={record} />
            ))
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} events
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
              className="gap-1.5"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
