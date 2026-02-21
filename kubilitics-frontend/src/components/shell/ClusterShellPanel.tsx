import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Terminal as TerminalIcon, X, GripHorizontal, Maximize2, Minimize2, Trash2, Copy, RefreshCw, AlertCircle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getKCLIComplete, getKCLIShellStreamUrl, getKCLITUIState, getKubectlShellStreamUrl, getShellComplete, isBackendCircuitOpen, type ShellStatusResult } from '@/services/backendApiClient';
import { useNavigate } from 'react-router-dom';
import { applyCompletionToLine, updateLineBuffer } from './completionEngine';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { isTauri } from '@/lib/tauri';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const MIN_HEIGHT_PX = 160;
const MAX_HEIGHT_PERCENT = 85;
const INITIAL_HEIGHT_PX = 320;
const MODE_STORAGE_KEY = 'kubilitics-shell-engine-mode';
const KCLI_STREAM_MODE_STORAGE_KEY = 'kubilitics-shell-kcli-stream-mode';
const SHELL_STATE_SYNC_INTERVAL_MS = 2000;
const SHELL_STATE_SYNC_BACKOFF_MS = 15000; // when backend unreachable, poll less often to avoid log spam
const SHELL_STATE_SYNC_BACKOFF_MAX_MS = 60000;

export interface ClusterShellPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterId: string | null;
  clusterName: string;
  backendBaseUrl: string;
}

function base64Encode(str: string): string {
  try {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_m, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    ));
  } catch {
    return btoa(str);
  }
}

function base64DecodeToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/** Map a keyboard event to the byte sequence to send to the PTY (so kcli/shell receives it). */
function keyEventToStdin(e: React.KeyboardEvent): string | null {
  const key = e.key;
  if (key === 'Enter') return '\r';
  if (key === 'Tab') return '\t';
  if (key === 'Backspace') return '\x7f';
  if (key === 'Escape') return '\x1b';
  if (key === 'ArrowUp') return '\x1b[A';
  if (key === 'ArrowDown') return '\x1b[B';
  if (key === 'ArrowRight') return '\x1b[C';
  if (key === 'ArrowLeft') return '\x1b[D';
  if (e.ctrlKey && key.length === 1) {
    const c = key.toUpperCase().charCodeAt(0);
    if (c >= 64 && c <= 95) return String.fromCharCode(c - 64); // Ctrl+A -> \x01, etc.
  }
  if (e.altKey && key.length === 1) return '\x1b' + key; // Alt+key
  if (key.length === 1 && !e.ctrlKey && !e.metaKey) return key; // printable
  return null;
}

export function ClusterShellPanel({
  open,
  onOpenChange,
  clusterId,
  clusterName,
  backendBaseUrl,
}: ClusterShellPanelProps) {
  const navigate = useNavigate();
  const activeNamespace = useClusterStore((s) => s.activeNamespace);
  const setActiveNamespace = useClusterStore((s) => s.setActiveNamespace);
  const setActiveCluster = useClusterStore((s) => s.setActiveCluster);
  const setClusters = useClusterStore((s) => s.setClusters);
  const [heightPx, setHeightPx] = useState(INITIAL_HEIGHT_PX);
  const [dragging, setDragging] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shellStatus, setShellStatus] = useState<ShellStatusResult | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [engine, setEngine] = useState<'kcli' | 'kubectl'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(MODE_STORAGE_KEY) : null;
    return saved === 'kubectl' ? 'kubectl' : 'kcli';
  });
  const [kcliStreamMode, setKcliStreamMode] = useState<'ui' | 'shell'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(KCLI_STREAM_MODE_STORAGE_KEY) : null;
    // Default to 'shell' for reliable kcli command output; 'ui' (Bubble Tea TUI) is opt-in
    return saved === 'ui' ? 'ui' : 'shell';
  });
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [kcliSidecarAvailable, setKcliSidecarAvailable] = useState<boolean | null>(null);
  const circuitOpen = useBackendCircuitOpen();

  // P2-7: In Tauri, kcli may be bundled as sidecar; backend PATH check can be false. Treat as available if sidecar exists.
  useEffect(() => {
    if (!open || !isTauri()) return;
    let cancelled = false;
    invoke<boolean>('is_kcli_sidecar_available')
      .then((ok) => {
        if (!cancelled) setKcliSidecarAvailable(ok);
      })
      .catch(() => {
        if (!cancelled) setKcliSidecarAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsSessionRef = useRef(0);
  const pendingOutputRef = useRef<string[]>([]);
  const lineBufferRef = useRef('');
  const completionPendingRef = useRef(false);
  const requestServerCompletionRef = useRef<() => Promise<boolean>>(async () => false);
  const trackLocalLineBufferRef = useRef<(data: string) => void>(() => undefined);
  const sendStdinRef = useRef<(data: string) => void>(() => undefined);
  const syncTimerRef = useRef<number | null>(null);
  const syncBackoffRef = useRef({ intervalMs: SHELL_STATE_SYNC_INTERVAL_MS, failures: 0 });
  const syncTimeoutRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_BASE_DELAY_MS = 1000;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(MODE_STORAGE_KEY, engine);
    }
  }, [engine]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(KCLI_STREAM_MODE_STORAGE_KEY, kcliStreamMode);
    }
  }, [kcliStreamMode]);

  const flushPendingOutput = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const pending = pendingOutputRef.current;
    pendingOutputRef.current = [];
    for (const chunk of pending) {
      term.write(base64DecodeToUint8Array(chunk));
    }
  }, []);

  const focusAndFit = useCallback(() => {
    fitAddonRef.current?.fit();
    termRef.current?.focus();
  }, []);

  const sendStdin = useCallback((data: string) => {
    if (!data) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ t: 'stdin', d: base64Encode(data) }));
  }, []);

  const applyShellState = useCallback((next: ShellStatusResult) => {
    setShellStatus(next);
    if (next.namespace && next.namespace !== 'all') {
      setActiveNamespace(next.namespace);
    }

    const state = useClusterStore.getState();
    const current = state.activeCluster;
    if (!current || current.id !== next.clusterId || current.context === next.context) {
      return;
    }

    const updatedCluster = { ...current, context: next.context };
    setActiveCluster(updatedCluster);
    const updatedClusters = state.clusters.map((c) =>
      c.id === updatedCluster.id ? updatedCluster : c
    );
    setClusters(updatedClusters);
  }, [setActiveCluster, setActiveNamespace, setClusters]);

  const syncShellState = useCallback(async () => {
    if (!open || !clusterId) return;
    try {
      const status = await getKCLITUIState(backendBaseUrl, clusterId);
      syncBackoffRef.current = { intervalMs: SHELL_STATE_SYNC_INTERVAL_MS, failures: 0 };
      applyShellState(status);
      if (!status.kcliShellModeAllowed && kcliStreamMode === 'shell') {
        setKcliStreamMode('ui');
      }
    } catch {
      const b = syncBackoffRef.current;
      b.failures += 1;
      b.intervalMs = Math.min(
        SHELL_STATE_SYNC_BACKOFF_MAX_MS,
        SHELL_STATE_SYNC_BACKOFF_MS * Math.min(b.failures, 4)
      );
    }
  }, [applyShellState, backendBaseUrl, clusterId, kcliStreamMode, open]);

  const scheduleStateSync = useCallback((delayMs = 120) => {
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void syncShellState();
    }, delayMs);
  }, [syncShellState]);

  const applyCompletion = useCallback((completion: string): boolean => {
    const line = lineBufferRef.current;
    const result = applyCompletionToLine(line, completion);
    if (!result) return false;
    sendStdin(result.payload);
    lineBufferRef.current = result.nextLine;
    return true;
  }, [sendStdin]);

  const requestServerCompletion = useCallback(async (): Promise<boolean> => {
    if (!clusterId || !connected) return false;
    if (completionPendingRef.current) return true;
    if (engine === 'kcli' && kcliStreamMode !== 'shell') return false;
    const line = lineBufferRef.current;
    if (!line.trim()) return false;

    completionPendingRef.current = true;
    try {
      const result = engine === 'kubectl'
        ? await getShellComplete(backendBaseUrl, clusterId, line)
        : await getKCLIComplete(backendBaseUrl, clusterId, line);
      const completions = (result.completions || []).map((c) => c.trim()).filter(Boolean);
      if (completions.length === 0) return false;

      if (completions.length === 1) {
        return applyCompletion(completions[0]);
      }

      const term = termRef.current;
      if (term) {
        term.write(`\r\n${completions.join('    ')}\r\n${lineBufferRef.current}`);
      }
      return true;
    } catch {
      return false;
    } finally {
      completionPendingRef.current = false;
    }
  }, [applyCompletion, backendBaseUrl, clusterId, connected, engine, kcliStreamMode]);

  const trackLocalLineBuffer = useCallback((data: string) => {
    lineBufferRef.current = updateLineBuffer(lineBufferRef.current, data);
  }, []);

  useEffect(() => {
    requestServerCompletionRef.current = requestServerCompletion;
  }, [requestServerCompletion]);

  useEffect(() => {
    trackLocalLineBufferRef.current = trackLocalLineBuffer;
  }, [trackLocalLineBuffer]);

  useEffect(() => {
    sendStdinRef.current = sendStdin;
  }, [sendStdin]);

  // Initialize terminal once.
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Roboto Mono', Monaco, 'Courier New', monospace",
      theme: {
        background: 'hsl(221, 39%, 8%)',
        foreground: 'hsl(142, 76%, 73%)',
        cursor: 'hsl(142, 76%, 73%)',
        selectionBackground: 'rgba(255, 255, 255, 0.15)',
        black: '#1e1e1e',
        red: '#f44336',
        green: '#4caf50',
        yellow: '#ffeb3b',
        blue: '#2196f3',
        magenta: '#9c27b0',
        cyan: '#00bcd4',
        white: '#ffffff',
        brightBlack: '#666666',
        brightRed: '#f44336',
        brightGreen: '#4caf50',
        brightYellow: '#ffeb3b',
        brightBlue: '#2196f3',
        brightMagenta: '#9c27b0',
        brightCyan: '#00bcd4',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    focusAndFit();

    term.onData((data) => {
      if (data === '\t') {
        void (async () => {
          const handled = await requestServerCompletionRef.current();
          if (!handled) {
            trackLocalLineBufferRef.current(data);
            sendStdinRef.current(data);
          }
        })();
        return;
      }
      trackLocalLineBufferRef.current(data);
      sendStdinRef.current(data);
      if (data.includes('\r') || data.includes('\n')) {
        scheduleStateSync(90);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: 'resize', r: { cols, rows } }));
      }
    });

    flushPendingOutput();

    const t1 = setTimeout(() => term.focus(), 50);
    const t2 = setTimeout(() => term.focus(), 150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      pendingOutputRef.current = [];
    };
  }, [flushPendingOutput, focusAndFit, scheduleStateSync]);

  // Resize observer for terminal container layout changes.
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      focusAndFit();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [open, focusAndFit]);

  // WS connection lifecycle.
  useEffect(() => {
    if (!open || !clusterId) {
      intentionalCloseRef.current = true; // Mark as intentional when panel closes
      wsSessionRef.current += 1;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnecting(false);
      setConnected(false);
      setIsReconnecting(false);
      // Clear reconnect timer if panel is closed
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      return;
    }

    const sessionId = wsSessionRef.current + 1;
    wsSessionRef.current = sessionId;

    // P2-4: Do not open WebSocket when circuit is open; show friendly message instead.
    if (isBackendCircuitOpen()) {
      setConnecting(false);
      setConnected(false);
      setError('Backend unavailable. Use Retry in the banner when the connection is back.');
      return;
    }

    const wsUrl = engine === 'kcli'
      ? getKCLIShellStreamUrl(backendBaseUrl, clusterId, kcliStreamMode, activeNamespace ?? undefined)
      : getKubectlShellStreamUrl(backendBaseUrl, clusterId);

    setConnecting(true);
    setConnected(false);
    setError(null);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      setConnecting(false);
      setConnected(true);
      setIsReconnecting(false);
      setError(null);
      reconnectAttemptRef.current = 0;
      intentionalCloseRef.current = false;

      // Clear any pending reconnect timer
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      const term = termRef.current;
      if (term) {
        term.reset();
        lineBufferRef.current = '';
        focusAndFit();
        flushPendingOutput();
        const { cols, rows } = term;
        ws.send(JSON.stringify({ t: 'resize', r: { cols, rows } }));
        setTimeout(() => term.focus(), 50);
      }
    };

    ws.onmessage = (event) => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data) as { t?: string; d?: string };
        if ((msg.t === 'stdout' || msg.t === 'stderr') && msg.d) {
          if (termRef.current) {
            termRef.current.write(base64DecodeToUint8Array(msg.d));
          } else {
            if (pendingOutputRef.current.length >= 1000) {
              pendingOutputRef.current.shift();
            }
            pendingOutputRef.current.push(msg.d);
          }
        } else if (msg.t === 'exit') {
          termRef.current?.write('\r\n[Session exited]\r\n');
          setConnected(false);
          setConnecting(false);
        } else if (msg.t === 'error' && msg.d) {
          // Check if this is a kcli binary not found error
          const errorMsg = msg.d.toLowerCase();
          if (errorMsg.includes('kcli binary not found') || errorMsg.includes('kcli binary resolution failed')) {
            setError('kcli binary not found. Please check backend configuration or contact administrator.');
          } else {
            setError(msg.d);
          }
          termRef.current?.write(`\r\n[Error: ${msg.d}]\r\n`);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      setConnecting(false);
      setConnected(false);
      wsRef.current = null;
      lineBufferRef.current = '';

      // Auto-reconnect logic (similar to useWebSocket.ts)
      if (!intentionalCloseRef.current && open && clusterId) {
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const attempt = reconnectAttemptRef.current + 1;
          const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptRef.current),
            30000
          );

          console.log(`Shell WebSocket disconnected. Attempting to reconnect (${attempt}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms...`);
          setIsReconnecting(true);
          setError(null);

          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectAttemptRef.current = attempt;
            setReconnectNonce((n) => n + 1);
          }, delay);
        } else {
          console.error('Max reconnect attempts reached. Giving up.');
          setIsReconnecting(false);
          setError('Connection lost. Please reopen the shell panel.');
        }
      } else {
        setIsReconnecting(false);
      }
    };

    ws.onerror = (event) => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      setConnecting(false);
      setConnected(false);
      // Enhanced error message for kcli-specific issues
      if (engine === 'kcli') {
        const errorMsg = 'kcli WebSocket connection failed.';
        const detailMsg = shellStatus?.kcliAvailable === false
          ? ' kcli binary is missing. Please install kcli or configure the backend to use the bundled sidecar.'
          : ' This may indicate kcli binary is missing or backend configuration issue.';
        setError(errorMsg + detailMsg);
      } else {
        setError(`${engine.toUpperCase()} WebSocket connection failed.`);
      }
      lineBufferRef.current = '';
    };

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      setIsReconnecting(false);

      if (wsSessionRef.current === sessionId) {
        wsSessionRef.current += 1;
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [open, clusterId, backendBaseUrl, engine, kcliStreamMode, reconnectNonce, circuitOpen, focusAndFit, flushPendingOutput]);

  // Fit on panel layout changes.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => focusAndFit(), 100);
    return () => clearTimeout(t);
  }, [open, heightPx, isMaximized, focusAndFit]);

  useEffect(() => {
    const handleWindowResize = () => focusAndFit();
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [focusAndFit]);

  // Drag to resize logic
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartHeight.current = heightPx;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [heightPx, isMaximized]);

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const deltaY = dragStartY.current - e.clientY;
    const vh = window.innerHeight;
    let next = dragStartHeight.current + deltaY;
    next = Math.max(MIN_HEIGHT_PX, Math.min((MAX_HEIGHT_PERCENT / 100) * vh, next));
    setHeightPx(next);
  }, [dragging]);

  const handleResizePointerUp = useCallback((e: React.PointerEvent) => {
    setDragging(false);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const handleReconnect = useCallback(() => {
    intentionalCloseRef.current = false;
    reconnectAttemptRef.current = 0;
    setIsReconnecting(false);
    setError(null);
    setReconnectNonce((n) => n + 1);
    scheduleStateSync(50);
  }, [scheduleStateSync]);

  useEffect(() => {
    if (!open || !connected) return;
    if (!activeNamespace || activeNamespace === 'all') return;
    if (shellStatus?.namespace === activeNamespace) return;
    // Use kcli ns for kcli shell mode, kubectl for kubectl mode
    if (engine === 'kcli' && kcliStreamMode === 'shell') {
      sendStdin(`kcli ns ${activeNamespace}\r`);
    } else {
      sendStdin(`kubectl config set-context --current --namespace=${activeNamespace}\r`);
    }
    scheduleStateSync(90);
  }, [activeNamespace, connected, engine, kcliStreamMode, open, scheduleStateSync, sendStdin, shellStatus?.namespace]);

  const handleCopySelection = useCallback(() => {
    const sel = termRef.current?.getSelection() ?? '';
    if (sel.trim()) {
      navigator.clipboard.writeText(sel);
    }
  }, []);

  useEffect(() => {
    if (!open || !clusterId) {
      setShellStatus(null);
      return;
    }
    syncBackoffRef.current = { intervalMs: SHELL_STATE_SYNC_INTERVAL_MS, failures: 0 };
    const scheduleNext = () => {
      syncTimeoutRef.current = window.setTimeout(() => {
        syncTimeoutRef.current = null;
        void syncShellState().finally(scheduleNext);
      }, syncBackoffRef.current.intervalMs);
    };
    void syncShellState().finally(scheduleNext);
    return () => {
      if (syncTimeoutRef.current != null) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      if (syncTimerRef.current != null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [clusterId, open, syncShellState]);

  const effectiveNamespace = shellStatus?.namespace || 'default';
  // P2-7: In Tauri, if kcli sidecar is bundled, report as available even when backend PATH check fails.
  // Only show as available if explicitly true from backend OR sidecar check (not if shellStatus is null/undefined)
  const effectiveKcliAvailable =
    shellStatus?.kcliAvailable === true || (isTauri() && kcliSidecarAvailable === true);
  
  // Show "Missing" if:
  // 1. shellStatus exists and kcliAvailable is explicitly false
  // 2. shellStatus exists and kcliAvailable is undefined/null AND not Tauri sidecar
  // 3. Not Tauri OR (Tauri and sidecar check returned false/null)
  const kcliStatusKnown = shellStatus !== null || (isTauri() && kcliSidecarAvailable !== null);
  const showKcliMissing = kcliStatusKnown && !effectiveKcliAvailable;
  const openResourcePage = useCallback((resourcePath: string) => {
    const query = effectiveNamespace && effectiveNamespace !== 'all'
      ? `?namespace=${encodeURIComponent(effectiveNamespace)}`
      : '';
    navigate(`/${resourcePath}${query}`);
  }, [effectiveNamespace, navigate]);

  /** When focus is outside the terminal (e.g. on a header button), forward key to terminal so Enter/j/k work. */
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open || !connected || !termRef.current || !containerRef.current) return;
    if (containerRef.current.contains(document.activeElement)) return;
    const data = keyEventToStdin(e);
    if (data == null) return;
    e.preventDefault();
    e.stopPropagation();
    termRef.current.focus();
    sendStdinRef.current(data);
    if (data.includes('\r') || data.includes('\n')) scheduleStateSync(90);
  }, [open, connected, scheduleStateSync]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 flex flex-col border-t border-border bg-[hsl(221_39%_11%)] shadow-[0_-4px_30px_rgba(0,0,0,0.4)] transition-[height] duration-200 ease-in-out',
        isMaximized && 'h-[calc(100vh-64px)]'
      )}
      style={isMaximized ? {} : { height: heightPx }}
      onKeyDown={handlePanelKeyDown}
      tabIndex={-1}
    >
      {!isMaximized && (
        <div
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          className={cn(
            'flex shrink-0 cursor-n-resize items-center justify-center border-b border-white/5 bg-white/[0.02] py-1 transition-colors hover:bg-white/[0.05]',
            dragging && 'bg-white/[0.1]'
          )}
        >
          <GripHorizontal className="h-4 w-4 text-muted-foreground/50" />
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-white/[0.01] px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <TerminalIcon className="h-4 w-4 text-[hsl(142_76%_73%)]" />
          <span className="text-sm font-semibold tracking-tight text-white/90">
            {engine === 'kcli' ? `kcli ${kcliStreamMode === 'ui' ? 'UI' : 'Shell'}` : 'Kubectl Shell'}
          </span>
          <span className="text-xs text-white/30">|</span>
          <span className="text-xs font-medium text-white/60">
            Context: <span className="text-white/90">{shellStatus?.context || clusterName}</span>
          </span>
          <span className="text-xs text-white/30">|</span>
          <span className="text-xs font-medium text-white/60">
            Namespace: <span className="text-white/90">{effectiveNamespace}</span>
          </span>
          {connected ? (
            <span className="flex items-center gap-1.5 rounded border border-[hsl(142_76%_73%)/0.2] bg-[hsl(142_76%_73%)/0.1] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(142_76%_60%)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(142_76%_73%)]" />
              Connected
            </span>
          ) : connecting ? (
            <span className="flex items-center gap-1.5 rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
              Connecting
            </span>
          ) : isReconnecting ? (
            <span className="flex items-center gap-1.5 rounded border border-blue-400/20 bg-blue-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-300" />
              Reconnecting...
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
              Disconnected
            </span>
          )}
          {error && (
            <div className="flex items-center gap-2">
              <span className="rounded border border-red-400/20 bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-400">
                {error}
              </span>
              {error.toLowerCase().includes('kcli binary') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.open('https://github.com/kubilitics/kubilitics-os-emergent/docs/DEPLOYMENT_KCLI.md', '_blank');
                  }}
                  className="h-6 text-xs border-red-400/20 text-red-400 hover:bg-red-400/20"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Help
                </Button>
              )}
            </div>
          )}
          <span
            className={cn(
              'rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              shellStatus?.aiEnabled
                ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
                : 'border-white/10 bg-white/5 text-white/60'
            )}
          >
            AI {shellStatus?.aiEnabled ? 'On' : 'Off'}
          </span>
          <span
            className={cn(
              'rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              effectiveKcliAvailable
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                : showKcliMissing
                ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                : 'border-white/10 bg-white/5 text-white/60'
            )}
            title={
              effectiveKcliAvailable
                ? 'kcli binary is available'
                : showKcliMissing
                ? 'kcli binary is missing. Check backend configuration or install kcli.'
                : 'Checking kcli availability...'
            }
          >
            kcli {effectiveKcliAvailable ? 'Ready' : showKcliMissing ? 'Missing' : 'Checking...'}
          </span>
          <span
            className={cn(
              'rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              shellStatus?.kcliShellModeAllowed
                ? 'border-white/10 bg-white/5 text-white/60'
                : 'border-amber-400/20 bg-amber-400/10 text-amber-300'
            )}
          >
            shell {shellStatus?.kcliShellModeAllowed ? 'Enabled' : 'Restricted'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <div className="mr-2 flex items-center gap-1 rounded border border-white/10 bg-white/5 p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 px-2 text-[11px] font-semibold',
                engine === 'kcli' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'
              )}
              onClick={() => setEngine('kcli')}
              title="Use kcli stream engine"
              aria-label="Use kcli engine"
            >
              kcli
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 px-2 text-[11px] font-semibold',
                engine === 'kubectl' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'
              )}
              onClick={() => setEngine('kubectl')}
              title="Use kubectl shell stream"
              aria-label="Use kubectl engine"
            >
              kubectl
            </Button>
          </div>

          {engine === 'kcli' && (
            <div className="mr-2 flex items-center gap-1 rounded border border-white/10 bg-white/5 p-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-6 px-2 text-[11px] font-semibold',
                  kcliStreamMode === 'ui' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'
                )}
              onClick={() => setKcliStreamMode('ui')}
              title="Launch kcli Bubble Tea UI"
              aria-label="Use kcli UI mode"
            >
              UI
            </Button>
            <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-6 px-2 text-[11px] font-semibold',
                  kcliStreamMode === 'shell' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'
                )}
              disabled={shellStatus?.kcliShellModeAllowed === false}
              onClick={() => setKcliStreamMode('shell')}
              title="Launch classic shell"
              aria-label="Use kcli shell mode"
            >
              Shell
            </Button>
            </div>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-white/10 hover:text-white"
            onClick={handleReconnect}
            title="Reconnect session"
            aria-label="Reconnect session"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-white/10 hover:text-white"
            onClick={handleCopySelection}
            title="Copy selected text"
            aria-label="Copy selected text"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-white/10 hover:text-white"
            onClick={() => {
              termRef.current?.clear();
              termRef.current?.focus();
            }}
            title="Clear terminal"
            aria-label="Clear terminal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-white/10 hover:text-white"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? 'Restore size' : 'Maximize'}
            aria-label={isMaximized ? 'Restore terminal size' : 'Maximize terminal'}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <div className="mx-1 h-4 w-px bg-white/10" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-white/10 hover:text-red-400"
            onClick={() => onOpenChange(false)}
            aria-label="Close shell"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-[hsl(221_39%_9%)] px-4 py-1.5">
        <div className="text-[11px] font-medium text-white/60">
          Quick Links
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => openResourcePage('pods')}
          >
            Pods
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => openResourcePage('deployments')}
          >
            Deployments
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => openResourcePage('services')}
          >
            Services
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => openResourcePage('events')}
          >
            Events
          </Button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 bg-[hsl(221_39%_6%)]">
        {!clusterId ? (
          <div className="flex h-full items-center justify-center text-sm font-medium italic text-muted-foreground">
            Select a cluster to activate terminal.
          </div>
        ) : (
          <div
            ref={containerRef}
            className="h-full w-full cursor-text p-2"
            onClick={() => termRef.current?.focus()}
            style={{
              fontSmooth: 'antialiased',
              WebkitFontSmoothing: 'antialiased',
            }}
          />
        )}
      </div>
    </div>
  );
}
