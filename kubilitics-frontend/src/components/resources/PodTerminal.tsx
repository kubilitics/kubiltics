/**
 * PodTerminal — Real terminal into a running container via K8s exec API.
 *
 * Uses xterm.js for terminal rendering and WebSocket for communication
 * with the backend exec endpoint. NOT a mock — runs real commands in
 * the actual container.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Maximize2, Minimize2, Trash2, RefreshCw, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

interface PodTerminalProps {
  podName: string;
  namespace: string;
  containerName: string;
  containers?: string[];
  onContainerChange?: (container: string) => void;
  className?: string;
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

export function PodTerminal({
  podName,
  namespace,
  containerName,
  containers = [],
  onContainerChange,
  className,
}: PodTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const [selectedContainer, setSelectedContainer] = useState(containerName);
  const [connState, setConnState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const isConnected = connState === 'connected';
  const [isMaximized, setIsMaximized] = useState(false);

  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const clusterId = useBackendConfigStore((s) => s.currentClusterId);

  const connect = useCallback(() => {
    if (!clusterId || !podName || !namespace) return;

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = baseUrl || window.location.host;
    const wsHost = host.startsWith('http') ? host.replace(/^https?:\/\//, '') : host;
    const wsUrl = `${protocol}//${wsHost || window.location.host}/api/v1/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/exec?container=${encodeURIComponent(selectedContainer)}`;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Create xterm if not exists — defer to next frame to ensure DOM has dimensions
    if (!xtermRef.current) {
      if (!termRef.current) return;
      const container = termRef.current;
      // Ensure container has dimensions (tab may have just become visible)
      if (container.clientHeight === 0) {
        const timer = setTimeout(() => connect(), 100);
        return () => clearTimeout(timer);
      }
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
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
        scrollback: 5000,
        convertEol: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      // Fit after layout settles — double-rAF for WKWebView which may
      // not have finished its layout pass after a single frame.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fit.fit();
        // WKWebView sometimes needs an extra kick after initial render
        setTimeout(() => fit.fit(), 150);
      }));
      xtermRef.current = term;
      fitRef.current = fit;
    }

    const term = xtermRef.current;
    term.clear();
    setConnState('connecting');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Dispose previous onData listener before creating new one
    dataDisposableRef.current?.dispose();

    // Wire xterm input → WebSocket (check ws state on each keystroke)
    const dataDisposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: 'stdin', d: base64Encode(data) }));
      }
    });

    ws.onopen = () => {
      // Don't set 'connected' yet — wait for first stdout to confirm end-to-end exec works
      fitRef.current?.fit();
      // Send initial resize with actual terminal dimensions
      requestAnimationFrame(() => {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ t: 'resize', r: { cols, rows } }));
      });
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.t === 'stdout' || msg.t === 'stderr') {
          setConnState('connected');
          const bytes = atob(msg.d);
          term.write(bytes);
        } else if (msg.t === 'exit') {
          term.writeln(`\r\n\x1b[33mSession ended (exit code: ${msg.d || '0'})\x1b[0m`);
          setConnState('disconnected');
        } else if (msg.t === 'error') {
          term.writeln(`\r\n\x1b[31mError: ${msg.d}\x1b[0m`);
          setConnState('disconnected');
        }
      } catch {
        term.write(evt.data);
      }
    };

    ws.onclose = (evt) => {
      setConnState('disconnected');
      // 1000 = clean close, 1005 = no status (tab switch / unmount) — both are normal
      if (evt.code !== 1000 && evt.code !== 1005) {
        term.writeln(`\r\n\x1b[33mDisconnected (code: ${evt.code}). Click Reconnect.\x1b[0m`);
      }
    };

    ws.onerror = () => {
      setConnState('disconnected');
      term.writeln(`\r\n\x1b[31mConnection failed. Is the backend running?\x1b[0m`);
    };

    dataDisposableRef.current = dataDisposable;
  }, [clusterId, podName, namespace, selectedContainer, baseUrl]);

  // Connect on mount, auto-reconnect on tab visibility
  useEffect(() => {
    connect();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      wsRef.current?.close(1000, 'unmount');
    };
  }, [connect]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      fitRef.current?.fit();
      if (xtermRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        const { cols, rows } = xtermRef.current;
        wsRef.current.send(JSON.stringify({ t: 'resize', r: { cols, rows } }));
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Refit on maximize toggle
  useEffect(() => {
    setTimeout(() => fitRef.current?.fit(), 100);
  }, [isMaximized]);

  const handleClear = () => xtermRef.current?.clear();
  const handleCopy = () => {
    const sel = xtermRef.current?.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel);
      toast.success('Copied to clipboard');
    } else {
      toast.info('Select text first, then copy');
    }
  };

  return (
    <div className={cn(
      'flex flex-col rounded-xl overflow-hidden border border-slate-700/50 min-h-0',
      isMaximized ? 'fixed inset-4 z-50 shadow-2xl' : 'flex-1',
      className,
    )}>
      {/* Header */}
      <div className="bg-[#0d1117] border-b border-slate-700/50 px-4 py-2 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="text-xs text-slate-400 font-mono ml-2 truncate">
          {podName}:{selectedContainer}
        </span>
        {connState === 'connected' ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Connected</span>
        ) : connState === 'connecting' ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">Connecting</span>
        ) : null}

        {/* Container selector */}
        {containers.length > 1 && (
          <div className="flex items-center gap-0.5 ml-2 bg-slate-800/60 rounded-md p-0.5">
            {containers.map(c => (
              <button
                key={c}
                onClick={() => { setSelectedContainer(c); onContainerChange?.(c); }}
                className={cn(
                  'h-6 px-2.5 text-[11px] font-medium rounded-sm transition-all',
                  selectedContainer === c
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700',
                )}
              >{c}</button>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={handleCopy} className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" title="Copy selection">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleClear} className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" title="Clear terminal">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={connect} className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" title="Reconnect">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setIsMaximized(v => !v)} className="h-7 w-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors" title={isMaximized ? 'Exit fullscreen' : 'Fullscreen'}>
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal — always dark background + light text regardless of app theme.
           Uses explicit height (not flex-1) for WKWebView compatibility — flex-1
           can compute to 0px in Tauri's WKWebView when the flex parent hasn't
           settled its layout before xterm.js FitAddon measures the container.
           padding-left prevents text from touching the container edge. */}
      <div
        ref={termRef}
        className="bg-[#0d1117] text-slate-200 pl-2 flex-1 min-h-0 [&_.xterm]:!bg-[#0d1117] [&_.xterm-viewport]:!bg-[#0d1117] [&_.xterm-viewport]:!overflow-y-auto"
        style={{
          minHeight: isMaximized ? 'calc(100vh - 120px)' : '300px',
          WebkitTextSizeAdjust: '100%',
        }}
      />
    </div>
  );
}
