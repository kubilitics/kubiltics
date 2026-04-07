/**
 * ClusterShellPanel — Multi-tab cluster shell panel.
 * Manages multiple concurrent terminal sessions via ShellSession sub-components.
 * Each tab maintains its own independent WebSocket connection and xterm instance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, X, GripHorizontal, Maximize2, Minimize2, Trash2, RefreshCw, ClipboardCopy, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';
import { toast } from '@/components/ui/sonner';
import { useUIStore } from '@/stores/uiStore';
import { ShellSession, type ShellSessionHandle, type ShellSessionStatus } from './ShellSession';
import '@xterm/xterm/css/xterm.css';

const MIN_HEIGHT_PX = 160;
const MAX_HEIGHT_PERCENT = 85;
const INITIAL_HEIGHT_PX = 320;
const MAX_SESSIONS = 8;

export interface ClusterShellPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterId: string | null;
  clusterName: string;
  backendBaseUrl: string;
}

interface SessionEntry {
  id: string;
  label: string;
}

let sessionCounter = 0;
function nextSessionId(): string {
  sessionCounter += 1;
  return `shell-${sessionCounter}`;
}

export function ClusterShellPanel({
  open,
  onOpenChange,
  clusterId,
  clusterName,
  backendBaseUrl,
}: ClusterShellPanelProps) {
  const [heightPx, setHeightPx] = useState(INITIAL_HEIGHT_PX);
  const [dragging, setDragging] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const setShellHeightPx = useUIStore((s) => s.setShellHeightPx);

  // Multi-session state
  const [sessions, setSessions] = useState<SessionEntry[]>(() => {
    const id = nextSessionId();
    return [{ id, label: 'Shell 1' }];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id ?? '');

  // Per-session refs and status
  const sessionRefsMap = useRef<Map<string, ShellSessionHandle>>(new Map());
  const sessionStatusMap = useRef<Map<string, ShellSessionStatus>>(new Map());
  const [activeStatus, setActiveStatus] = useState<ShellSessionStatus>({
    connecting: false,
    connected: false,
    isReconnecting: false,
    error: null,
    shellStatus: null,
  });

  // Track label counter
  const labelCounterRef = useRef(1);

  const addSession = useCallback(() => {
    if (sessions.length >= MAX_SESSIONS) {
      toast.info(`Maximum ${MAX_SESSIONS} terminal sessions allowed.`);
      return;
    }
    labelCounterRef.current += 1;
    const id = nextSessionId();
    const entry: SessionEntry = { id, label: `Shell ${labelCounterRef.current}` };
    setSessions((prev) => [...prev, entry]);
    setActiveSessionId(id);
  }, [sessions.length]);

  const closeSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (next.length === 0) {
        // Last tab closed — close the panel
        onOpenChange(false);
        return prev; // keep at least one until panel closes
      }
      return next;
    });

    // If closing the active session, switch to the nearest tab
    setActiveSessionId((current) => {
      if (current !== sessionId) return current;
      const idx = sessions.findIndex((s) => s.id === sessionId);
      const remaining = sessions.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) return current;
      const newIdx = Math.min(idx, remaining.length - 1);
      return remaining[newIdx].id;
    });

    sessionRefsMap.current.delete(sessionId);
    sessionStatusMap.current.delete(sessionId);
  }, [sessions, onOpenChange]);

  const handleStatusChange = useCallback((sessionId: string, status: ShellSessionStatus) => {
    sessionStatusMap.current.set(sessionId, status);
    // Update displayed status if this is the active session
    setActiveSessionId((current) => {
      if (current === sessionId) {
        setActiveStatus(status);
      }
      return current;
    });
  }, []);

  // When active session changes, update displayed status
  useEffect(() => {
    const status = sessionStatusMap.current.get(activeSessionId);
    if (status) {
      setActiveStatus(status);
    }
  }, [activeSessionId]);

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

  // Fit active session on layout changes
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const handle = sessionRefsMap.current.get(activeSessionId);
      handle?.focus();
    }, 100);
    return () => clearTimeout(t);
  }, [open, heightPx, isMaximized, activeSessionId]);

  const activeHandle = sessionRefsMap.current.get(activeSessionId);
  const effectiveNamespace = activeStatus.shellStatus?.namespace || 'default';

  if (!open) return null;

  return (
    <div
      data-shell-panel
      className={cn(
        'fixed bottom-0 left-0 right-0 z-[60] flex flex-col border-t border-border bg-slate-950 shadow-[0_-4px_30px_rgba(0,0,0,0.4)] transition-[height] duration-200 ease-in-out',
        isMaximized && 'h-[calc(100vh-64px)]'
      )}
      style={isMaximized ? {} : { height: heightPx }}
      tabIndex={-1}
    >
      {/* Resize handle */}
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

      {/* Tab bar + controls */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-0">
        {/* Left: tabs */}
        <div className="flex items-center gap-0 min-w-0 overflow-x-auto scrollbar-none">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const status = sessionStatusMap.current.get(session.id);
            const isConnected = status?.connected ?? false;
            const isConnecting = status?.connecting || status?.isReconnecting;

            return (
              <button
                key={session.id}
                className={cn(
                  'group relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 shrink-0',
                  isActive
                    ? 'border-[hsl(221.2,83.2%,53.3%)] text-white/90 bg-white/[0.04]'
                    : 'border-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.03]'
                )}
                onClick={() => setActiveSessionId(session.id)}
                title={session.label}
              >
                <TerminalIcon className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[180px]">{session.label}</span>
                {/* Connection indicator dot */}
                {isConnected && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(142_76%_73%)]" />
                )}
                {isConnecting && (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                )}
                {/* Close button per tab (only if more than 1 session) */}
                {sessions.length > 1 && (
                  <span
                    role="button"
                    className={cn(
                      'ml-0.5 rounded p-0.5 transition-colors',
                      isActive
                        ? 'text-white/30 hover:text-red-400 hover:bg-white/10'
                        : 'text-white/20 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-white/10'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSession(session.id);
                    }}
                    title={`Close ${session.label}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}

          {/* New tab button */}
          <button
            className="flex items-center justify-center rounded p-1.5 text-white/30 hover:bg-white/10 hover:text-white/70 transition-colors shrink-0 ml-0.5"
            onClick={addSession}
            title="New terminal session"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right: context info + controls (for active session) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Context label */}
          <span className="text-xs text-white/50 truncate max-w-[200px] hidden sm:inline">
            <span className="text-white/80">{activeStatus.shellStatus?.context || clusterName}</span>
            <span className="text-white/30 mx-1">/</span>
            <span className="text-white/60">{effectiveNamespace}</span>
          </span>
          {activeStatus.error && (
            <span className="text-[10px] text-red-400 truncate max-w-[160px]" title={activeStatus.error}>
              {activeStatus.error}
            </span>
          )}

          {/* Control buttons */}
          <div className="flex items-center gap-0.5 shrink-0">
            {isTauri() && (
              <button
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                onClick={() => {
                  const ctx = activeStatus.shellStatus?.context || clusterName;
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
                <span>Copy kubectl context</span>
              </button>
            )}
            <button
              className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
              onClick={() => activeHandle?.reconnect()}
              title="Reconnect"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
              onClick={() => activeHandle?.clear()}
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
      </div>

      {/* Terminal area */}
      <div className="relative flex-1 min-h-0 bg-slate-950">
        {!clusterId ? (
          <div className="flex h-full items-center justify-center text-sm font-medium italic text-muted-foreground">
            Select a cluster to activate terminal.
          </div>
        ) : (
          sessions.map((session) => (
            <ShellSession
              key={session.id}
              ref={(handle) => {
                if (handle) {
                  sessionRefsMap.current.set(session.id, handle);
                } else {
                  sessionRefsMap.current.delete(session.id);
                }
              }}
              isActive={session.id === activeSessionId}
              open={open}
              clusterId={clusterId}
              clusterName={clusterName}
              backendBaseUrl={backendBaseUrl}
              onStatusChange={(status) => handleStatusChange(session.id, status)}
            />
          ))
        )}
      </div>
    </div>
  );
}
