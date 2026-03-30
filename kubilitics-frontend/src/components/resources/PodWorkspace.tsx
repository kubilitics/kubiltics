/**
 * PodWorkspace — unified Terminal + File Browser workspace.
 *
 * Combines the terminal (xterm.js) and file browser into a single tabbed
 * workspace with a shared container selector. The mode toggle sits in the
 * toolbar header, keeping both tools instantly accessible without hunting
 * through menus or action dropdowns.
 */
import { useState } from 'react';
import { Terminal, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
  /** Start in file browser mode instead of terminal */
  initialMode?: 'terminal' | 'files';
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
  initialMode = 'terminal',
}: PodWorkspaceProps) {
  const [mode, setMode] = useState<'terminal' | 'files'>(initialMode);
  const [selectedContainer, setSelectedContainer] = useState(containerName);

  const handleContainerChange = (c: string) => {
    setSelectedContainer(c);
    onContainerChange?.(c);
  };

  return (
    <div className={cn('flex flex-col min-h-0 flex-1', className)}>
      {/* Mode toggle bar — sits above the terminal/browser content */}
      <div className={cn(
        'flex items-center gap-2 px-4 py-2',
        'bg-slate-900 dark:bg-slate-900 border-b border-slate-700/50',
      )}>
        {/* Mode toggle pills */}
        <div className="flex items-center bg-slate-800/80 rounded-lg p-0.5">
          <button
            onClick={() => setMode('terminal')}
            className={cn(
              'flex items-center gap-1.5 h-7 px-3 text-[12px] font-medium rounded-md transition-all duration-200',
              mode === 'terminal'
                ? 'bg-slate-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50',
            )}
          >
            <Terminal className="h-3.5 w-3.5" />
            Terminal
          </button>
          <button
            onClick={() => setMode('files')}
            className={cn(
              'flex items-center gap-1.5 h-7 px-3 text-[12px] font-medium rounded-md transition-all duration-200',
              mode === 'files'
                ? 'bg-slate-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50',
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Files
          </button>
        </div>

        {/* Container selector (shared between terminal and files) */}
        {containers.length > 1 && (
          <>
            <div className="h-4 w-px bg-slate-700/50" />
            <div className="flex items-center gap-0.5 bg-slate-800/60 rounded-md p-0.5">
              {containers.map(c => (
                <button
                  key={c}
                  onClick={() => handleContainerChange(c)}
                  className={cn(
                    'h-6 px-2.5 text-[11px] font-medium rounded-sm transition-all',
                    selectedContainer === c
                      ? 'bg-slate-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700',
                  )}
                >{c}</button>
              ))}
            </div>
          </>
        )}

        {/* Active mode indicator */}
        <span className="text-[10px] text-slate-500 ml-auto font-mono">
          {podName}:{selectedContainer}
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait">
          {mode === 'terminal' ? (
            <motion.div
              key="terminal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 flex flex-col"
            >
              <PodTerminal
                podName={podName}
                namespace={namespace}
                containerName={selectedContainer}
                containers={containers}
                onContainerChange={handleContainerChange}
                className="flex-1 min-h-0 rounded-none border-0"
              />
            </motion.div>
          ) : (
            <motion.div
              key="files"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 flex flex-col overflow-auto"
            >
              <InlineFileBrowser
                podName={podName}
                namespace={namespace}
                containerName={selectedContainer}
                baseUrl={baseUrl || ''}
                clusterId={clusterId || ''}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
