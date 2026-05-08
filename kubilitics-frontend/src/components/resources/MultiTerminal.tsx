/**
 * MultiTerminal — Lens-style multi-tab terminal manager.
 *
 * Each terminal session maintains its own xterm + WebSocket connection.
 * Inactive sessions stay mounted (display: none) so the connection persists.
 * When a session becomes active again, the PodTerminal's IntersectionObserver
 * triggers a refit automatically.
 *
 * Session labels stay in sync with the actual container via onContainerChange
 * interception — PodTerminal's in-header container switcher updates both the
 * WS connection and the tab label here.
 */
import { useState, useCallback, useRef } from 'react';
import { Terminal, X, Plus, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PodTerminal } from './PodTerminal';

interface TerminalSession {
  id: string;
  podName: string;
  containerName: string;
  namespace: string;
  label: string;
}

interface MultiTerminalProps {
  podName: string;
  namespace: string;
  containers: string[];
  onContainerChange?: (container: string) => void;
}

export function MultiTerminal({
  podName,
  namespace,
  containers,
  onContainerChange,
}: MultiTerminalProps) {
  const defaultContainer = containers[0] || '';
  // Track the last container picked so new sessions open on the same one
  const lastContainerRef = useRef(defaultContainer);

  const [sessions, setSessions] = useState<TerminalSession[]>(() => [
    {
      id: `term-${Date.now()}`,
      podName,
      containerName: defaultContainer,
      namespace,
      label: defaultContainer,
    },
  ]);
  const [activeSession, setActiveSession] = useState(sessions[0].id);
  const [pickerOpen, setPickerOpen] = useState(false);

  const addSession = useCallback(
    (container?: string) => {
      const c = container || lastContainerRef.current || defaultContainer;
      lastContainerRef.current = c;
      const newSession: TerminalSession = {
        id: `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        podName,
        containerName: c,
        namespace,
        label: c,
      };
      setSessions((prev) => [...prev, newSession]);
      setActiveSession(newSession.id);
      setPickerOpen(false);
      onContainerChange?.(c);
    },
    [podName, namespace, defaultContainer, onContainerChange],
  );

  const closeSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) return prev;
        if (activeSession === id) {
          setActiveSession(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeSession],
  );

  // Called when PodTerminal's in-header container switcher is used.
  // Updates the session label so the tab bar stays in sync.
  const handleContainerChange = useCallback(
    (sessionId: string, container: string) => {
      lastContainerRef.current = container;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, containerName: container, label: container }
            : s,
        ),
      );
      onContainerChange?.(container);
    },
    [onContainerChange],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-700/50">
      {/* Session tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-slate-950 border-b border-slate-700/50 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors shrink-0',
              activeSession === s.id
                ? 'bg-slate-800 text-slate-200 border border-slate-600'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
            )}
            onClick={() => setActiveSession(s.id)}
          >
            <Terminal className="h-3 w-3 shrink-0" />
            <span className="max-w-[160px] truncate">{s.label}</span>
            {sessions.length > 1 && (
              <X
                className="h-3 w-3 ml-1 opacity-60 hover:opacity-100 hover:text-red-400 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  closeSession(s.id);
                }}
              />
            )}
          </button>
        ))}

        {/* Add new terminal */}
        {containers.length > 1 ? (
          <div className="relative shrink-0">
            <button
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800/50 transition-colors"
              title="New terminal"
              onClick={() => setPickerOpen((v) => !v)}
            >
              <Plus className="h-3 w-3" />
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
            {pickerOpen && (
              <>
                {/* Backdrop to close picker */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setPickerOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1 z-50 bg-slate-900 border border-slate-700 rounded-md shadow-lg py-1 min-w-[150px]">
                  <p className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Open terminal for
                  </p>
                  {containers.map((c) => (
                    <button
                      key={c}
                      className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                      onClick={() => addSession(c)}
                    >
                      <Terminal className="h-3 w-3 text-slate-500 shrink-0" />
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800/50 shrink-0 transition-colors"
            onClick={() => addSession()}
            title="New terminal"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Terminal instances — all stay mounted, only active one is visible */}
      <div className="flex-1 min-h-0" style={{ minHeight: '400px' }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            className="h-full"
            style={{ display: activeSession === s.id ? 'flex' : 'none', flexDirection: 'column' }}
          >
            <PodTerminal
              podName={s.podName}
              containerName={s.containerName}
              namespace={s.namespace}
              containers={containers}
              onContainerChange={(c) => handleContainerChange(s.id, c)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
