/**
 * MultiTerminal — persistent multi-session terminal manager.
 *
 * Core invariant: each session has its own PodTerminal instance, kept mounted
 * (display:none when inactive) so xterm history and the WebSocket connection
 * survive container or tab switches. History is NEVER wiped by switching.
 *
 * Container switching for multi-container pods uses findOrCreateSession:
 * clicking a container in the + picker activates its existing session (history
 * preserved) or creates a new one. PodTerminal is never passed `containers`
 * so it cannot reconnect its own xterm to a different container.
 *
 * The + picker uses position:fixed to escape the overflow:hidden outer wrapper.
 */
import { useState, useCallback, useRef } from 'react';
import { Terminal, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PodTerminal } from './PodTerminal';

interface TerminalSession {
  id: string;
  podName: string;
  containerName: string;
  namespace: string;
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
  const counter = useRef(0);

  const makeSession = (containerName: string): TerminalSession => ({
    id: `term-${Date.now()}-${++counter.current}`,
    podName,
    namespace,
    containerName,
  });

  const [sessions, setSessions] = useState<TerminalSession[]>(() => [makeSession(defaultContainer)]);
  const [activeId, setActiveId] = useState<string>(() => sessions[0].id);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Picker button position for fixed-position dropdown
  const pickerBtnRef = useRef<HTMLButtonElement>(null);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });

  // Activate an existing session for this container, or create a new one.
  // This is the ONLY way container switching happens — PodTerminal never
  // changes its own container, so xterm history is always preserved.
  const findOrCreateSession = useCallback(
    (containerName: string) => {
      setSessions((prev) => {
        const existing = prev.find((s) => s.containerName === containerName);
        if (existing) {
          setActiveId(existing.id);
          return prev;
        }
        const fresh = makeSession(containerName);
        setActiveId(fresh.id);
        return [...prev, fresh];
      });
      onContainerChange?.(containerName);
      setPickerOpen(false);
    },
    // makeSession intentionally omitted — it's stable (only uses counter ref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onContainerChange],
  );

  // Add a brand-new session (duplicate allowed — useful for side-by-side work)
  const addNewSession = useCallback(
    (containerName: string) => {
      const fresh = makeSession(containerName);
      setSessions((prev) => [...prev, fresh]);
      setActiveId(fresh.id);
      onContainerChange?.(containerName);
      setPickerOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onContainerChange],
  );

  const closeSession = useCallback((id: string) => {
    setSessions((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((s) => s.id !== id);
      setActiveId((cur) => (cur === id ? next[next.length - 1].id : cur));
      return next;
    });
  }, []);

  const openPicker = () => {
    if (!pickerBtnRef.current) return;
    const rect = pickerBtnRef.current.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 4, left: rect.left });
    setPickerOpen(true);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-700/50">

      {/* ── Single unified tab bar ─────────────────────────────────────────
          Each tab = one persistent session. Clicking a tab activates that
          session without touching any other terminal's xterm or WS. */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-slate-950 border-b border-slate-700/50 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => { setActiveId(s.id); onContainerChange?.(s.containerName); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors shrink-0',
              activeId === s.id
                ? 'bg-slate-800 text-slate-200 border border-slate-600'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
            )}
          >
            <Terminal className="h-3 w-3 shrink-0" />
            <span className="max-w-[180px] truncate">{s.containerName}</span>
            {sessions.length > 1 && (
              <X
                className="h-3 w-3 ml-1 opacity-50 hover:opacity-100 hover:text-red-400 transition-opacity"
                onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
              />
            )}
          </button>
        ))}

        {/* + button — for multi-container: opens fixed picker so overflow:hidden
            on the outer wrapper doesn't clip it. Single container: adds directly. */}
        <button
          ref={pickerBtnRef}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800/50 shrink-0 transition-colors"
          title="New terminal"
          onClick={() => containers.length > 1 ? openPicker() : addNewSession(defaultContainer)}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Fixed-position container picker — escapes overflow:hidden */}
      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-[210]" onClick={() => setPickerOpen(false)} />
          <div
            className="fixed z-[211] bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1.5 min-w-[190px]"
            style={{ top: pickerPos.top, left: pickerPos.left }}
          >
            <p className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              New terminal for
            </p>
            {containers.map((c) => {
              const hasSession = sessions.some((s) => s.containerName === c);
              return (
                <button
                  key={c}
                  className="flex items-center justify-between gap-2 w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                  onClick={() => addNewSession(c)}
                >
                  <span className="flex items-center gap-2">
                    <Terminal className="h-3 w-3 text-slate-500 shrink-0" />
                    {c}
                  </span>
                  {hasSession && (
                    <span className="text-[9px] text-slate-500 shrink-0">session alive</span>
                  )}
                </button>
              );
            })}
            {containers.length > 1 && sessions.length > 0 && (
              <>
                <div className="my-1 border-t border-slate-700/60" />
                <p className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  Switch to existing
                </p>
                {containers.map((c) => {
                  const existing = sessions.find((s) => s.containerName === c);
                  if (!existing) return null;
                  const isActive = existing.id === activeId;
                  return (
                    <button
                      key={`switch-${c}`}
                      className={cn(
                        'flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs transition-colors',
                        isActive
                          ? 'text-slate-500 cursor-default'
                          : 'text-slate-300 hover:bg-slate-800',
                      )}
                      onClick={() => !isActive && findOrCreateSession(c)}
                      disabled={isActive}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      {c}
                      {isActive && <span className="ml-auto text-[9px] text-slate-600">active</span>}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Terminal instances ─────────────────────────────────────────────
          All sessions stay mounted. Only the active one is visible.
          PodTerminal does NOT receive `containers` — container switching
          is exclusively handled by MultiTerminal so each xterm never clears. */}
      <div className="flex-1 min-h-0" style={{ minHeight: '400px' }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            className="h-full"
            style={{ display: activeId === s.id ? 'flex' : 'none', flexDirection: 'column' }}
          >
            <PodTerminal
              podName={s.podName}
              containerName={s.containerName}
              namespace={s.namespace}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
