import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Download,
  Search,
  Pause,
  Play,
  Trash2,
  Copy,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  AlignJustify,
  Regex,
  FlipHorizontal,
  Braces,
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
  History,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { parseRawLogs, type LogEntry } from '@/lib/logParser';
import { useK8sPodLogs } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useLogFilterStore } from '@/stores/logFilterStore';
import { useLogFilterHistory } from '@/hooks/useLogFilterHistory';
import { useTheme } from '@/hooks/useTheme';
import { toast } from 'sonner';

export type { LogEntry };

export interface LogViewerProps {
  logs?: LogEntry[];
  podName?: string;
  namespace?: string;
  containerName?: string;
  containers?: string[];
  /** Map of container name → status (e.g. "running", "terminated", "waiting") */
  containerStatuses?: Record<string, string>;
  onContainerChange?: (container: string) => void;
  className?: string;
  tailLines?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVEL_PILLS: Array<{ key: string | null; label: string }> = [
  { key: null, label: 'All' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Warn' },
  { key: 'error', label: 'Error' },
  { key: 'debug', label: 'Debug' },
];

const TAIL_OPTIONS = [50, 100, 250, 500, 1000, 2000];
const CONTEXT_OPTIONS = [0, 2, 3, 5, 10];
const EMPTY_LOGS: LogEntry[] = [];

// Exponential backoff config for auto-reconnect
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLevelPillClass(key: string | null, isActive: boolean, isDark: boolean): string {
  const inactive = isDark
    ? 'text-white/35 border border-transparent hover:text-white/60 hover:bg-white/[0.06] hover:border-white/10'
    : 'text-black/35 border border-transparent hover:text-black/60 hover:bg-black/[0.06] hover:border-black/10';
  if (!isActive) return inactive;
  if (key === null) {
    return isDark
      ? 'bg-white/15 text-white border border-white/25'
      : 'bg-black/10 text-black border border-black/20';
  }
  const map: Record<string, string> = {
    info:  'bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-500/30',
    warn:  'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30',
    error: 'bg-red-500/20 text-red-600 dark:text-red-300 border border-red-500/30',
    debug: 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/30',
  };
  return map[key] ?? (isDark ? 'bg-white/15 text-white border border-white/25' : 'bg-black/10 text-black border border-black/20');
}

function getLevelCount(logs: LogEntry[], key: string | null): number {
  if (key === null) return logs.length;
  return logs.filter(l => l.level === key).length;
}

function formatTimestamp(ts: string): string {
  if (!ts) return '--:--:--';
  try {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts.slice(11, 19) || '--:--:--';
  }
}

function buildRegex(query: string, useRegex: boolean): RegExp | null {
  if (!query.trim()) return null;
  if (!useRegex) {
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }
  try {
    return new RegExp(query, 'gi');
  } catch {
    return null;
  }
}

/** Expand a set of match indices to include ±contextLines neighbours. */
function expandWithContext(
  matchIndices: Set<number>,
  total: number,
  contextLines: number
): Set<number> {
  if (contextLines === 0) return matchIndices;
  const expanded = new Set<number>();
  for (const idx of matchIndices) {
    for (let i = Math.max(0, idx - contextLines); i <= Math.min(total - 1, idx + contextLines); i++) {
      expanded.add(i);
    }
  }
  return expanded;
}

// ─── HighlightedText ──────────────────────────────────────────────────────────

function HighlightedText({
  text,
  regex,
}: {
  text: string;
  regex: RegExp | null;
}) {
  if (!regex) return <>{text}</>;
  // Reset lastIndex since regex is /gi and may be reused
  regex.lastIndex = 0;
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  // Clone to avoid mutating shared regex state across cells
  const re = new RegExp(regex.source, regex.flags);
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) { re.lastIndex++; }
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });

  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="bg-amber-400/30 text-amber-200 rounded-sm not-italic">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

// ─── JsonTree ─────────────────────────────────────────────────────────────────

function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1);

  if (data === null) return <span className="text-slate-400">null</span>;
  if (typeof data === 'boolean') return <span className="text-purple-400">{String(data)}</span>;
  if (typeof data === 'number') return <span className="text-amber-300">{String(data)}</span>;
  if (typeof data === 'string') return <span className="text-emerald-300">"{data}"</span>;

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-white/50">[]</span>;
    return (
      <span>
        <button onClick={() => setCollapsed(v => !v)} className="text-white/40 hover:text-white/70">
          {collapsed ? <ChevronRight className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
        </button>
        {collapsed ? (
          <span className="text-white/50">[{data.length}]</span>
        ) : (
          <span>
            {'['}
            <div style={{ marginLeft: 16 }}>
              {data.map((item, i) => (
                <div key={i}>
                  <JsonTree data={item} depth={depth + 1} />
                  {i < data.length - 1 && <span className="text-white/30">,</span>}
                </div>
              ))}
            </div>
            {']'}
          </span>
        )}
      </span>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-white/50">{'{}'}</span>;
    return (
      <span>
        <button onClick={() => setCollapsed(v => !v)} className="text-white/40 hover:text-white/70">
          {collapsed ? <ChevronRight className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
        </button>
        {collapsed ? (
          <span className="text-white/50">{'{'}{entries.length} keys{'}'}</span>
        ) : (
          <span>
            {'{'}
            <div style={{ marginLeft: 16 }}>
              {entries.map(([k, v], i) => (
                <div key={k}>
                  <span className="text-blue-300">"{k}"</span>
                  <span className="text-white/50">: </span>
                  <JsonTree data={v} depth={depth + 1} />
                  {i < entries.length - 1 && <span className="text-white/30">,</span>}
                </div>
              ))}
            </div>
            {'}'}
          </span>
        )}
      </span>
    );
  }

  return <span className="text-white/70">{String(data)}</span>;
}

// ─── LogRow ───────────────────────────────────────────────────────────────────

interface LogRowProps {
  log: LogEntry;
  index: number;
  isContext: boolean;
  showTimestamps: boolean;
  wrapLines: boolean;
  prettifyJson: boolean;
  searchRegex: RegExp | null;
  isDark: boolean;
  onCopy: (log: LogEntry) => void;
}

const LogRow = memo(function LogRow({
  log,
  index,
  isContext,
  showTimestamps,
  wrapLines,
  prettifyJson,
  searchRegex,
  isDark,
  onCopy,
}: LogRowProps) {
  const levelBadge: Record<string, { label: string; cls: string }> = {
    info:  { label: 'INFO', cls: 'text-blue-400/80' },
    warn:  { label: 'WARN', cls: 'text-amber-400' },
    error: { label: 'ERR!', cls: 'text-red-400' },
    debug: { label: 'DBG ', cls: 'text-purple-400/55' },
  };

  const darkMsgCls: Record<string, string> = {
    info:  'text-[hsl(142_76%_73%/0.85)]',
    warn:  'text-amber-100/85',
    error: 'text-red-300',
    debug: 'text-white/45',
  };
  const lightMsgCls: Record<string, string> = {
    info:  'text-emerald-700',
    warn:  'text-amber-700',
    error: 'text-red-600',
    debug: 'text-slate-400',
  };

  const darkRowBg: Record<string, string> = {
    error: 'bg-red-500/[0.06]',
    warn:  'bg-amber-500/[0.04]',
    info:  '',
    debug: '',
  };
  const lightRowBg: Record<string, string> = {
    error: 'bg-red-50',
    warn:  'bg-amber-50',
    info:  '',
    debug: '',
  };

  const badge = levelBadge[log.level] ?? levelBadge.info;
  const msgCls = isDark ? darkMsgCls : lightMsgCls;
  const rowBg = isDark ? darkRowBg : lightRowBg;

  // Alternating row shading (even rows get a subtle tint)
  const altShade = index % 2 === 0
    ? isDark ? 'bg-white/[0.015]' : 'bg-black/[0.015]'
    : '';

  const hoverCls = isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.04]';

  // Context lines get a left border indicator
  const contextCls = isContext ? (isDark ? 'border-l-2 border-white/10 opacity-60' : 'border-l-2 border-black/10 opacity-60') : '';

  const showJson = prettifyJson && log.isJson && log.jsonData !== undefined;

  return (
    <div
      className={cn(
        'group flex items-start px-3 py-[1px] relative transition-colors',
        rowBg[log.level],
        altShade,
        hoverCls,
        contextCls,
      )}
    >
      {/* Line number */}
      <span className={cn(
        'select-none text-right tabular-nums w-8 shrink-0 mr-2 text-[11px] leading-5 pt-px',
        isDark ? 'text-white/15' : 'text-black/25',
      )}>
        {index + 1}
      </span>

      {/* Timestamp */}
      {showTimestamps && (
        <span className={cn(
          'shrink-0 mr-3 tabular-nums text-[11px] leading-5 pt-px min-w-[52px]',
          isDark ? 'text-white/25' : 'text-black/35',
        )}>
          {formatTimestamp(log.timestamp)}
        </span>
      )}

      {/* Level badge */}
      <span
        className={cn(
          'shrink-0 mr-2.5 font-bold text-[10px] uppercase tracking-wider leading-5 pt-px w-9',
          badge.cls,
        )}
      >
        {badge.label}
      </span>

      {/* Message */}
      <span
        className={cn(
          'flex-1 min-w-0 text-[12px] leading-5 font-mono',
          msgCls[log.level] ?? (isDark ? 'text-white/80' : 'text-black/80'),
          wrapLines || showJson ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap overflow-hidden text-ellipsis',
        )}
      >
        {showJson ? (
          <span className="text-[11px] leading-relaxed">
            <JsonTree data={log.jsonData} depth={0} />
          </span>
        ) : (
          <HighlightedText text={log.message} regex={searchRegex} />
        )}
      </span>

      {/* Copy on hover */}
      <button
        className={cn(
          'opacity-0 group-hover:opacity-100 shrink-0 ml-1.5 p-0.5 rounded transition-opacity',
          isDark ? 'text-white/25 hover:text-white/70' : 'text-black/25 hover:text-black/70',
        )}
        onClick={() => onCopy(log)}
        title="Copy line"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
});

// ─── FilterHistoryDropdown ────────────────────────────────────────────────────

interface FilterHistoryDropdownProps {
  open: boolean;
  onClose: () => void;
  history: ReturnType<typeof useLogFilterHistory>['history'];
  onSelect: (query: string) => void;
  onTogglePin: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
  isDark: boolean;
}

function FilterHistoryDropdown({
  open,
  onClose,
  history,
  onSelect,
  onTogglePin,
  onRemove,
  onClear,
  isDark,
}: FilterHistoryDropdownProps) {
  if (!open) return null;
  const bg = isDark ? 'bg-[hsl(221_39%_11%)] border-white/15' : 'bg-white border-black/15';
  const textCls = isDark ? 'text-white/80' : 'text-black/80';
  const hoverRow = isDark ? 'hover:bg-white/[0.06]' : 'hover:bg-black/[0.04]';

  return (
    <div
      className={cn(
        'absolute top-full left-0 mt-1 z-50 rounded-lg border shadow-xl min-w-[280px] max-h-64 overflow-y-auto',
        bg,
      )}
    >
      {history.length === 0 ? (
        <div className={cn('px-3 py-6 text-center text-xs', isDark ? 'text-white/30' : 'text-black/30')}>
          No filter history yet
        </div>
      ) : (
        <>
          {history.map(entry => (
            <div
              key={entry.query}
              className={cn('flex items-center gap-1 px-2 py-1 group/row', hoverRow)}
            >
              <button
                className={cn('flex-1 text-left text-[12px] font-mono truncate', textCls)}
                onClick={() => { onSelect(entry.query); onClose(); }}
              >
                {entry.pinned && <Pin className="inline h-2.5 w-2.5 mr-1 text-amber-400" />}
                {entry.query}
              </button>
              <button
                onClick={() => onTogglePin(entry.query)}
                title={entry.pinned ? 'Unpin' : 'Pin'}
                className={cn(
                  'opacity-0 group-hover/row:opacity-100 p-0.5 rounded',
                  entry.pinned ? 'text-amber-400' : (isDark ? 'text-white/30 hover:text-white/70' : 'text-black/30 hover:text-black/70'),
                )}
              >
                {entry.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </button>
              <button
                onClick={() => onRemove(entry.query)}
                className={cn('opacity-0 group-hover/row:opacity-100 p-0.5 rounded', isDark ? 'text-white/30 hover:text-red-400' : 'text-black/30 hover:text-red-500')}
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className={cn('border-t px-2 py-1', isDark ? 'border-white/10' : 'border-black/10')}>
            <button
              onClick={onClear}
              className={cn('text-[11px] w-full text-left', isDark ? 'text-white/30 hover:text-white/60' : 'text-black/30 hover:text-black/60')}
            >
              Clear unpinned history
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── LogViewer ────────────────────────────────────────────────────────────────

export function LogViewer({
  logs: propLogs,
  podName,
  namespace,
  containerName = 'main',
  containers = [],
  containerStatuses = {},
  onContainerChange,
  className,
  tailLines: initialTailLines = 50,
}: LogViewerProps) {
  const { isConnected } = useConnectionStatus();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();

  // ── Persisted filter state ───────────────────────────────────────────────
  const {
    searchQuery, setSearchQuery,
    selectedLevel, setSelectedLevel,
    useRegex, setUseRegex,
    inverseFilter, setInverseFilter,
    contextLines, setContextLines,
    prettifyJson, setPrettifyJson,
    hideTerminated, setHideTerminated,
  } = useLogFilterStore();

  // ── Filter history ───────────────────────────────────────────────────────
  const { history, addFilter, togglePin, removeFilter, clearHistory } = useLogFilterHistory();
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Local UI state ───────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(true);
  const [selectedContainer, setSelectedContainer] = useState(containerName);
  const [tailLines, setTailLines] = useState(initialTailLines);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);

  // ── Auto-reconnect state ─────────────────────────────────────────────────
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logContainerRef = useRef<HTMLDivElement>(null);

  // ── Regex compilation (memoized) ─────────────────────────────────────────
  const [regexError, setRegexError] = useState<string | null>(null);
  const searchRegex = useMemo(() => {
    if (!searchQuery.trim()) { setRegexError(null); return null; }
    if (useRegex) {
      try {
        const re = new RegExp(searchQuery, 'gi');
        setRegexError(null);
        return re;
      } catch (e) {
        setRegexError((e as Error).message);
        return null;
      }
    }
    setRegexError(null);
    return new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }, [searchQuery, useRegex]);

  // ── Fetch logs ───────────────────────────────────────────────────────────
  const {
    data: rawLogs,
    isLoading,
    error,
    refetch,
    dataUpdatedAt,
  } = useK8sPodLogs(namespace || '', podName || '', selectedContainer, {
    enabled: isConnected && !!podName && !!namespace,
    tailLines,
    follow: isStreaming,
  });

  // ── Auto-reconnect on error ──────────────────────────────────────────────
  useEffect(() => {
    if (!error || !isStreaming) {
      setReconnectAttempt(0);
      setIsReconnecting(false);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      return;
    }
    if (reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
      setIsReconnecting(false);
      return;
    }
    setIsReconnecting(true);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    reconnectTimer.current = setTimeout(() => {
      setReconnectAttempt(n => n + 1);
      refetch();
    }, delay);
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [error, isStreaming, reconnectAttempt, refetch]);

  // ── Parsed logs ──────────────────────────────────────────────────────────
  const parsedLogs = useMemo(() => {
    if (!rawLogs) return EMPTY_LOGS;
    return parseRawLogs(rawLogs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLogs, dataUpdatedAt]);

  const isLive = isConnected && !!podName && !!namespace;
  const displayLogs = isLive ? parsedLogs : (propLogs ?? EMPTY_LOGS);

  // ── Filtered container list (hide terminated) ────────────────────────────
  const visibleContainers = useMemo(() => {
    if (!hideTerminated || Object.keys(containerStatuses).length === 0) return containers;
    return containers.filter(c => {
      const status = containerStatuses[c]?.toLowerCase() ?? '';
      return status !== 'terminated' && status !== 'completed';
    });
  }, [containers, containerStatuses, hideTerminated]);

  // ── Filter logs ──────────────────────────────────────────────────────────
  const filteredIndices = useMemo(() => {
    const matchSet = new Set<number>();
    displayLogs.forEach((log, i) => {
      const levelOk = !selectedLevel || log.level === selectedLevel;
      if (!levelOk) return;

      if (searchRegex && !regexError) {
        searchRegex.lastIndex = 0;
        const matches = searchRegex.test(log.message);
        searchRegex.lastIndex = 0;
        const include = inverseFilter ? !matches : matches;
        if (!include) return;
      } else if (searchQuery.trim() && regexError) {
        // Invalid regex — show nothing for safety
        return;
      }
      matchSet.add(i);
    });

    // If there's no text search or no context, just return match indices
    if (!searchQuery.trim() || contextLines === 0) return matchSet;

    return expandWithContext(matchSet, displayLogs.length, contextLines);
  }, [displayLogs, selectedLevel, searchRegex, searchQuery, regexError, inverseFilter, contextLines]);

  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim() && !selectedLevel) return displayLogs;
    return displayLogs.filter((_, i) => filteredIndices.has(i));
  }, [displayLogs, filteredIndices, searchQuery, selectedLevel]);

  // Context lines: track which indices are context (not a direct match)
  const directMatchIndices = useMemo(() => {
    if (contextLines === 0 || !searchQuery.trim()) return filteredIndices;
    // Recompute without context expansion to get pure matches
    const matchSet = new Set<number>();
    displayLogs.forEach((log, i) => {
      const levelOk = !selectedLevel || log.level === selectedLevel;
      if (!levelOk) return;
      if (searchRegex && !regexError) {
        searchRegex.lastIndex = 0;
        const matches = searchRegex.test(log.message);
        searchRegex.lastIndex = 0;
        const include = inverseFilter ? !matches : matches;
        if (include) matchSet.add(i);
      } else {
        matchSet.add(i);
      }
    });
    return matchSet;
  }, [displayLogs, selectedLevel, searchRegex, regexError, inverseFilter, contextLines, searchQuery, filteredIndices]);

  // ── Virtualizer ──────────────────────────────────────────────────────────
  const LOG_ROW_HEIGHT = 20;
  const virtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => logContainerRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 30,
  });

  // Auto-scroll when following
  useEffect(() => {
    if (isStreaming && filteredLogs.length > 0) {
      virtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' });
    }
  }, [filteredLogs.length, isStreaming, virtualizer]);

  // ── Commit search to history on Enter/blur ───────────────────────────────
  const commitSearchToHistory = useCallback(() => {
    if (searchQuery.trim()) addFilter(searchQuery.trim());
  }, [searchQuery, addFilter]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    const content = displayLogs
      .map(l => `${l.timestamp} [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName || 'logs'}-${selectedContainer}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [displayLogs, podName, selectedContainer]);

  const handleClear = useCallback(() => {
    queryClient.removeQueries({ queryKey: ['k8s', 'pods', namespace, podName, 'logs'] });
    queryClient.invalidateQueries({ queryKey: ['k8s', 'pods', namespace, podName, 'logs'] });
  }, [queryClient, namespace, podName]);

  const handleCopyLine = useCallback((log: LogEntry) => {
    navigator.clipboard.writeText(
      `${log.timestamp} [${log.level.toUpperCase()}] ${log.message}`
    );
    toast.success('Line copied');
  }, []);

  // ── Theme-aware surface classes ───────────────────────────────────────────
  const toolbar   = isDark ? 'bg-[hsl(221_39%_13%)] border-white/10'  : 'bg-slate-100 border-black/10';
  const filterBar = isDark ? 'bg-[hsl(221_39%_11%)] border-white/[0.06]' : 'bg-slate-50 border-black/[0.06]';
  const logArea   = isDark ? 'bg-[hsl(221_39%_9%)]'  : 'bg-white';
  const footer    = isDark ? 'bg-[hsl(221_39%_13%)] border-white/[0.06]' : 'bg-slate-100 border-black/[0.06]';
  const inputCls  = isDark
    ? 'bg-white/5 border-white/10 text-white/80 placeholder-white/25 focus:border-white/25'
    : 'bg-black/5 border-black/10 text-black/80 placeholder-black/25 focus:border-black/25';
  const btnCls    = isDark
    ? 'text-white/60 hover:text-white hover:bg-white/15'
    : 'text-black/50 hover:text-black hover:bg-black/10';
  const activeBtnCls = isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black';

  return (
    <div className={cn('flex flex-col rounded-xl overflow-hidden border', isDark ? 'border-white/10' : 'border-black/10', className)}>

      {/* ── Primary toolbar ───────────────────────────────────────────────── */}
      <div className={cn('border-b px-4 py-2 flex flex-wrap items-center gap-2', toolbar)}>

        {/* Connection / reconnecting badge */}
        {isReconnecting ? (
          <Badge className="gap-1.5 text-[11px] bg-amber-600/20 text-amber-400 border border-amber-500/30 hover:bg-amber-600/20 font-medium shrink-0 h-6 animate-pulse">
            <RefreshCw className="h-2.5 w-2.5 animate-spin" />
            Reconnecting…{reconnectAttempt > 0 ? ` (${reconnectAttempt})` : ''}
          </Badge>
        ) : isLive ? (
          <Badge className="gap-1.5 text-[11px] bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/20 font-medium shrink-0 h-6">
            <Wifi className="h-2.5 w-2.5" /> Live
          </Badge>
        ) : (
          <Badge className={cn('gap-1.5 text-[11px] border font-medium shrink-0 h-6', isDark ? 'bg-white/5 text-white/40 border-white/15 hover:bg-white/5' : 'bg-black/5 text-black/40 border-black/15 hover:bg-black/5')}>
            <WifiOff className="h-2.5 w-2.5" />
            {!podName || !namespace ? 'No pod' : 'Offline'}
          </Badge>
        )}

        {/* Container selector */}
        {visibleContainers.length > 1 && (
          <div className={cn('flex items-center gap-0.5 rounded-md border p-0.5', isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5')}>
            {visibleContainers.map(c => (
              <button
                key={c}
                onClick={() => { setSelectedContainer(c); onContainerChange?.(c); }}
                className={cn(
                  'h-6 px-2.5 text-[11px] font-medium rounded-sm transition-all',
                  selectedContainer === c
                    ? (isDark ? 'bg-white/15 text-white' : 'bg-black/10 text-black')
                    : (isDark ? 'text-white/40 hover:text-white hover:bg-white/[0.08]' : 'text-black/40 hover:text-black hover:bg-black/[0.08]'),
                )}
              >
                {c}
                {containerStatuses[c] && (
                  <span className={cn(
                    'ml-1 text-[9px]',
                    containerStatuses[c]?.toLowerCase() === 'running' ? 'text-emerald-400' : 'text-white/30',
                  )}>
                    ●
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Hide terminated toggle (only shown when containerStatuses provided) */}
        {Object.keys(containerStatuses).length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setHideTerminated(v => !v)}
                className={cn(
                  'h-6 px-2 text-[11px] rounded-md border transition-colors font-medium',
                  hideTerminated
                    ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                    : (isDark ? 'border-white/10 text-white/40 hover:text-white hover:border-white/20' : 'border-black/10 text-black/40 hover:text-black hover:border-black/20'),
                )}
              >
                Running only
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {hideTerminated ? 'Showing running containers only' : 'Show running containers only'}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Search + history */}
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search className={cn('absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none', isDark ? 'text-white/30' : 'text-black/30')} />
          <input
            type="text"
            placeholder={useRegex ? 'Regex filter…' : 'Search logs…'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { commitSearchToHistory(); setHistoryOpen(false); } }}
            onBlur={() => { commitSearchToHistory(); setTimeout(() => setHistoryOpen(false), 150); }}
            onFocus={() => setHistoryOpen(true)}
            className={cn(
              'w-full h-7 border rounded-md pl-8 pr-16 text-xs outline-none transition-colors',
              inputCls,
              regexError && 'border-red-500/50',
            )}
          />
          {/* Regex error indicator */}
          {regexError && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="absolute right-8 top-1/2 -translate-y-1/2">
                  <AlertTriangle className="h-3 w-3 text-red-400" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-red-400 max-w-xs text-[11px]">
                Invalid regex: {regexError}
              </TooltipContent>
            </Tooltip>
          )}
          {searchQuery && !regexError && (
            <span className={cn('absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums pointer-events-none', isDark ? 'text-white/35' : 'text-black/35')}>
              {filteredLogs.length}
            </span>
          )}

          <FilterHistoryDropdown
            open={historyOpen && history.length > 0}
            onClose={() => setHistoryOpen(false)}
            history={history}
            onSelect={q => { setSearchQuery(q); }}
            onTogglePin={togglePin}
            onRemove={removeFilter}
            onClear={clearHistory}
            isDark={isDark}
          />
        </div>

        {/* Regex toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUseRegex(v => !v)}
              className={cn(
                'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
                useRegex ? activeBtnCls : btnCls,
              )}
            >
              <Regex className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{useRegex ? 'Disable regex' : 'Enable regex filter'}</TooltipContent>
        </Tooltip>

        {/* Inverse filter toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setInverseFilter(v => !v)}
              className={cn(
                'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
                inverseFilter ? 'bg-red-500/20 text-red-400' : btnCls,
              )}
            >
              <FlipHorizontal className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{inverseFilter ? 'Exclude mode: ON' : 'Enable exclude mode'}</TooltipContent>
        </Tooltip>

        {/* Context lines */}
        <Tooltip>
          <TooltipTrigger asChild>
            <select
              value={contextLines}
              onChange={e => setContextLines(Number(e.target.value))}
              className={cn(
                'h-7 border rounded-md px-1.5 text-[11px] outline-none cursor-pointer shrink-0',
                inputCls,
                contextLines > 0 ? (isDark ? 'border-blue-500/40 text-blue-300' : 'border-blue-500/40 text-blue-600') : '',
              )}
              title="Context lines (grep -C)"
            >
              {CONTEXT_OPTIONS.map(n => (
                <option key={n} value={n} style={{ background: isDark ? 'hsl(221,39%,11%)' : 'white' }}>
                  {n === 0 ? 'No ctx' : `±${n} ctx`}
                </option>
              ))}
            </select>
          </TooltipTrigger>
          <TooltipContent side="bottom">Context lines around matches (like grep -C)</TooltipContent>
        </Tooltip>

        {/* History button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setHistoryOpen(v => !v)}
              className={cn(
                'h-7 w-7 flex items-center justify-center rounded-md transition-colors relative',
                historyOpen ? activeBtnCls : btnCls,
              )}
            >
              <History className="h-3.5 w-3.5" />
              {history.filter(e => e.pinned).length > 0 && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Filter history</TooltipContent>
        </Tooltip>

        {/* Tail-lines select */}
        <select
          value={tailLines}
          onChange={e => setTailLines(Number(e.target.value))}
          className={cn('h-7 border rounded-md px-2 text-[11px] outline-none cursor-pointer shrink-0', inputCls)}
        >
          {TAIL_OPTIONS.map(n => (
            <option key={n} value={n} style={{ background: isDark ? 'hsl(221,39%,11%)' : 'white' }}>
              {n} lines
            </option>
          ))}
        </select>

        {/* Right controls */}
        <div className="flex items-center gap-1 ml-auto shrink-0">

          {/* JSON prettify */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setPrettifyJson(v => !v)}
                className={cn(
                  'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
                  prettifyJson ? activeBtnCls : btnCls,
                )}
              >
                <Braces className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {prettifyJson ? 'Show raw JSON' : 'Prettify JSON logs'}
            </TooltipContent>
          </Tooltip>

          {/* Timestamps toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowTimestamps(v => !v)}
                className={cn(
                  'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
                  showTimestamps ? activeBtnCls : btnCls,
                )}
              >
                <Clock className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
            </TooltipContent>
          </Tooltip>

          {/* Wrap toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setWrapLines(v => !v)}
                className={cn(
                  'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
                  wrapLines ? activeBtnCls : btnCls,
                )}
              >
                <AlignJustify className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {wrapLines ? 'Disable line wrap' : 'Wrap long lines'}
            </TooltipContent>
          </Tooltip>

          {/* Follow / pause */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsStreaming(v => !v)}
                className={cn(
                  'h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium transition-colors border',
                  isStreaming
                    ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-600/30'
                    : (isDark ? 'bg-white/5 text-white/60 border-white/15 hover:text-white hover:bg-white/[0.08]' : 'bg-black/5 text-black/60 border-black/15 hover:text-black hover:bg-black/[0.08]'),
                )}
              >
                {isStreaming ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {isStreaming ? 'Follow' : 'Paused'}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isStreaming ? 'Pause auto-scroll & streaming' : 'Resume streaming'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ['k8s', 'pods', namespace, podName, 'logs'] })}
                className={cn('h-7 w-7 flex items-center justify-center rounded-md transition-colors', btnCls)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh logs</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={handleDownload} className={cn('h-7 w-7 flex items-center justify-center rounded-md transition-colors', btnCls)}>
                <Download className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Download as .log file</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleClear}
                className={cn(
                  'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
                  isDark ? 'text-white/30 hover:text-red-400 hover:bg-red-500/10' : 'text-black/30 hover:text-red-500 hover:bg-red-50',
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Clear log view</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Level filter bar ──────────────────────────────────────────────── */}
      <div className={cn('border-b px-4 py-1.5 flex items-center gap-2 flex-wrap', filterBar)}>
        <span className={cn('text-[11px] shrink-0 font-medium tracking-wide', isDark ? 'text-white/50' : 'text-black/50')}>
          {inverseFilter ? 'Exclude:' : 'Filter:'}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {LEVEL_PILLS.map(({ key, label }) => (
            <button
              key={String(key)}
              onClick={() => setSelectedLevel(key)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all',
                getLevelPillClass(key, selectedLevel === key, isDark),
              )}
            >
              {label}
              {key !== null && getLevelCount(displayLogs, key) > 0 && (
                <span className="ml-1 opacity-50 tabular-nums text-[10px]">
                  {getLevelCount(displayLogs, key)}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Active filter indicators */}
        <div className="flex items-center gap-1.5 shrink-0">
          {useRegex && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30">
              regex
            </span>
          )}
          {inverseFilter && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30">
              exclude
            </span>
          )}
          {contextLines > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30">
              ±{contextLines}
            </span>
          )}
        </div>

        <span className={cn('text-[11px] font-medium shrink-0 tabular-nums', isDark ? 'text-white/60' : 'text-black/60')}>
          {filteredLogs.length !== displayLogs.length
            ? `${filteredLogs.length} / ${displayLogs.length} lines`
            : `${displayLogs.length} lines`}
        </span>
      </div>

      {/* ── Log content area ─────────────────────────────────────────────── */}
      <div
        ref={logContainerRef}
        className={cn('font-mono text-xs overflow-auto flex-1', logArea)}
        style={{ minHeight: '320px', maxHeight: '520px' }}
      >
        {isLoading && isLive ? (
          <div className="p-4 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-3 items-center">
                <Skeleton className={cn('h-3.5 w-6 rounded shrink-0', isDark ? 'bg-white/5' : 'bg-black/5')} />
                <Skeleton className={cn('h-3.5 w-20 rounded shrink-0', isDark ? 'bg-white/5' : 'bg-black/5')} />
                <Skeleton className={cn('h-3.5 w-8 rounded shrink-0', isDark ? 'bg-white/5' : 'bg-black/5')} />
                <Skeleton className={cn(
                  'h-3.5 rounded',
                  isDark ? 'bg-white/5' : 'bg-black/5',
                  ['w-2/3', 'w-1/2', 'w-full', 'w-3/4', 'w-4/5', 'w-1/3', 'w-5/6', 'w-2/5'][i % 8]
                )} />
              </div>
            ))}
          </div>
        ) : error && reconnectAttempt >= RECONNECT_MAX_ATTEMPTS ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className={cn('text-sm font-medium', isDark ? 'text-red-400/80' : 'text-red-500')}>Failed to fetch logs</p>
            <p className={cn('text-xs max-w-sm text-center', isDark ? 'text-white/30' : 'text-black/40')}>{error.message}</p>
            <button
              onClick={() => { setReconnectAttempt(0); refetch(); }}
              className={cn('px-3 py-1.5 rounded-md border text-xs transition-colors', isDark ? 'border-white/15 text-white/50 hover:text-white hover:border-white/30' : 'border-black/15 text-black/50 hover:text-black hover:border-black/30')}
            >
              Retry
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className={cn('flex flex-col items-center justify-center h-48 text-sm gap-2', isDark ? 'text-white/30' : 'text-black/30')}>
            {searchQuery || selectedLevel ? (
              <>
                <span className="text-2xl">⚡</span>
                <span>No logs match your filters</span>
                <button
                  onClick={() => { setSearchQuery(''); setSelectedLevel(null); }}
                  className={cn('text-xs underline underline-offset-2 mt-1', isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70')}
                >
                  Clear filters
                </button>
              </>
            ) : !podName || !namespace ? (
              <><span className="text-2xl">📋</span><span>Select a pod to view logs</span></>
            ) : !isConnected ? (
              <><span className="text-2xl">🔌</span><span>Disconnected — reconnect to stream logs</span></>
            ) : (
              <><span className="text-2xl">📄</span><span>No logs yet — they will appear here as they stream in</span></>
            )}
          </div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const log = filteredLogs[virtualRow.index];
              // Find the original index in displayLogs to determine if context row
              const originalIndex = displayLogs.indexOf(log);
              const isContext = contextLines > 0 && searchQuery.trim()
                ? !directMatchIndices.has(originalIndex)
                : false;

              return (
                <div
                  key={virtualRow.index}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <LogRow
                    log={log}
                    index={virtualRow.index}
                    isContext={isContext}
                    showTimestamps={showTimestamps}
                    wrapLines={wrapLines}
                    prettifyJson={prettifyJson}
                    searchRegex={searchRegex}
                    isDark={isDark}
                    onCopy={handleCopyLine}
                  />
                </div>
              );
            })}

            {/* Streaming indicator */}
            {isStreaming && !error && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualizer.getTotalSize()}px)`,
                }}
                className={cn('px-3 py-1.5 flex items-center gap-2 text-[11px] select-none', isDark ? 'text-white/20' : 'text-black/30')}
              >
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Streaming…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className={cn('border-t px-4 py-1.5 text-[11px] flex items-center justify-between', footer, isDark ? 'text-white/50' : 'text-black/50')}>
        <span className="font-mono">
          {isLive
            ? `${namespace}/${podName} · ${selectedContainer}`
            : 'Demo mode'}
        </span>
        <span className="tabular-nums">
          {filteredLogs.length !== displayLogs.length
            ? `${filteredLogs.length} of ${displayLogs.length} lines`
            : `${displayLogs.length} lines`}
          {` · tail ${tailLines}`}
        </span>
      </div>
    </div>
  );
}
