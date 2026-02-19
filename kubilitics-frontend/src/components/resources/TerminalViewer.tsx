import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Terminal as TerminalIcon, Maximize2, Minimize2, Copy, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendCircuitOpen } from '@/hooks/useBackendCircuitOpen';
import { getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { getKCLIShellStreamUrl, getKubectlShellStreamUrl, getPodExecWebSocketUrl, getShellStatus, isBackendCircuitOpen } from '@/services/backendApiClient';
import { toast } from 'sonner';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/** xterm theme aligned with ClusterShellPanel for consistent pod exec UX */
const XTERM_THEME = {
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
};

export interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp?: string;
}

export interface TerminalViewerProps {
  podName?: string;
  namespace?: string;
  containerName?: string;
  containers?: string[];
  onContainerChange?: (container: string) => void;
  className?: string;
}

const TERMINAL_SOURCE_STORAGE_KEY = 'kubilitics-pod-terminal-source';
const TERMINAL_KCLI_MODE_STORAGE_KEY = 'kubilitics-pod-terminal-kcli-mode';

/** Robust base64 encoding/decoding for terminal I/O */
function base64Encode(str: string): string {
  try {
    // UTF-8 safe base64 encoding
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    ));
  } catch (e) {
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

export function TerminalViewer({
  podName,
  namespace,
  containerName = 'main',
  containers = [],
  onContainerChange,
  className,
}: TerminalViewerProps) {
  const { isConnected } = useConnectionStatus();
  const activeClusterId = useActiveClusterId();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const clusterId = activeClusterId;

  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedContainer, setSelectedContainer] = useState(containerName);
  const [isMaximized, setIsMaximized] = useState(false);
  const [execConnected, setExecConnected] = useState(false);
  const [execConnecting, setExecConnecting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [terminalSource, setTerminalSource] = useState<'pod' | 'kcli' | 'kubectl'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(TERMINAL_SOURCE_STORAGE_KEY) : null;
    return saved === 'kcli' || saved === 'kubectl' || saved === 'pod' ? saved : 'pod';
  });
  const [kcliStreamMode, setKcliStreamMode] = useState<'ui' | 'shell'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(TERMINAL_KCLI_MODE_STORAGE_KEY) : null;
    return saved === 'shell' ? 'shell' : 'ui';
  });
  const [kcliShellModeAllowed, setKcliShellModeAllowed] = useState(true);
  const circuitOpen = useBackendCircuitOpen();

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsSessionRef = useRef(0);
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pendingOutputRef = useRef<{ type: 'stdout' | 'stderr'; data: string }[]>([]);

  const podExecReady = isBackendConfigured() && !!clusterId && !!namespace && !!podName && !!selectedContainer;
  const clusterShellReady = isBackendConfigured() && !!clusterId;
  const expectsLiveSession = terminalSource === 'pod' ? podExecReady : clusterShellReady;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TERMINAL_SOURCE_STORAGE_KEY, terminalSource);
    }
  }, [terminalSource]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TERMINAL_KCLI_MODE_STORAGE_KEY, kcliStreamMode);
    }
  }, [kcliStreamMode]);

  useEffect(() => {
    if (!clusterId) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await getShellStatus(backendBaseUrl, clusterId);
        if (cancelled) return;
        setKcliShellModeAllowed(status.kcliShellModeAllowed);
        if (!status.kcliShellModeAllowed && kcliStreamMode === 'shell') {
          setKcliStreamMode('ui');
        }
      } catch {
        if (!cancelled) {
          setKcliShellModeAllowed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendBaseUrl, clusterId, kcliStreamMode]);

  // Create xterm only when live and container is visible (avoids zero-size / invisible container)
  useEffect(() => {
    if (!expectsLiveSession || !execConnected || !xtermContainerRef.current) return;
    if (termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Roboto Mono', Monaco, 'Courier New', monospace",
      theme: XTERM_THEME,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(xtermContainerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ t: 'stdin', d: base64Encode(data) }));
        } catch {
          // ignore
        }
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: 'resize', r: { cols, rows } }));
      }
    });

    // Flush any stdout/stderr received before the terminal existed
    const pending = pendingOutputRef.current;
    pendingOutputRef.current = [];
    for (const { data } of pending) {
      term.write(base64DecodeToUint8Array(data));
    }

    // Send initial size to backend (terminal didn't exist in ws.onopen)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const { cols, rows } = term;
      try {
        wsRef.current.send(JSON.stringify({ t: 'resize', r: { rows, cols } }));
      } catch {
        // ignore
      }
    }

    // Multiple deferred focus attempts so xterm's textarea is in the DOM and can receive input
    const t1 = setTimeout(() => term.focus(), 50);
    const t2 = setTimeout(() => term.focus(), 150);
    const t3 = setTimeout(() => term.focus(), 400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [expectsLiveSession, execConnected]);

  // ResizeObserver: fit xterm when container gets/loses size (e.g. tab animation finished)
  useEffect(() => {
    if (!execConnected || !expectsLiveSession || !xtermContainerRef.current || !fitAddonRef.current) return;
    const el = xtermContainerRef.current;
    const ro = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
      termRef.current?.focus();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [execConnected, expectsLiveSession]);

  // WebSocket exec/stream: pod exec or cluster shell based on selected source
  useEffect(() => {
    if (!expectsLiveSession) {
      wsSessionRef.current += 1;
      setExecConnected(false);
      setExecConnecting(false);
      setExecError(null);
      pendingOutputRef.current = [];
      return;
    }
    const sessionId = wsSessionRef.current + 1;
    wsSessionRef.current = sessionId;

    // P2-4: Do not open WebSocket when circuit is open; show friendly message in terminal panel.
    if (isBackendCircuitOpen()) {
      setExecConnecting(false);
      setExecError('Backend unavailable. Use Retry in the banner when the connection is back.');
      return;
    }

    const url = terminalSource === 'pod'
      ? getPodExecWebSocketUrl(backendBaseUrl, clusterId!, namespace!, podName!, {
        container: selectedContainer,
        shell: '/bin/sh',
      })
      : terminalSource === 'kcli'
        ? getKCLIShellStreamUrl(backendBaseUrl, clusterId!, kcliStreamMode)
        : getKubectlShellStreamUrl(backendBaseUrl, clusterId!);
    setExecConnecting(true);
    setExecError(null);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      setExecConnecting(false);
      setExecConnected(true);
      // Terminal is created in a separate effect when execConnected becomes true; resize/focus happen there
    };

    ws.onmessage = (event) => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data) as { t?: string; d?: string };
        const t = msg.t;
        const d = msg.d;
        if (t === 'stdout' && d) {
          if (termRef.current) {
            termRef.current.write(base64DecodeToUint8Array(d));
          } else {
            if (pendingOutputRef.current.length >= 1000) {
              pendingOutputRef.current.shift();
            }
            pendingOutputRef.current.push({ type: 'stdout', data: d });
          }
        } else if (t === 'stderr' && d) {
          if (termRef.current) {
            termRef.current.write(base64DecodeToUint8Array(d));
          } else {
            if (pendingOutputRef.current.length >= 1000) {
              pendingOutputRef.current.shift();
            }
            pendingOutputRef.current.push({ type: 'stderr', data: d });
          }
        } else if (t === 'exit') {
          setExecConnected(false);
        } else if (t === 'error' && d) {
          setExecError(d);
          termRef.current?.write(`\r\n[Error: ${d}]\r\n`);
          setExecConnected(false);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      setExecConnecting(false);
      setExecError('WebSocket error');
    };

    ws.onclose = () => {
      if (wsSessionRef.current !== sessionId || wsRef.current !== ws) return;
      setExecConnecting(false);
      setExecConnected(false);
      wsRef.current = null;
      pendingOutputRef.current = [];
    };

    return () => {
      if (wsSessionRef.current === sessionId) {
        wsSessionRef.current += 1;
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      pendingOutputRef.current = [];
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [expectsLiveSession, backendBaseUrl, clusterId, namespace, podName, selectedContainer, terminalSource, kcliStreamMode, reconnectNonce, circuitOpen]);

  // Fit xterm when maximized or window resizes (live exec only); refocus after fit so input works
  useEffect(() => {
    if (!execConnected || !expectsLiveSession) return;
    const t = setTimeout(() => {
      fitAddonRef.current?.fit();
      termRef.current?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [execConnected, expectsLiveSession, isMaximized]);

  useEffect(() => {
    const handleResize = () => fitAddonRef.current?.fit();
    if (!execConnected || !expectsLiveSession) return;
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [execConnected, expectsLiveSession]);

  // Initial welcome message (when not using real exec or before connected)
  useEffect(() => {
    if (execConnected) return;
    const welcomeLines: TerminalLine[] = [
      {
        type: 'system',
        content: terminalSource === 'pod'
          ? `Connecting to ${podName || 'pod'}/${selectedContainer}...`
          : `Connecting to cluster shell (${terminalSource === 'kcli' ? `kcli ${kcliStreamMode}` : 'kubectl'})...`,
      },
      ...(execConnecting
        ? [{ type: 'system' as const, content: 'Opening exec session…' }]
        : execError
          ? [{ type: 'system' as const, content: `Exec not available: ${execError}` }]
          : [{ type: 'system' as const, content: 'Interactive terminal is unavailable until backend and cluster session are ready.' }]),
      {
        type: 'system',
        content: terminalSource === 'pod'
          ? `Container: ${selectedContainer} | Shell: /bin/sh`
          : `Cluster Shell: ${terminalSource === 'kcli' ? `kcli (${kcliStreamMode})` : 'kubectl'}`
      },
      ...(execConnected ? [] : [{ type: 'system' as const, content: 'When connected, all commands run directly in the live session.\n' }]),
    ];
    setLines((prev) => {
      if (prev.length === 0) return welcomeLines;
      return prev;
    });
  }, [podName, selectedContainer, isConnected, expectsLiveSession, execConnecting, execConnected, execError, terminalSource, kcliStreamMode]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input when clicking terminal
  const handleTerminalClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Execute command: send over WebSocket only for a live session.
  const executeCommand = useCallback((command: string) => {
    const trimmedCmd = command.trim();
    if (!trimmedCmd) return;

    setCommandHistory(prev => [...prev, trimmedCmd]);
    setHistoryIndex(-1);

    setLines(prev => [...prev, {
      type: 'input',
      content: `$ ${trimmedCmd}`,
      timestamp: new Date().toISOString(),
    }]);

    if (trimmedCmd === 'clear') {
      setLines([]);
      return;
    }

    if (trimmedCmd === 'exit') {
      if (execConnected && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      setLines(prev => [...prev, { type: 'system', content: 'Session terminated. Refresh to reconnect.' }]);
      return;
    }

    // Real exec: send stdin to backend
    if (execConnected && wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        const payload = trimmedCmd + '\n';
        wsRef.current.send(JSON.stringify({ t: 'stdin', d: base64Encode(payload) }));
      } catch {
        setLines(prev => [...prev, { type: 'error', content: 'Failed to send command' }]);
      }
      return;
    }

    // When backend exec is expected but not connected, do not use mock — show clear message
    if (expectsLiveSession) {
      setLines(prev => [
        ...prev,
        {
          type: 'error',
          content: 'Command not sent: exec session not connected. Check that the backend is running and the cluster is reachable.',
        },
      ]);
      return;
    }

    setLines(prev => [
      ...prev,
      {
        type: 'error',
        content: 'Command not executed: no live terminal session. Start backend, ensure cluster is reachable, then reconnect.',
      },
    ]);
  }, [execConnected, expectsLiveSession]);

  // Handle key events
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand(currentInput);
      setCurrentInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setCurrentInput('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
    } else if (e.key === 'c' && e.ctrlKey) {
      setCurrentInput('');
      setLines(prev => [...prev, { type: 'input', content: `$ ${currentInput}^C` }]);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  }, [currentInput, commandHistory, historyIndex, executeCommand]);

  const handleCopyOutput = useCallback(() => {
    if (execConnected && termRef.current) {
      const sel = termRef.current.getSelection();
      if (sel) {
        navigator.clipboard.writeText(sel);
        toast.success('Selection copied to clipboard');
      } else {
        toast.info('No selection to copy');
      }
      return;
    }
    const output = lines.map(l => l.content).join('\n');
    navigator.clipboard.writeText(output);
    toast.success('Terminal output copied to clipboard');
  }, [lines, execConnected]);

  const handleClear = useCallback(() => {
    if (execConnected && termRef.current) {
      termRef.current.clear();
      termRef.current.focus();
      return;
    }
    setLines([]);
  }, [execConnected]);

  return (
    <Card className={cn(
      'overflow-hidden transition-all duration-300',
      isMaximized && 'fixed inset-4 z-50',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[hsl(221_39%_11%)] border-b border-[hsl(0_0%_100%/0.1)]">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
          <TerminalIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-[hsl(0_0%_100%/0.9)]">
            {terminalSource === 'pod'
              ? `${namespace}/${podName}:${selectedContainer}`
              : `${clusterId || 'cluster'}:${terminalSource === 'kcli' ? `kcli ${kcliStreamMode}` : 'kubectl shell'}`}
          </span>
          <Badge variant="outline" className="text-xs border-[hsl(0_0%_100%/0.2)] text-[hsl(0_0%_100%/0.6)]">
            {terminalSource === 'pod' ? '/bin/sh' : terminalSource === 'kcli' ? 'kcli' : 'kubectl'}
          </Badge>
          {expectsLiveSession ? (
            execConnected ? (
              <Badge className="text-xs bg-emerald-600/80 text-white border-0">Live</Badge>
            ) : execConnecting ? (
              <Badge className="text-xs bg-amber-600/80 text-white border-0 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Connecting…
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs text-amber-200 bg-amber-900/40 border-amber-500/40">
                Not connected
              </Badge>
            )
          ) : (
            <Badge variant="secondary" className="text-xs text-[hsl(0_0%_100%/0.5)] border-[hsl(0_0%_100%/0.2)]">
              Demo
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          <div className="mr-2 flex items-center gap-1 rounded border border-white/10 bg-white/5 p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[11px] font-semibold",
                terminalSource === 'pod' ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
              )}
              onClick={() => setTerminalSource('pod')}
              title="Pod exec terminal"
            >
              Pod
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[11px] font-semibold",
                terminalSource === 'kcli' ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
              )}
              onClick={() => setTerminalSource('kcli')}
              title="Cluster kcli terminal"
            >
              kcli
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-[11px] font-semibold",
                terminalSource === 'kubectl' ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
              )}
              onClick={() => setTerminalSource('kubectl')}
              title="Cluster kubectl shell"
            >
              kubectl
            </Button>
          </div>

          {terminalSource === 'kcli' && (
            <div className="mr-2 flex items-center gap-1 rounded border border-white/10 bg-white/5 p-0.5">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 px-2 text-[11px] font-semibold",
                  kcliStreamMode === 'ui' ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
                )}
                onClick={() => setKcliStreamMode('ui')}
                title="kcli UI mode"
              >
                UI
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 px-2 text-[11px] font-semibold",
                  kcliStreamMode === 'shell' ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
                )}
                disabled={!kcliShellModeAllowed}
                onClick={() => setKcliStreamMode('shell')}
                title="kcli shell mode"
              >
                Shell
              </Button>
            </div>
          )}

          {terminalSource === 'pod' && containers.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-[hsl(0_0%_100%/0.7)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]">
                  {selectedContainer}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {containers.map(c => (
                  <DropdownMenuItem
                    key={c}
                    onClick={() => {
                      setSelectedContainer(c);
                      onContainerChange?.(c);
                    }}
                  >
                    {c}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[hsl(0_0%_100%/0.5)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]"
            onClick={() => setReconnectNonce((n) => n + 1)}
            title="Reconnect session"
            aria-label="Reconnect session"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[hsl(0_0%_100%/0.5)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]"
            onClick={handleCopyOutput}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[hsl(0_0%_100%/0.5)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]"
            onClick={handleClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[hsl(0_0%_100%/0.5)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]"
            onClick={() => setIsMaximized(!isMaximized)}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Terminal Content: xterm when live exec connected, else lines + input (demo or connecting) */}
      <div
        className="relative bg-[hsl(221_39%_11%)] text-[hsl(142_76%_73%)] font-mono text-sm overflow-hidden"
        style={{ height: isMaximized ? 'calc(100vh - 120px)' : '400px' }}
      >
        {/* xterm container: only when connected so terminal is created with visible size and can receive focus */}
        {expectsLiveSession && execConnected && (
          <div
            ref={xtermContainerRef}
            className="h-full w-full p-2 cursor-text relative"
            style={{
              fontSmooth: 'antialiased',
              WebkitFontSmoothing: 'antialiased',
            }}
            onClick={() => termRef.current?.focus()}
          />
        )}
        {/* Lines + input: demo mode or connecting/error */}
        {(!expectsLiveSession || !execConnected) && (
          <div
            ref={terminalRef}
            onClick={handleTerminalClick}
            className="h-full overflow-auto cursor-text"
          >
            <div className="p-4 space-y-0.5">
              {lines.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={cn(
                    'whitespace-pre-wrap break-all',
                    line.type === 'input' && 'text-[hsl(0_0%_100%/0.9)]',
                    line.type === 'output' && 'text-[hsl(142_76%_73%)]',
                    line.type === 'error' && 'text-[hsl(var(--error))]',
                    line.type === 'system' && 'text-[hsl(var(--info))] italic',
                  )}
                >
                  {line.content}
                </motion.div>
              ))}
              {/* Current input line (demo / not connected) */}
              <div className="flex items-center text-[hsl(0_0%_100%/0.9)]">
                <span className="text-[hsl(var(--success))] mr-1">$</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={currentInput}
                  onChange={(e) => setCurrentInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent outline-none caret-[hsl(var(--success))]"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                />
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="w-2 h-4 bg-[hsl(var(--success))]"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 bg-[hsl(221_39%_13%)] border-t border-[hsl(0_0%_100%/0.1)] text-xs text-[hsl(0_0%_100%/0.4)] flex items-center justify-between">
        <span>
          {expectsLiveSession && execConnected
            ? 'Full interactive terminal • Select text to copy • Ctrl+L clear'
            : 'Waiting for live terminal session • Ctrl+L clear • Ctrl+C cancel input'}
        </span>
        {!execConnected && <span>{commandHistory.length} commands</span>}
      </div>
    </Card>
  );
}
