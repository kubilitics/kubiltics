/**
 * PodWorkspace — unified Terminal + File Browser workspace.
 *
 * Adds a Terminal/Files mode toggle inside the terminal's existing header bar
 * (right after the traffic lights). No extra bars, no visual clutter.
 * The terminal header stays clean and consistent with the original design.
 */
import { useState } from 'react';
import { Terminal, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PodTerminal } from './PodTerminal';
import { InlineFileBrowser } from './InlineFileBrowser';

interface PodWorkspaceProps {
  podName: string;
  namespace: string;
  containerName: string;
  containers?: string[];
  onContainerChange?: (container: string) => void;
  baseUrl?: string;
  clusterId?: string;
  className?: string;
}

export function PodWorkspace({
  podName,
  namespace,
  containerName,
  containers = [],
  onContainerChange,
  baseUrl,
  clusterId,
  className,
}: PodWorkspaceProps) {
  const [mode, setMode] = useState<'terminal' | 'files'>('terminal');

  // Mode toggle pills — injected into PodTerminal's header via headerLeft prop
  const modeToggle = (
    <div className="flex items-center bg-slate-800/60 rounded-md p-0.5 ml-1">
      <button
        onClick={() => setMode('terminal')}
        className={cn(
          'flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded-sm transition-all',
          mode === 'terminal'
            ? 'bg-slate-600 text-white'
            : 'text-slate-400 hover:text-white hover:bg-slate-700',
        )}
      >
        <Terminal className="h-3 w-3" />
        Terminal
      </button>
      <button
        onClick={() => setMode('files')}
        className={cn(
          'flex items-center gap-1 h-6 px-2 text-[11px] font-medium rounded-sm transition-all',
          mode === 'files'
            ? 'bg-slate-600 text-white'
            : 'text-slate-400 hover:text-white hover:bg-slate-700',
        )}
      >
        <FolderOpen className="h-3 w-3" />
        Files
      </button>
    </div>
  );

  if (mode === 'files') {
    // File browser mode — keep the same terminal-style chrome around it
    return (
      <div className={cn(
        'flex flex-col rounded-xl overflow-hidden border border-slate-700/50 min-h-0 flex-1',
        className,
      )}>
        {/* Reuse terminal-style header for visual consistency */}
        <div className="bg-slate-950 border-b border-slate-700/50 px-4 py-2 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
          {modeToggle}
          {/* Container selector */}
          {containers.length > 1 && (
            <div className="flex items-center gap-0.5 ml-2 bg-slate-800/60 rounded-md p-0.5">
              {containers.map(c => (
                <button
                  key={c}
                  onClick={() => onContainerChange?.(c)}
                  className={cn(
                    'h-6 px-2.5 text-[11px] font-medium rounded-sm transition-all',
                    containerName === c
                      ? 'bg-slate-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700',
                  )}
                >{c}</button>
              ))}
            </div>
          )}
          <span className="text-xs text-slate-400 font-mono ml-auto truncate">
            {podName}:{containerName}
          </span>
        </div>
        {/* Inline file browser fills the content area */}
        <div className="flex-1 min-h-0 overflow-auto">
          <InlineFileBrowser
            podName={podName}
            namespace={namespace}
            containerName={containerName}
            baseUrl={baseUrl || ''}
            clusterId={clusterId || ''}
          />
        </div>
      </div>
    );
  }

  // Terminal mode — PodTerminal with mode toggle injected into its header
  return (
    <PodTerminal
      podName={podName}
      namespace={namespace}
      containerName={containerName}
      containers={containers}
      onContainerChange={onContainerChange}
      className={className}
      headerLeft={modeToggle}
    />
  );
}
