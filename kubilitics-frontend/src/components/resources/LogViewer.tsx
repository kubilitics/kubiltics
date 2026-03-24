import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { parseRawLogs, type LogEntry } from '@/lib/logParser';
import { useK8sPodLogs } from '@/hooks/useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { toast } from '@/components/ui/sonner';

export type { LogEntry };

export interface LogViewerProps {
  logs?: LogEntry[];
  podName?: string;
  namespace?: string;
  containerName?: string;
  containers?: string[];
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

const EMPTY_LOGS: LogEntry[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLevelPillClass(key: string | null, isActive: boolean): string {
  if (!isActive) {
    return 'text-white/35 border border-transparent hover:text-white/60 hover:bg-white/[0.06] hover:border-white/10';
  }
  if (key === null) return 'bg-white/15 text-white border border-white/25';
  const map: Record<string, string> = {
    info: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    warn: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    error: 'bg-red-500/20 text-red-300 border border-red-500/30',
    debug: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  };
  return map[key] ?? 'bg-white/15 text-white border border-white/25';
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

// ─── HighlightedText ──────────────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-amber-400/30 text-amber-200 rounded-sm not-italic">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ─── LogRow ───────────────────────────────────────────────────────────────────

interface LogRowProps {
  log: LogEntry;
  index: number;
  showTimestamps: boolean;
  wrapLines: boolean;
  searchQuery: string;
  onCopy: (log: LogEntry) => void;
}

// PERF Area 4: Memoize log rows — prevents re-render of all rows on filter/scroll
const LogRow = memo(function LogRow({ log, index, showTimestamps, wrapLines, searchQuery, onCopy }: LogRowProps) {
  const levelBadge: Record<string, { label: string; cls: string }> = {
    info:  { label: 'INFO', cls: 'text-blue-400/80' },
    warn:  { label: 'WARN', cls: 'text-amber-400' },
    error: { label: 'ERR!', cls: 'text-red-400' },
    debug: { label: 'DBG ', cls: 'text-purple-400/55' },
  };
  const msgCls: Record<string, string> = {
    info:  'text-[hsl(142_76%_73%/0.85)]',
    warn:  'text-amber-100/85',
    error: 'text-red-300',
    debug: 'text-white/45',
  };
  const rowBg: Record<string, string> = {
    error: 'bg-red-500/[0.06]',
    warn:  'bg-amber-500/[0.04]',
    info:  '',
    debug: '',
  };

  const badge = levelBadge[log.level] ?? levelBadge.info;

  return (
    <div
      className={cn(
        'group flex items-start px-3 py-[1px] hover:bg-white/[0.04] relative',
        rowBg[log.level],
      )}
    >
      {/* Line number */}
      <span className="select-none text-white/15 text-right tabular-nums w-8 shrink-0 mr-2 text-[11px] leading-5 pt-px">
        {index + 1}
      </span>

      {/* Timestamp */}
      {showTimestamps && (
        <span className="shrink-0 mr-3 text-white/25 tabular-nums text-[11px] leading-5 pt-px min-w-[52px]">
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
          msgCls[log.level] ?? 'text-white/80',
          wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap overflow-hidden text-ellipsis',
        )}
      >
        <HighlightedText text={log.message} query={searchQuery} />
      </span>

      {/* Copy on hover */}
      <button
        className="opacity-0 group-hover:opacity-100 shrink-0 ml-1.5 text-white/25 hover:text-white/70 p-0.5 rounded transition-opacity"
        onClick={() => onCopy(log)}
        title="Copy line"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
});

// ─── LogViewer ────────────────────────────────────────────────────────────────

export function LogViewer({
  logs: propLogs,
  podName,
  namespace,
  containerName = 'main',
  containers = [],
  onContainerChange,
  className,
  tailLines: initialTailLines = 50,
}: LogViewerProps) {
  const { isConnected } = useConnectionStatus();
  const queryClient = useQueryClient();

  const [isStreaming, setIsStreaming] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState(containerName);
  const [tailLines, setTailLines] = useState(initialTailLines);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const { data: rawLogs, isLoading, error, refetch, dataUpdatedAt } = useK8sPodLogs(
    namespace || '',
    podName || '',
    selectedContainer,
    {
      enabled: isConnected && !!podName && !!namespace,
      tailLines,
      follow: isStreaming,
    }
  );

  // Parse logs directly from rawLogs — no intermediate state that can get stale
  const parsedLogs = useMemo(() => {
    if (!rawLogs) return EMPTY_LOGS;
    return parseRawLogs(rawLogs);
  // dataUpdatedAt ensures re-parse even when rawLogs string is identical
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLogs, dataUpdatedAt]);

  const isLive = isConnected && !!podName && !!namespace;
  const displayLogs = isLive ? parsedLogs : (propLogs ?? EMPTY_LOGS);

  const filteredLogs = displayLogs.filter(log => {
    if (searchQuery && !log.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedLevel && log.level !== selectedLevel) return false;
    return true;
  });

  // PERF Area 4: Virtualize log rows — only render visible rows + overscan buffer.
  // Without this, 2000 log lines = 2000 DOM elements = scroll jank and high memory.
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
    // Remove cached data entirely then refetch — guarantees fresh logs
    queryClient.removeQueries({ queryKey: ['k8s', 'pods', namespace, podName, 'logs'] });
    queryClient.invalidateQueries({ queryKey: ['k8s', 'pods', namespace, podName, 'logs'] });
  }, [queryClient, namespace, podName]);

  const handleCopyLine = useCallback((log: LogEntry) => {
    navigator.clipboard.writeText(
      `${log.timestamp} [${log.level.toUpperCase()}] ${log.message}`
    );
    toast.success('Line copied');
  }, []);

  return (
    <div className={cn('flex flex-col rounded-xl overflow-hidden border border-white/10', className)}>

      {/* ── Primary toolbar ─────────────────────────────────────────────────── */}
      <div className="bg-[hsl(221_39%_13%)] border-b border-white/10 px-4 py-2 flex flex-wrap items-center gap-2">

        {/* Connection badge */}
        {isLive ? (
          <Badge className="gap-1.5 text-[11px] bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/20 font-medium shrink-0 h-6">
            <Wifi className="h-2.5 w-2.5" /> Live
          </Badge>
        ) : (
          <Badge className="gap-1.5 text-[11px] bg-white/5 text-white/40 border border-white/15 hover:bg-white/5 font-medium shrink-0 h-6">
            <WifiOff className="h-2.5 w-2.5" />
            {!podName || !namespace ? 'No pod' : 'Offline'}
          </Badge>
        )}

        {/* Container selector pills (when multiple) */}
        {containers.length > 1 && (
          <div className="flex items-center gap-0.5 rounded-md border border-white/10 bg-white/5 p-0.5">
            {containers.map(c => (
              <button
                key={c}
                onClick={() => { setSelectedContainer(c); onContainerChange?.(c); }}
                className={cn(
                  'h-6 px-2.5 text-[11px] font-medium rounded-sm transition-all',
                  selectedContainer === c
                    ? 'bg-white/15 text-white'
                    : 'text-white/40 hover:text-white hover:bg-white/[0.08]',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30 pointer-events-none" />
          <input
            type="text"
            placeholder="Search logs…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full h-7 bg-white/5 border border-white/10 rounded-md pl-8 pr-8 text-xs text-white/80 placeholder-white/25 outline-none focus:border-white/25 transition-colors"
          />
          {searchQuery && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/35 tabular-nums pointer-events-none">
              {filteredLogs.length}
            </span>
          )}
        </div>

        {/* Tail-lines select */}
        <select
          value={tailLines}
          onChange={e => setTailLines(Number(e.target.value))}
          className="h-7 bg-white/5 border border-white/10 rounded-md px-2 text-[11px] text-white/55 outline-none focus:border-white/25 cursor-pointer shrink-0"
        >
          {TAIL_OPTIONS.map(n => (
            <option key={n} value={n} style={{ background: 'hsl(221,39%,11%)' }}>
              {n} lines
            </option>
          ))}
        </select>

        {/* Right controls */}
        <div className="flex items-center gap-1 ml-auto shrink-0">

          {/* Timestamps toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowTimestamps(v => !v)}
                className={cn(
                  'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
                  showTimestamps
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/15',
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
                  wrapLines
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/15',
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
                  'h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium transition-colors',
                  isStreaming
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30'
                    : 'bg-white/5 text-white/60 border border-white/15 hover:text-white hover:bg-white/[0.08]',
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
                className="h-7 w-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/15 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh logs</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleDownload}
                className="h-7 w-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/15 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Download as .log file</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleClear}
                className="h-7 w-7 flex items-center justify-center rounded-md text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Clear log view</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Level filter bar ─────────────────────────────────────────────────── */}
      <div className="bg-[hsl(221_39%_11%)] border-b border-white/[0.06] px-4 py-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-white/50 shrink-0 font-medium tracking-wide">Filter:</span>
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {LEVEL_PILLS.map(({ key, label }) => (
            <button
              key={String(key)}
              onClick={() => setSelectedLevel(key)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all',
                getLevelPillClass(key, selectedLevel === key),
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
        <span className="text-[11px] text-white/60 font-medium shrink-0 tabular-nums">
          {filteredLogs.length !== displayLogs.length
            ? `${filteredLogs.length} / ${displayLogs.length} lines`
            : `${displayLogs.length} lines`}
        </span>
      </div>

      {/* ── Log content area ──────────────────────────────────────────────────── */}
      <div
        ref={logContainerRef}
        className="bg-[hsl(221_39%_9%)] font-mono text-xs overflow-auto flex-1"
        style={{ minHeight: '320px', maxHeight: '520px' }}
      >
        {isLoading && isLive ? (
          /* Loading skeletons */
          <div className="p-4 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-3 items-center">
                <Skeleton className="h-3.5 w-6 bg-white/5 rounded shrink-0" />
                <Skeleton className="h-3.5 w-20 bg-white/5 rounded shrink-0" />
                <Skeleton className="h-3.5 w-8 bg-white/5 rounded shrink-0" />
                <Skeleton className={cn(
                  'h-3.5 bg-white/5 rounded',
                  ['w-2/3', 'w-1/2', 'w-full', 'w-3/4', 'w-4/5', 'w-1/3', 'w-5/6', 'w-2/5'][i % 8]
                )} />
              </div>
            ))}
          </div>
        ) : error ? (
          /* Error state */
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-red-400/80 text-sm font-medium">Failed to fetch logs</p>
            <p className="text-white/30 text-xs max-w-sm text-center">{error.message}</p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['k8s', 'pods', namespace, podName, 'logs'] })}
              className="px-3 py-1.5 rounded-md border border-white/15 text-white/50 text-xs hover:text-white hover:border-white/30 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-48 text-white/30 text-sm gap-2">
            {searchQuery || selectedLevel ? (
              <>
                <span className="text-2xl">⚡</span>
                <span>No logs match your filters</span>
                <button
                  onClick={() => { setSearchQuery(''); setSelectedLevel(null); }}
                  className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2 mt-1"
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
          /* PERF Area 4: Virtualized log rows — only visible rows exist in DOM */
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const log = filteredLogs[virtualRow.index];
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
                    showTimestamps={showTimestamps}
                    wrapLines={wrapLines}
                    searchQuery={searchQuery}
                    onCopy={handleCopyLine}
                  />
                </div>
              );
            })}

            {/* Streaming indicator — positioned after all virtual rows */}
            {isStreaming && !error && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualizer.getTotalSize()}px)`,
                }}
                className="px-3 py-1.5 flex items-center gap-2 text-white/20 text-[11px] select-none"
              >
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Streaming…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <div className="bg-[hsl(221_39%_13%)] border-t border-white/[0.06] px-4 py-1.5 text-[11px] text-white/50 flex items-center justify-between">
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
