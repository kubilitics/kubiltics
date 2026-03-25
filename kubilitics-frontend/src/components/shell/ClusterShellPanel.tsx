import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, X, GripHorizontal, Maximize2, Minimize2, Trash2, RefreshCw, ClipboardCopy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getKCLIComplete, getKCLITUIState, getKubectlShellStreamUrl, getShellComplete, type ShellStatusResult } from '@/services/backendApiClient';
import { useNavigate } from 'react-router-dom';
import { applyCompletionToLine, updateLineBuffer } from './completionEngine';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { isTauri } from '@/lib/tauri';
import { toast } from '@/components/ui/sonner';
import { useUIStore } from '@/stores/uiStore';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const MIN_HEIGHT_PX = 160;
const MAX_HEIGHT_PERCENT = 85;
const INITIAL_HEIGHT_PX = 320;
const SHELL_STATE_SYNC_INTERVAL_MS = 2000;
const SHELL_STATE_SYNC_BACKOFF_MS = 15000;
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

/** Map a keyboard event to the byte sequence to send to the PTY. */
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
    if (c >= 64 && c <= 95) return String.fromCharCode(c - 64);
  }
  if (e.altKey && key.length === 1) return '\x1b' + key;
  if (key.length === 1 && !e.ctrlKey && !e.metaKey) return key;
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
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const circuitOpen = useBackendCircuitOpen();
  const circuitOpenRef = useRef(circuitOpen);
  circuitOpenRef.current = circuitOpen;
  const setShellHeightPx = useUIStore((s) => s.setShellHeightPx);

  // Track "just connected" to avoid sending redundant namespace commands
  const justConnectedRef = useRef(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
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
  const gotFirstOutputRef = useRef(false);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_BASE_DELAY_MS = 1000;

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
    } catch {
      const b = syncBackoffRef.current;
      b.failures += 1;
      b.intervalMs = Math.min(
        SHELL_STATE_SYNC_BACKOFF_MAX_MS,
        SHELL_STATE_SYNC_BACKOFF_MS * Math.min(b.failures, 4)
      );
    }
  }, [applyShellState, backendBaseUrl, clusterId, open]);

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
    const line = lineBufferRef.current;
    if (!line.trim()) return false;

    completionPendingRef.current = true;
    try {
      // Try kcli completion first, fall back to kubectl completion
      let result;
      try {
        result = await getKCLIComplete(backendBaseUrl, clusterId, line);
      } catch {
        result = await getShellComplete(backendBaseUrl, clusterId, line);
      }
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
  }, [applyCompletion, backendBaseUrl, clusterId, connected]);

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
      scrollback: 5000,
      convertEol: true,
      theme: {
        background: '#0d1117',
        foreground: '#f0f6fc',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#f0f6fc',
        brightBlack: '#484f58',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d364',
        brightWhite: '#f0f6fc',
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

  // WS connection lifecycle — always use /shell/stream (supports both kcli and kubectl).
  useEffect(() => {
    if (!open || !clusterId) {
      intentionalCloseRef.current = true;
      wsSessionRef.current += 1;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnecting(false);
      setConnected(false);
      setIsReconnecting(false);
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      return;
    }

    const sessionId = wsSessionRef.current + 1;
    wsSessionRef.current = sessionId;

    if (circuitOpenRef.current) {
      setConnecting(false);
      setConnected(false);
      setError('Backend unavailable. Click reconnect when ready.');
      return;
    }

    // Always use the shell/stream endpoint — it auto-detects kcli and sets up aliases.
    // Both kcli and kubectl commands work in this shell.
    const wsUrl = getKubectlShellStreamUrl(backendBaseUrl, clusterId);

    setConnecting(true);
    setConnected(false);
    setError(null);
    gotFirstOutputRef.current = false;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;

      justConnectedRef.current = true;
      setTimeout(() => { justConnectedRef.current = false; }, 3000);

      setConnecting(false);
      // NOTE: setConnected(true) is deferred until the first stdout/stderr
      // message arrives, matching PodTerminal's pattern. This avoids a
      // brief "connected" flash when the WebSocket opens but the shell
      // process hasn't started yet.
      setIsReconnecting(false);
      setError(null);
      reconnectAttemptRef.current = 0;
      intentionalCloseRef.current = false;

      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      const term = termRef.current;
      if (term) {
        if (reconnectAttemptRef.current > 0 || isReconnecting) {
          term.write('\r\n\x1b[90m--- reconnected ---\x1b[0m\r\n');
        } else {
          term.reset();
        }
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
          // Mark connected on first real output from the shell process
          if (!gotFirstOutputRef.current) {
            gotFirstOutputRef.current = true;
            setConnected(true);
          }
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
          setError(msg.d);
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

      if (!intentionalCloseRef.current && open && clusterId) {
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const attempt = reconnectAttemptRef.current + 1;
          const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptRef.current),
            30000
          );

          setIsReconnecting(true);
          setError(null);

          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectAttemptRef.current = attempt;
            setReconnectNonce((n) => n + 1);
          }, delay);
        } else {
          setIsReconnecting(false);
          setError('Connection lost. Click reconnect to try again.');
        }
      } else {
        setIsReconnecting(false);
      }
    };

    ws.onerror = () => {
      // Don't set error here — onclose handles reconnection.
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clusterId, backendBaseUrl, reconnectNonce, focusAndFit, flushPendingOutput]);

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
    setShellHeightPx(next);
  }, [dragging, setShellHeightPx]);

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

  // Sync namespace changes to shell
  useEffect(() => {
    if (!open || !connected) return;
    if (!activeNamespace || activeNamespace === 'all') return;
    if (shellStatus?.namespace === activeNamespace) return;
    if (justConnectedRef.current) return;
    sendStdin(`kubectl config set-context --current --namespace=${activeNamespace}\r`);
    scheduleStateSync(90);
  }, [activeNamespace, connected, open, scheduleStateSync, sendStdin, shellStatus?.namespace]);

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

  /** Forward keystrokes to terminal when focus is on header buttons */
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open || !connected || !termRef.current || !wrapperRef.current) return;
    if (wrapperRef.current.contains(document.activeElement)) return;
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
      data-shell-panel
      className={cn(
        'fixed bottom-0 left-0 right-0 z-[60] flex flex-col border-t border-border bg-[#0d1117] shadow-[0_-4px_30px_rgba(0,0,0,0.4)] transition-[height] duration-200 ease-in-out',
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

      {/* Clean, minimal title bar — context + status + controls */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon className="h-4 w-4 shrink-0 text-[hsl(142_76%_73%)]" />
          <span className="text-xs font-medium text-white/60 truncate">
            <span className="text-white/90">{shellStatus?.context || clusterName}</span>
            <span className="text-white/30 mx-1">/</span>
            <span className="text-white/80">{effectiveNamespace}</span>
          </span>
          {connected && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-[hsl(142_76%_73%)]" title="Connected" />
          )}
          {(connecting || isReconnecting) && (
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" title={isReconnecting ? 'Reconnecting' : 'Connecting'} />
          )}
          {!connected && !connecting && !isReconnecting && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-white/20" title="Disconnected" />
          )}
          {error && (
            <span className="text-[10px] text-red-400 truncate max-w-[200px]" title={error}>
              {error}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {isTauri() && (
            <button
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-white/50 hover:bg-white/10 hover:text-white transition-colors"
              onClick={() => {
                const ctx = shellStatus?.context || clusterName;
                const ns = effectiveNamespace;
                const cmd = `kubectl --context ${ctx} -n ${ns}`;
                navigator.clipboard.writeText(cmd).then(() => {
                  toast.success('Copied to clipboard — paste in your terminal', {
                    description: cmd,
                    duration: 4000,
                  });
                });
              }}
              title="Copy kubectl command to clipboard"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              <span>Copy kubectl</span>
            </button>
          )}
          <button
            className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
            onClick={handleReconnect}
            title="Reconnect"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
            onClick={() => { termRef.current?.clear(); termRef.current?.focus(); }}
            title="Clear"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-red-400"
            onClick={() => onOpenChange(false)}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal area — outer div has padding, inner div is where xterm mounts (no padding)
          so FitAddon correctly measures available space without clipping the last line */}
      <div className="relative flex-1 min-h-0 bg-[#0d1117]">
        {!clusterId ? (
          <div className="flex h-full items-center justify-center text-sm font-medium italic text-muted-foreground">
            Select a cluster to activate terminal.
          </div>
        ) : (
          <div ref={wrapperRef} className="h-full w-full p-2 pl-3">
            <div
              ref={containerRef}
              className="h-full w-full cursor-text"
              onClick={() => termRef.current?.focus()}
              style={{
                fontSmooth: 'antialiased',
                WebkitFontSmoothing: 'antialiased',
                WebkitTextSizeAdjust: '100%',
                transform: 'translateZ(0)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
