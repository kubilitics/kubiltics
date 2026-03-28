/**
 * MultiPodLogViewer — stern-like multi-pod log streaming.
 *
 * Streams logs from multiple pods simultaneously, merges them into a unified
 * color-coded timeline with pod-name prefixes. Supports search, level filters,
 * JSON prettification, auto-scroll, pause/resume, and pod selection.
 */
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  Pause,
  Play,
  Copy,
  Download,
  Trash2,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  AlignJustify,
  Regex,
  Braces,
  ChevronDown,
  ChevronRight,
  FlipHorizontal,
  Check,
  Radio,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { parseLogLine, detectLevel, type LogEntry } from '@/lib/logParser';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { getPodLogsUrl } from '@/services/backendApiClient';
import { useTheme } from '@/hooks/useTheme';
import { toast } from '@/components/ui/sonner';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PodTarget {
  name: string;
  namespace: string;
  containers: string[];
}

export interface MultiPodLogViewerProps {
  pods: PodTarget[];
  className?: string;
}

/** Internal log entry with pod/container source info. */
interface MultiLogEntry extends LogEntry {
  podName: string;
  containerName: string;
  /** Index of the pod in the original array — used for color assignment. */
  podIndex: number;
  /** Monotonic counter for stable ordering. */
  seq: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 10_000;

const POD_COLORS = [
  'text-cyan-400',
  'text-amber-400',
  'text-fuchsia-400',
  'text-lime-400',
  'text-rose-400',
  'text-sky-400',
  'text-orange-400',
  'text-violet-400',
  'text-emerald-400',
  'text-pink-400',
] as const;

const POD_COLORS_LIGHT = [
  'text-cyan-700',
  'text-amber-700',
  'text-fuchsia-700',
  'text-lime-700',
  'text-rose-700',
  'text-sky-700',
  'text-orange-700',
  'text-violet-700',
  'text-emerald-700',
  'text-pink-700',
] as const;

const LEVEL_PILLS: Array<{ key: string | null; label: string }> = [
  { key: null, label: 'All' },
  { key: 'info', label: 'Info' },
  { key: 'warn', label: 'Warn' },
  { key: 'error', label: 'Error' },
  { key: 'debug', label: 'Debug' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

function computeLevelCounts(logs: MultiLogEntry[]): Record<string, number> {
  const counts: Record<string, number> = { info: 0, warn: 0, error: 0, debug: 0 };
  for (const l of logs) {
    counts[l.level] = (counts[l.level] ?? 0) + 1;
  }
  return counts;
}

// Short pod name: take last segment after the deployment hash prefix
function shortPodName(name: string): string {
  // e.g. "my-app-7f6d8b9c5d-x2k4j" -> "x2k4j"
  const parts = name.split('-');
  if (parts.length >= 3) return parts.slice(-1)[0];
  return name;
}

// ─── HighlightedText ───────────────────────────────────────────────────────────

function HighlightedText({ text, regex }: { text: string; regex: RegExp | null }) {
  if (!regex) return <>{text}</>;
  const re = new RegExp(regex.source, regex.flags);
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
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

// ─── JsonTree ──────────────────────────────────────────────────────────────────

function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1);

  if (data === null) return <span className="text-slate-400">null</span>;
  if (typeof data === 'boolean') return <span className="text-purple-400">{String(data)}</span>;
  if (typeof data === 'number') return <span className="text-amber-300">{String(data)}</span>;
  if (typeof data === 'string') return <span className="text-emerald-300">&quot;{data}&quot;</span>;

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
                  <span className="text-blue-300">&quot;{k}&quot;</span>
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

// ─── MultiLogRow ───────────────────────────────────────────────────────────────

interface MultiLogRowProps {
  log: MultiLogEntry;
  index: number;
  showTimestamps: boolean;
  wrapLines: boolean;
  prettifyJson: boolean;
  searchRegex: RegExp | null;
  isDark: boolean;
  onCopy: (log: MultiLogEntry) => void;
}

const MultiLogRow = memo(function MultiLogRow({
  log,
  index,
  showTimestamps,
  wrapLines,
  prettifyJson,
  searchRegex,
  isDark,
  onCopy,
}: MultiLogRowProps) {
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
  const altShade = index % 2 === 0
    ? isDark ? 'bg-white/[0.015]' : 'bg-black/[0.015]'
    : '';
  const hoverCls = isDark ? 'hover:bg-white/[0.04]' : 'hover:bg-black/[0.04]';
  const showJson = prettifyJson && log.isJson && log.jsonData !== undefined;

  const podColor = isDark
    ? POD_COLORS[log.podIndex % POD_COLORS.length]
    : POD_COLORS_LIGHT[log.podIndex % POD_COLORS_LIGHT.length];

  const podLabel = `${shortPodName(log.podName)}/${log.containerName}`;

  return (
    <div
      className={cn(
        'group flex items-start px-3 py-px relative transition-colors',
        rowBg[log.level],
        altShade,
        hoverCls,
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

      {/* Pod/container prefix — color-coded */}
      <span className={cn(
        'shrink-0 mr-2 text-[11px] leading-5 pt-px font-mono font-semibold min-w-[80px] max-w-[140px] truncate',
        podColor,
      )} title={`${log.podName}/${log.containerName}`}>
        {podLabel}
      </span>

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

// ─── Pod Checkbox Picker ───────────────────────────────────────────────────────

interface PodPickerProps {
  pods: PodTarget[];
  selectedPods: Set<string>;
  onToggle: (podName: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isDark: boolean;
}

function PodPicker({ pods, selectedPods, onToggle, onSelectAll, onDeselectAll, isDark }: PodPickerProps) {
  const allSelected = pods.length > 0 && pods.every(p => selectedPods.has(p.name));

  return (
    <div className={cn('flex items-center gap-1 flex-wrap')}>
      <button
        onClick={allSelected ? onDeselectAll : onSelectAll}
        className={cn(
          'h-7 px-2.5 text-[11px] font-medium rounded-md border transition-colors shrink-0',
          allSelected
            ? (isDark ? 'bg-white/10 text-white border-white/20' : 'bg-primary/10 text-primary border-primary/20')
            : (isDark ? 'text-white/40 border-white/10 hover:text-white/70' : 'text-black/40 border-black/10 hover:text-black/70'),
        )}
      >
        {allSelected ? 'Deselect All' : 'Select All'}
      </button>
      {pods.map((pod, i) => {
        const active = selectedPods.has(pod.name);
        const color = isDark
          ? POD_COLORS[i % POD_COLORS.length]
          : POD_COLORS_LIGHT[i % POD_COLORS_LIGHT.length];
        return (
          <button
            key={pod.name}
            onClick={() => onToggle(pod.name)}
            className={cn(
              'h-7 px-2 text-[11px] font-mono rounded-md border transition-colors flex items-center gap-1.5 shrink-0',
              active
                ? (isDark ? 'bg-white/10 border-white/20' : 'bg-primary/5 border-primary/20')
                : (isDark ? 'opacity-40 border-white/10 hover:opacity-70' : 'opacity-40 border-black/10 hover:opacity-70'),
              color,
            )}
            title={pod.name}
          >
            <span className={cn(
              'h-3 w-3 rounded-sm border flex items-center justify-center shrink-0',
              active
                ? (isDark ? 'bg-white/20 border-white/30' : 'bg-primary/20 border-primary/30')
                : (isDark ? 'border-white/20' : 'border-black/20'),
            )}>
              {active && <Check className="h-2 w-2" />}
            </span>
            {shortPodName(pod.name)}
          </button>
        );
      })}
    </div>
  );
}

// ─── usePodLogStream ───────────────────────────────────────────────────────────

/**
 * Custom hook that streams logs from a single pod/container via fetch,
 * parsing each new chunk into MultiLogEntry lines.
 */
function usePodLogStream(
  pod: PodTarget,
  podIndex: number,
  container: string,
  enabled: boolean,
  seqRef: React.MutableRefObject<number>,
  onLines: (lines: MultiLogEntry[]) => void,
  tailLines: number,
  follow: boolean,
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = useActiveClusterId();
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled || !clusterId || !isBackendConfigured() || !pod.name || !pod.namespace) return;

    // Abort previous stream
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    activeRef.current = true;

    const url = getPodLogsUrl(backendBaseUrl, clusterId, pod.namespace, pod.name, {
      container,
      tail: tailLines,
      follow,
    });

    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (activeRef.current) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep incomplete last line in buffer
          buffer = lines.pop() ?? '';

          if (lines.length > 0) {
            const entries: MultiLogEntry[] = [];
            for (const line of lines) {
              if (!line.trim()) continue;
              const parsed = parseLogLine(line);
              entries.push({
                ...parsed,
                podName: pod.name,
                containerName: container,
                podIndex,
                seq: seqRef.current++,
              });
            }
            if (entries.length > 0) {
              onLines(entries);
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim()) {
          const parsed = parseLogLine(buffer);
          onLines([{
            ...parsed,
            podName: pod.name,
            containerName: container,
            podIndex,
            seq: seqRef.current++,
          }]);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Silently handle stream errors — pod may have terminated
      }
    })();

    return () => {
      activeRef.current = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clusterId, pod.name, pod.namespace, container, tailLines, follow]);
}

// ─── MultiPodLogViewer ─────────────────────────────────────────────────────────

export function MultiPodLogViewer({ pods, className }: MultiPodLogViewerProps) {
  const { isConnected } = useConnectionStatus();
  const { isDark } = useTheme();

  // ── State ─────────────────────────────────────────────────────────────────
  const [allLogs, setAllLogs] = useState<MultiLogEntry[]>([]);
  const [selectedPods, setSelectedPods] = useState<Set<string>>(() => new Set(pods.map(p => p.name)));
  const [isStreaming, setIsStreaming] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [inverseFilter, setInverseFilter] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);
  const [prettifyJson, setPrettifyJson] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [tailLines] = useState(500);

  const seqRef = useRef(0);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(false);
  const pendingLinesRef = useRef<MultiLogEntry[]>([]);

  // Sync selectedPods when pods array changes
  useEffect(() => {
    setSelectedPods(new Set(pods.map(p => p.name)));
  }, [pods]);

  // Track pause state
  useEffect(() => {
    isPausedRef.current = !isStreaming;
  }, [isStreaming]);

  // ── Append handler (batched) ──────────────────────────────────────────────
  const appendLines = useCallback((lines: MultiLogEntry[]) => {
    if (isPausedRef.current) {
      pendingLinesRef.current.push(...lines);
      return;
    }
    setAllLogs(prev => {
      const next = [...prev, ...lines];
      if (next.length > MAX_LOG_LINES) {
        return next.slice(next.length - MAX_LOG_LINES);
      }
      return next;
    });
  }, []);

  // Resume: flush pending lines
  useEffect(() => {
    if (isStreaming && pendingLinesRef.current.length > 0) {
      const pending = pendingLinesRef.current;
      pendingLinesRef.current = [];
      setAllLogs(prev => {
        const next = [...prev, ...pending];
        if (next.length > MAX_LOG_LINES) {
          return next.slice(next.length - MAX_LOG_LINES);
        }
        return next;
      });
    }
  }, [isStreaming]);

  // ── Pod streams ───────────────────────────────────────────────────────────
  // We need a component per stream to manage individual hooks.
  // Render invisible stream-manager components for each selected pod/container.

  // ── Regex compilation ─────────────────────────────────────────────────────
  const [regexError, setRegexError] = useState<string | null>(null);
  const searchRegex = useMemo(() => {
    if (!searchQuery.trim()) { setRegexError(null); return null; }
    if (regexMode) {
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
  }, [searchQuery, regexMode]);

  // ── Filter logs ───────────────────────────────────────────────────────────
  const filteredLogs = useMemo(() => {
    return allLogs.filter(log => {
      // Pod filter
      if (!selectedPods.has(log.podName)) return false;

      // Level filter
      if (selectedLevel && log.level !== selectedLevel) return false;

      // Text search
      if (searchQuery.trim() && searchRegex && !regexError) {
        searchRegex.lastIndex = 0;
        const matches = searchRegex.test(log.message);
        searchRegex.lastIndex = 0;
        if (inverseFilter ? matches : !matches) return false;
      } else if (searchQuery.trim() && regexError) {
        return false;
      }

      return true;
    });
  }, [allLogs, selectedPods, selectedLevel, searchQuery, searchRegex, regexError, inverseFilter]);

  const hasJsonLogs = useMemo(() => filteredLogs.some(l => l.isJson), [filteredLogs]);
  const levelCounts = useMemo(() => computeLevelCounts(allLogs), [allLogs]);

  const activePodCount = useMemo(() => {
    const activePods = new Set<string>();
    for (const log of allLogs) {
      if (selectedPods.has(log.podName)) activePods.add(log.podName);
    }
    return activePods.size;
  }, [allLogs, selectedPods]);

  // ── Virtualizer ───────────────────────────────────────────────────────────
  const LOG_ROW_HEIGHT = 20;
  const virtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => logContainerRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: 30,
  });

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && filteredLogs.length > 0) {
      virtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' });
    }
  }, [filteredLogs.length, autoScroll, virtualizer]);

  // Detect manual scroll-up to disable auto-scroll
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (!atBottom && autoScroll) {
        setAutoScroll(false);
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [autoScroll]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setAllLogs([]);
    seqRef.current = 0;
  }, []);

  const handleCopyLine = useCallback((log: MultiLogEntry) => {
    navigator.clipboard.writeText(
      `[${log.podName}/${log.containerName}] ${log.timestamp} [${log.level.toUpperCase()}] ${log.message}`
    );
    toast.success('Line copied');
  }, []);

  const handleCopyAll = useCallback(() => {
    const content = filteredLogs
      .map(l => `[${l.podName}/${l.containerName}] ${l.timestamp} [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(content);
    toast.success(`Copied ${filteredLogs.length} log lines`);
  }, [filteredLogs]);

  const handleDownload = useCallback(() => {
    const content = filteredLogs
      .map(l => `[${l.podName}/${l.containerName}] ${l.timestamp} [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `multi-pod-logs-${new Date().toISOString().slice(0, 19)}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, [filteredLogs]);

  const handleTogglePod = useCallback((podName: string) => {
    setSelectedPods(prev => {
      const next = new Set(prev);
      if (next.has(podName)) next.delete(podName);
      else next.add(podName);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedPods(new Set(pods.map(p => p.name)));
  }, [pods]);

  const handleDeselectAll = useCallback(() => {
    setSelectedPods(new Set());
  }, []);

  // ── Theme classes ─────────────────────────────────────────────────────────
  const toolbar   = isDark ? 'bg-[hsl(221_39%_13%)] border-white/10'  : 'bg-slate-100 border-slate-200';
  const filterBar = isDark ? 'bg-[hsl(221_39%_11%)] border-white/[0.06]' : 'bg-slate-50 border-slate-200/60';
  const logArea   = isDark ? 'bg-[hsl(221_39%_9%)]'  : 'bg-white';
  const footer    = isDark ? 'bg-[hsl(221_39%_13%)] border-white/[0.06]' : 'bg-slate-100 border-slate-200/60';
  const inputCls  = isDark
    ? 'bg-white/5 border-white/10 text-white/80 placeholder-white/25 focus:border-white/25'
    : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400 focus:border-primary/50';
  const btnCls    = isDark
    ? 'text-white/60 hover:text-white hover:bg-white/15'
    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200';
  const activeBtnCls = isDark ? 'bg-white/10 text-white' : 'bg-primary/10 text-primary border border-primary/20';

  return (
    <div className={cn('flex flex-col rounded-xl overflow-hidden border', isDark ? 'border-white/10' : 'border-slate-200', className)}>

      {/* ── Pod selector bar ────────────────────────────────────────────── */}
      <div className={cn('border-b px-3 py-2', filterBar)}>
        <div className="flex items-center gap-2 mb-1.5">
          <Radio className={cn('h-3.5 w-3.5 shrink-0', isDark ? 'text-white/40' : 'text-black/40')} />
          <span className={cn('text-[11px] font-medium tracking-wide shrink-0', isDark ? 'text-white/50' : 'text-black/50')}>
            Pod Sources
          </span>
          <Badge className={cn('text-[10px] h-5 px-1.5', isDark ? 'bg-white/10 text-white/60 border-white/15' : 'bg-black/5 text-black/50 border-black/10')}>
            {selectedPods.size}/{pods.length} pods
          </Badge>
        </div>
        <PodPicker
          pods={pods}
          selectedPods={selectedPods}
          onToggle={handleTogglePod}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          isDark={isDark}
        />
      </div>

      {/* ── Primary toolbar ─────────────────────────────────────────────── */}
      <div className={cn('border-b px-3 py-2 flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]', toolbar)}>

        {/* Status badge */}
        {isConnected && isStreaming ? (
          <Badge className={cn("gap-1.5 text-xs border font-medium shrink-0 h-8 px-2.5", isDark ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-300")}>
            <Wifi className="h-3.5 w-3.5" /> Streaming
          </Badge>
        ) : isConnected && !isStreaming ? (
          <Badge className={cn('gap-1.5 text-xs border font-medium shrink-0 h-8 px-2.5', isDark ? 'bg-amber-600/20 text-amber-400 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-300')}>
            <Pause className="h-3.5 w-3.5" /> Paused
          </Badge>
        ) : (
          <Badge className={cn('gap-1.5 text-xs border font-medium shrink-0 h-8 px-2.5', isDark ? 'bg-white/5 text-white/40 border-white/15' : 'bg-slate-50 text-slate-500 border-slate-300')}>
            <WifiOff className="h-3.5 w-3.5" /> Offline
          </Badge>
        )}

        {/* Search */}
        <div className="relative shrink-0 w-72">
          <Search className={cn('absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none', isDark ? 'text-white/30' : 'text-slate-400')} />
          <input
            type="text"
            placeholder={regexMode ? 'Regex filter...' : 'Search logs...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={cn('w-full h-8 border rounded-lg pl-9 pr-10 text-sm outline-none transition-colors', inputCls, regexError && 'border-red-500/50')}
          />
          {searchQuery && !regexError && (
            <span className={cn('absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums pointer-events-none', isDark ? 'text-white/35' : 'text-slate-400')}>{filteredLogs.length}</span>
          )}
        </div>

        {/* Search modifiers */}
        <button onClick={() => setRegexMode(v => !v)} className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-colors', regexMode ? activeBtnCls : btnCls)} title="Regex"><Regex className="h-4 w-4" /> Regex</button>
        <button onClick={() => setInverseFilter(v => !v)} className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-colors', inverseFilter ? (isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-50 text-red-600 border border-red-200') : btnCls)} title="Exclude"><FlipHorizontal className="h-4 w-4" /> Exclude</button>

        <div className={cn('w-px h-5 mx-0.5 shrink-0', isDark ? 'bg-white/10' : 'bg-slate-300')} />

        {/* Display toggles */}
        <button onClick={() => setPrettifyJson(v => !v)} disabled={!hasJsonLogs} className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-colors', !hasJsonLogs ? 'opacity-30 cursor-not-allowed' : prettifyJson ? activeBtnCls : btnCls)} title={hasJsonLogs ? 'Prettify JSON logs' : 'No JSON logs detected'}><Braces className="h-4 w-4" /> JSON</button>
        <button onClick={() => setShowTimestamps(v => !v)} className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-colors', showTimestamps ? activeBtnCls : btnCls)} title="Timestamps"><Clock className="h-4 w-4" /> Time</button>
        <button onClick={() => setWrapLines(v => !v)} className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-colors', wrapLines ? activeBtnCls : btnCls)} title="Wrap"><AlignJustify className="h-4 w-4" /> Wrap</button>

        <div className={cn('w-px h-5 mx-0.5 shrink-0', isDark ? 'bg-white/10' : 'bg-slate-300')} />

        {/* Streaming + actions */}
        <button onClick={() => setIsStreaming(v => !v)} className={cn('h-8 flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold shrink-0 transition-colors border', isStreaming ? (isDark ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-300') : (isDark ? 'bg-white/5 text-white/60 border-white/15 hover:text-white' : 'bg-white text-slate-600 border-slate-300 hover:text-slate-900'))} title={isStreaming ? 'Pause' : 'Resume'}>
          {isStreaming ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {isStreaming ? 'Follow' : 'Paused'}
        </button>

        <button
          onClick={() => { setAutoScroll(true); if (filteredLogs.length > 0) virtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' }); }}
          className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-colors', autoScroll ? activeBtnCls : btnCls)}
          title="Auto-scroll to bottom"
        >
          <ChevronDown className="h-4 w-4" /> Tail
        </button>

        <button onClick={handleCopyAll} className={cn('h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 transition-colors', btnCls)} title="Copy filtered logs"><Copy className="h-4 w-4" /> Copy</button>
        <button onClick={handleDownload} className={cn('h-8 w-8 flex items-center justify-center rounded-lg shrink-0 transition-colors', btnCls)} title="Download"><Download className="h-4 w-4" /></button>
        <button onClick={handleClear} className={cn('h-8 w-8 flex items-center justify-center rounded-lg shrink-0 transition-colors', isDark ? 'text-white/40 hover:text-red-400 hover:bg-red-500/10' : 'text-slate-400 hover:text-red-600 hover:bg-red-50')} title="Clear"><Trash2 className="h-4 w-4" /></button>
      </div>

      {/* ── Level filter bar ────────────────────────────────────────────── */}
      <div className={cn('border-b px-4 py-1.5 flex items-center gap-2 flex-wrap', filterBar)}>
        <span className={cn('text-[11px] shrink-0 font-medium tracking-wide', isDark ? 'text-white/50' : 'text-black/50')}>
          {inverseFilter ? 'Exclude:' : 'Filter:'}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap flex-1">
          {LEVEL_PILLS.map(({ key, label }) => (
            <button
              key={String(key)}
              onClick={() => setSelectedLevel(prev => prev === key ? null : key)}
              className={cn(
                'px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all',
                getLevelPillClass(key, selectedLevel === key, isDark),
              )}
            >
              {label}
              {key !== null && (levelCounts[key] ?? 0) > 0 && (
                <span className="ml-1 opacity-50 tabular-nums text-[10px]">
                  {levelCounts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        <span className={cn('text-[11px] font-medium shrink-0 tabular-nums', isDark ? 'text-white/60' : 'text-black/60')}>
          {filteredLogs.length !== allLogs.length
            ? `${filteredLogs.length} / ${allLogs.length} lines`
            : `${allLogs.length} lines`}
          {' '}
          <span className={isDark ? 'text-white/30' : 'text-black/30'}>|</span>
          {' '}
          {activePodCount} pod{activePodCount !== 1 ? 's' : ''} streaming
        </span>
      </div>

      {/* ── Log content area ────────────────────────────────────────────── */}
      <div
        ref={logContainerRef}
        className={cn('font-mono text-xs overflow-auto flex-1', logArea)}
        style={{ minHeight: '360px', maxHeight: '600px' }}
      >
        {pods.length === 0 ? (
          <div className={cn('flex flex-col items-center justify-center h-48 text-sm gap-2', isDark ? 'text-white/30' : 'text-black/30')}>
            <span className="text-2xl">&#128203;</span>
            <span>No pods selected for streaming</span>
          </div>
        ) : filteredLogs.length === 0 && allLogs.length === 0 ? (
          <div className={cn('flex flex-col items-center justify-center h-48 text-sm gap-2', isDark ? 'text-white/30' : 'text-black/30')}>
            <span className="text-2xl">&#9889;</span>
            <span>Waiting for log data from {selectedPods.size} pod{selectedPods.size !== 1 ? 's' : ''}...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className={cn('flex flex-col items-center justify-center h-48 text-sm gap-2', isDark ? 'text-white/30' : 'text-black/30')}>
            <span className="text-2xl">&#9889;</span>
            <span>No logs match your filters</span>
            <button
              onClick={() => { setSearchQuery(''); setSelectedLevel(null); }}
              className={cn('text-xs underline underline-offset-2 mt-1', isDark ? 'text-white/40 hover:text-white/70' : 'text-black/40 hover:text-black/70')}
            >
              Clear filters
            </button>
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
              return (
                <div
                  key={log.seq}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <MultiLogRow
                    log={log}
                    index={virtualRow.index}
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
          </div>
        )}
      </div>

      {/* ── Footer status bar ───────────────────────────────────────────── */}
      <div className={cn('border-t px-3 py-1.5 flex items-center justify-between text-[11px]', footer)}>
        <span className={isDark ? 'text-white/40' : 'text-black/40'}>
          Multi-Pod Log Viewer — stern-like streaming
        </span>
        {!autoScroll && (
          <button
            onClick={() => { setAutoScroll(true); if (filteredLogs.length > 0) virtualizer.scrollToIndex(filteredLogs.length - 1, { align: 'end' }); }}
            className={cn('px-2 py-0.5 rounded text-[10px] font-medium border transition-colors', isDark ? 'text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20' : 'text-amber-600 border-amber-500/30 bg-amber-50 hover:bg-amber-100')}
          >
            Scroll stopped — click to resume
          </button>
        )}
        <span className={isDark ? 'text-white/40' : 'text-black/40'}>
          {allLogs.length >= MAX_LOG_LINES && (
            <span className={isDark ? 'text-amber-400/60' : 'text-amber-600/60'}>Buffer full ({MAX_LOG_LINES.toLocaleString()} cap) | </span>
          )}
          {allLogs.length.toLocaleString()} total lines
        </span>
      </div>

      {/* ── Invisible stream managers ───────────────────────────────────── */}
      {pods.map((pod, i) => (
        selectedPods.has(pod.name) && pod.containers.map(container => (
          <PodStreamManager
            key={`${pod.name}/${container}`}
            pod={pod}
            podIndex={i}
            container={container}
            enabled={isStreaming && isConnected}
            seqRef={seqRef}
            onLines={appendLines}
            tailLines={tailLines}
            follow={isStreaming}
          />
        ))
      ))}
    </div>
  );
}

// ─── PodStreamManager ──────────────────────────────────────────────────────────

/**
 * Invisible component that manages a single pod/container log stream.
 * Uses the usePodLogStream hook.
 */
function PodStreamManager({
  pod,
  podIndex,
  container,
  enabled,
  seqRef,
  onLines,
  tailLines,
  follow,
}: {
  pod: PodTarget;
  podIndex: number;
  container: string;
  enabled: boolean;
  seqRef: React.MutableRefObject<number>;
  onLines: (lines: MultiLogEntry[]) => void;
  tailLines: number;
  follow: boolean;
}) {
  usePodLogStream(pod, podIndex, container, enabled, seqRef, onLines, tailLines, follow);
  return null;
}

export type { MultiLogEntry };
