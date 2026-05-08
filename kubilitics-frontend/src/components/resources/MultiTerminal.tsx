/**
 * MultiTerminal — persistent multi-session terminal manager.
 *
 * Core invariant: each container gets its own PodTerminal instance, kept
 * mounted (display:none when inactive) so xterm history and the WebSocket
 * connection survive container switches.  History is NEVER wiped by switching.
 *
 * Container switching is handled entirely here via findOrCreateSession —
 * PodTerminal is intentionally NOT passed the containers list so it can
 * never reconnect its own xterm to a different container.
 *
 * Layout:
 *   ┌─ container quick-switch (multi-container only) ──────────────────┐
 *   │  [alertmanager]  [config-reloader]                               │
 *   ├─ session tabs ────────────────────────────────────────────────────┤
 *   │  [▸ alertmanager ×]  [▸ config-reloader ×]  [+]                 │
 *   ├───────────────────────────────────────────────────────────────────┤
 *   │  terminal content (active session only visible)                   │
 *   └───────────────────────────────────────────────────────────────────┘
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
  const sessionIdCounter = useRef(0);

  const makeSession = useCallback(
    (containerName: string): TerminalSession => ({
      id: `term-${Date.now()}-${++sessionIdCounter.current}`,
      podName,
      namespace,
      containerName,
    }),
    [podName, namespace],
  );

  const [sessions, setSessions] = useState<TerminalSession[]>(() => [
    makeSession(defaultContainer),
  ]);
  const [activeId, setActiveId] = useState<string>(() => sessions[0].id);

  // Activate an existing session for this container, or create a new one.
  // This is the only place container switching happens — PodTerminal never
  // changes its own container so its xterm history is always preserved.
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
    },
    [makeSession, onContainerChange],
  );

  const closeSession = useCallback((id: string) => {
    setSessions((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((s) => s.id !== id);
      setActiveId((cur) => (cur === id ? next[next.length - 1].id : cur));
      return next;
    });
  }, []);

  const addNewSession = useCallback(
    (containerName?: string) => {
      const c = containerName || defaultContainer;
      const fresh = makeSession(c);
      setSessions((prev) => [...prev, fresh]);
      setActiveId(fresh.id);
      onContainerChange?.(c);
    },
    [makeSession, defaultContainer, onContainerChange],
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  const activeContainerName = sessions.find((s) => s.id === activeId)?.containerName ?? '';

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-700/50">

      {/* ── Container quick-switch (multi-container pods only) ────────────
          Clicking a container activates its existing session or creates one.
          History is preserved because each container has its own PodTerminal. */}
      {containers.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 border-b border-slate-700/50">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mr-1 shrink-0">
            Container
          </span>
          {containers.map((c) => {
            const isActive = c === activeContainerName;
            const hasSession = sessions.some((s) => s.containerName === c);
            return (
              <button
                key={c}
                onClick={() => findOrCreateSession(c)}
                className={cn(
                  'h-6 px-2.5 text-[11px] font-medium rounded-sm transition-all shrink-0',
                  isActive
                    ? 'bg-slate-600 text-white'
                    : hasSession
                    ? 'bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-600/40'
                    : 'text-slate-500 hover:text-white hover:bg-slate-700',
                )}
                title={hasSession ? `Switch to ${c} (session alive)` : `Open terminal for ${c}`}
              >
                {c}
                {hasSession && !isActive && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500/70 align-middle" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Session tab bar ──────────────────────────────────────────────── */}
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

        {/* New terminal / container picker */}
        <div className="relative shrink-0 ml-0.5">
          <button
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 rounded-md hover:bg-slate-800/50 transition-colors"
            title={containers.length > 1 ? 'New terminal — pick container' : 'New terminal'}
            onClick={() => containers.length > 1 ? setPickerOpen((v) => !v) : addNewSession()}
          >
            <Plus className="h-3 w-3" />
          </button>

          {pickerOpen && containers.length > 1 && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 bg-slate-900 border border-slate-700 rounded-md shadow-xl py-1 min-w-[160px]">
                <p className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  New terminal for
                </p>
                {containers.map((c) => (
                  <button
                    key={c}
                    className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                    onClick={() => { addNewSession(c); setPickerOpen(false); }}
                  >
                    <Terminal className="h-3 w-3 text-slate-500 shrink-0" />
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Terminal instances ────────────────────────────────────────────
          All sessions stay mounted. Only the active one is visible.
          Each PodTerminal is NOT passed `containers` — container switching
          is exclusively handled above via findOrCreateSession so each
          xterm never clears and history is always preserved. */}
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
