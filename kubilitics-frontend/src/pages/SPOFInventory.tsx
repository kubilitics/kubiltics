import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  RefreshCw,
  Filter,
  X,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  ExternalLink,
  Box,
  Database,
  Server,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Wrench,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { SPOFSummaryCards } from '@/components/spof/SPOFSummaryCards';
import { useSPOFInventory } from '@/hooks/useSPOFInventory';
import { ListPagination } from '@/components/list/ListPagination';
import { cn } from '@/lib/utils';
import type { SPOFItem } from '@/services/api/spof';

// ── Constants ──────────────────────────────────────────────────────────────────

const SEVERITY_BADGE_STYLES: Record<string, string> = {
  critical: 'bg-red-900/80 text-red-200 border-red-700/50',
  high: 'bg-orange-900/80 text-orange-200 border-orange-700/50',
  medium: 'bg-yellow-900/80 text-yellow-200 border-yellow-700/50',
  low: 'bg-emerald-900/80 text-emerald-200 border-emerald-700/50',
};

const BLAST_RADIUS_COLORS: Record<string, { bar: string; badge: string }> = {
  critical: { bar: 'bg-red-500', badge: 'bg-red-900/80 text-red-200 border-red-700/50' },
  high: { bar: 'bg-orange-500', badge: 'bg-orange-900/80 text-orange-200 border-orange-700/50' },
  medium: { bar: 'bg-yellow-500', badge: 'bg-yellow-900/80 text-yellow-200 border-yellow-700/50' },
  low: { bar: 'bg-emerald-500', badge: 'bg-emerald-900/80 text-emerald-200 border-emerald-700/50' },
};

const KIND_ICONS: Record<string, React.ElementType> = {
  Deployment: Box,
  StatefulSet: Database,
  DaemonSet: Server,
};

const PAGE_SIZE_OPTIONS = [10, 25, 50];

type SortField = 'name' | 'namespace' | 'reason' | 'blast_radius_score' | 'dependent_count';
type SortDir = 'asc' | 'desc';

// ── Helpers ────────────────────────────────────────────────────────────────────

function priorityBadge(priority: string) {
  const normalized = priority.toLowerCase();
  const style = SEVERITY_BADGE_STYLES[normalized] ?? SEVERITY_BADGE_STYLES.low;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${style}`}>
      {normalized}
    </span>
  );
}

function blastRadiusBar(score: number, level: string) {
  const normalized = level.toLowerCase();
  const colors = BLAST_RADIUS_COLORS[normalized] ?? BLAST_RADIUS_COLORS.low;
  // Score is 0-100
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden max-w-[80px]">
        <div
          className={`h-full rounded-full ${colors.bar} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${colors.badge}`}>
        {score}
      </span>
    </div>
  );
}

function kindIcon(kind: string) {
  const Icon = KIND_ICONS[kind] ?? Box;
  return <Icon className="h-3.5 w-3.5 text-muted-foreground" />;
}

function getUniqueValues(items: SPOFItem[], key: 'namespace' | 'kind'): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item[key]) set.add(item[key]);
  }
  return Array.from(set).sort();
}

// ── Sortable Table Head ────────────────────────────────────────────────────────

function SortableHead({
  label,
  field,
  currentField,
  currentDir,
  onSort,
  className,
}: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const isActive = field === currentField;
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onSort(field)}
      >
        {label}
        {isActive ? (
          currentDir === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

// ── Expandable Row ─────────────────────────────────────────────────────────────

function ExpandableRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: SPOFItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="group">
        <TableCell className="w-[40px] pr-0">
          <button
            type="button"
            onClick={onToggle}
            className="p-0.5 rounded hover:bg-muted/50 transition-colors"
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {kindIcon(item.kind)}
            <div>
              <p className="text-sm font-medium">{item.name}</p>
              <Badge variant="secondary" className="text-[10px] mt-0.5">
                {item.kind}
              </Badge>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <span className="text-sm text-muted-foreground">{item.namespace}</span>
        </TableCell>
        <TableCell>
          <p className="text-sm max-w-[300px] truncate" title={item.reason}>
            {item.reason}
          </p>
        </TableCell>
        <TableCell>
          {blastRadiusBar(item.blast_radius_score, item.blast_radius_level)}
        </TableCell>
        <TableCell>
          <span className="text-sm font-semibold">{item.dependent_count}</span>
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onToggle}
          >
            {isExpanded ? 'Hide' : 'Details'}
          </Button>
        </TableCell>
      </TableRow>
      <AnimatePresence>
        {isExpanded && (
          <tr>
            <td colSpan={7} className="p-0">
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-6 py-4 bg-muted/20 border-b border-border/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">Remediations</span>
                  </div>
                  {item.remediations.length > 0 ? (
                    <ul className="space-y-2">
                      {item.remediations.map((r, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          {priorityBadge(r.priority)}
                          <span className="text-muted-foreground font-medium">{r.type}:</span>
                          <span className="text-foreground">{r.description}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No remediations available.</p>
                  )}
                  <div className="mt-3">
                    <a
                      href={`/blast-radius/${encodeURIComponent(item.namespace)}/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.name)}`}
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View Blast Radius
                    </a>
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function SPOFInventory() {
  // Filters
  const [namespaceFilter, setNamespaceFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  // Sorting
  const [sortField, setSortField] = useState<SortField>('blast_radius_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Data fetching — pass server-side filters when supported
  const { data, isLoading, isFetching, error, refetch } = useSPOFInventory();

  // Client-side filtering (in case the backend doesn't support query params yet, or for additional responsiveness)
  const filteredItems = useMemo(() => {
    let items = data?.items ?? [];
    if (namespaceFilter !== 'all') {
      items = items.filter((i) => i.namespace === namespaceFilter);
    }
    if (kindFilter !== 'all') {
      items = items.filter((i) => i.kind === kindFilter);
    }
    if (severityFilter !== 'all') {
      items = items.filter((i) => i.blast_radius_level.toLowerCase() === severityFilter);
    }
    return items;
  }, [data?.items, namespaceFilter, kindFilter, severityFilter]);

  // Sorting
  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'namespace':
          cmp = a.namespace.localeCompare(b.namespace);
          break;
        case 'reason':
          cmp = a.reason.localeCompare(b.reason);
          break;
        case 'blast_radius_score':
          cmp = a.blast_radius_score - b.blast_radius_score;
          break;
        case 'dependent_count':
          cmp = a.dependent_count - b.dependent_count;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredItems, sortField, sortDir]);

  // Calculate pagination
  const totalFiltered = sortedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const pagedItems = sortedItems.slice(start, start + pageSize);

  useEffect(() => {
    if (safePageIndex !== pageIndex) setPageIndex(safePageIndex);
  }, [safePageIndex, pageIndex]);

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPageIndex(0);
  };

  const paginationProps = {
    rangeLabel: totalFiltered > 0
      ? `Showing ${start + 1}\u2013${Math.min(start + pageSize, totalFiltered)} of ${totalFiltered}`
      : 'No items',
    hasPrev: safePageIndex > 0,
    hasNext: start + pageSize < totalFiltered,
    onPrev: () => setPageIndex((i) => Math.max(0, i - 1)),
    onNext: () => setPageIndex((i) => Math.min(totalPages - 1, i + 1)),
    currentPage: safePageIndex + 1,
    totalPages: Math.max(1, totalPages),
    onPageChange: (p: number) => setPageIndex(Math.max(0, Math.min(p - 1, totalPages - 1))),
  };

  // Unique values for filter dropdowns (derived from full data, not filtered)
  const allItems = useMemo(() => data?.items ?? [], [data?.items]);
  const namespaces = useMemo(() => getUniqueValues(allItems, 'namespace'), [allItems]);
  const kinds = useMemo(() => getUniqueValues(allItems, 'kind'), [allItems]);

  // Handlers
  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return field;
    });
    setPageIndex(0);
  }, []);

  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setNamespaceFilter('all');
    setKindFilter('all');
    setSeverityFilter('all');
    setPageIndex(0);
  }, []);

  const hasFilters = namespaceFilter !== 'all' || kindFilter !== 'all' || severityFilter !== 'all';

  const rowKey = (item: SPOFItem) => `${item.kind}/${item.namespace}/${item.name}`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full w-full flex flex-col min-h-0 bg-background text-foreground"
    >
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 pb-6 scroll-smooth w-full">
        <div className="w-full space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">SPOF Inventory</h1>
                <p className="text-sm text-muted-foreground">
                  Single points of failure detected in your cluster
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {/* Summary Cards */}
          <SPOFSummaryCards
            total={data?.total_spofs ?? 0}
            critical={data?.critical ?? 0}
            high={data?.high ?? 0}
            medium={data?.medium ?? 0}
            low={data?.low ?? 0}
          />

          {/* Filters Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={namespaceFilter} onValueChange={(v) => { setNamespaceFilter(v); setPageIndex(0); }}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Namespace" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Namespaces</SelectItem>
                {namespaces.map((ns) => (
                  <SelectItem key={ns} value={ns}>{ns}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kindFilter} onValueChange={(v) => { setKindFilter(v); setPageIndex(0); }}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Kinds</SelectItem>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPageIndex(0); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
                <X className="h-3.5 w-3.5 mr-1" />
                Clear filters
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {/* Error State */}
          {error && (
            <Card className="border-red-500/30">
              <CardContent className="py-4">
                <p className="text-sm text-red-500">
                  Failed to load SPOF inventory: {error.message}
                </p>
              </CardContent>
            </Card>
          )}

          {/* SPOF Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]" />
                    <SortableHead
                      label="Resource"
                      field="name"
                      currentField={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHead
                      label="Namespace"
                      field="namespace"
                      currentField={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="w-[140px]"
                    />
                    <SortableHead
                      label="SPOF Reason"
                      field="reason"
                      currentField={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHead
                      label="Blast Radius"
                      field="blast_radius_score"
                      currentField={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="w-[180px]"
                    />
                    <SortableHead
                      label="Dependents"
                      field="dependent_count"
                      currentField={sortField}
                      currentDir={sortDir}
                      onSort={handleSort}
                      className="w-[110px]"
                    />
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Loading SPOF inventory...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : pagedItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <CheckCircle className="h-8 w-8 text-emerald-500" />
                          <p className="text-sm font-medium text-foreground">
                            No single points of failure detected.
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Your cluster is well-configured!
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedItems.map((item) => {
                      const key = rowKey(item);
                      const isExpanded = expandedRows.has(key);
                      return (
                        <ExpandableRow
                          key={key}
                          item={item}
                          isExpanded={isExpanded}
                          onToggle={() => toggleRow(key)}
                        />
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          {sortedItems.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">{paginationProps.rangeLabel}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="press-effect gap-2">
                      {pageSize} per page
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <DropdownMenuItem
                        key={size}
                        onClick={() => handlePageSizeChange(size)}
                        className={cn(pageSize === size && 'bg-accent')}
                      >
                        {size} per page
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ListPagination
                hasPrev={paginationProps.hasPrev}
                hasNext={paginationProps.hasNext}
                onPrev={paginationProps.onPrev}
                onNext={paginationProps.onNext}
                rangeLabel={undefined}
                currentPage={paginationProps.currentPage}
                totalPages={paginationProps.totalPages}
                onPageChange={paginationProps.onPageChange}
              />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
