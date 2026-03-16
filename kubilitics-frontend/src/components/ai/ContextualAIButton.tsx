/**
 * ContextualAIButton — "Ask AI" button for every resource detail page
 *
 * TASK-AI-002: Contextual AI Buttons
 * Makes AI accessible from every resource page with pre-populated context.
 */

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Bot, Sparkles, X, ChevronRight, MessageSquare, Zap, Search, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAIStatus } from '@/hooks/useAIStatus';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResourceContext {
  kind: string;
  name: string;
  namespace?: string;
  status?: string;
  /** Additional context (labels, annotations, recent events, etc.) */
  metadata?: Record<string, string>;
}

interface SuggestedPrompt {
  label: string;
  prompt: string;
  icon: React.ElementType;
}

// ─── Suggested Prompts per Resource Kind ─────────────────────────────────────

function getSuggestedPrompts(kind: string, name: string, status?: string): SuggestedPrompt[] {
  const common: SuggestedPrompt[] = [
    { label: 'What depends on this?', prompt: `What resources depend on ${kind}/${name}?`, icon: Search },
    { label: 'Show me the YAML', prompt: `Explain the YAML configuration of ${kind}/${name}`, icon: MessageSquare },
  ];

  const kindLower = kind.toLowerCase();

  if (kindLower === 'pod') {
    const prompts: SuggestedPrompt[] = [];
    if (status && ['error', 'failed', 'crashloopbackoff', 'imagepullbackoff'].includes(status.toLowerCase())) {
      prompts.push({ label: 'Why is this failing?', prompt: `Why is pod ${name} failing? Current status: ${status}`, icon: Zap });
    }
    prompts.push(
      { label: 'Check resource usage', prompt: `What is the CPU and memory usage of pod ${name}?`, icon: RefreshCw },
      ...common
    );
    return prompts;
  }

  if (['deployment', 'statefulset', 'daemonset'].includes(kindLower)) {
    return [
      { label: 'How to scale this?', prompt: `What's the best strategy to scale ${kind}/${name}?`, icon: Zap },
      { label: 'Check health', prompt: `Is ${kind}/${name} healthy? Check replicas, pod status, and recent events.`, icon: RefreshCw },
      ...common,
    ];
  }

  if (kindLower === 'service') {
    return [
      { label: 'Which pods does this target?', prompt: `Which pods does service ${name} route traffic to?`, icon: Search },
      { label: 'Check endpoints', prompt: `Are the endpoints for service ${name} healthy?`, icon: RefreshCw },
      ...common,
    ];
  }

  if (['configmap', 'secret'].includes(kindLower)) {
    return [
      { label: 'Who uses this?', prompt: `Which pods and deployments mount or reference ${kind}/${name}?`, icon: Search },
      ...common,
    ];
  }

  if (kindLower === 'node') {
    return [
      { label: 'Check capacity', prompt: `What is the resource utilization on node ${name}?`, icon: RefreshCw },
      { label: 'What runs here?', prompt: `List all pods running on node ${name} grouped by namespace`, icon: Search },
      ...common,
    ];
  }

  return common;
}

// ─── AI Side Panel ───────────────────────────────────────────────────────────

function AISidePanel({
  resource,
  onClose,
  onSubmitPrompt,
}: {
  resource: ResourceContext;
  onClose: () => void;
  onSubmitPrompt: (prompt: string) => void;
}) {
  const [customPrompt, setCustomPrompt] = useState('');
  const suggestedPrompts = getSuggestedPrompts(resource.kind, resource.name, resource.status);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (customPrompt.trim()) {
        onSubmitPrompt(customPrompt.trim());
        setCustomPrompt('');
      }
    },
    [customPrompt, onSubmitPrompt]
  );

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        'fixed right-0 top-0 bottom-0 w-[400px] max-w-[90vw] z-50',
        'bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800',
        'shadow-2xl dark:shadow-slate-950/50',
        'flex flex-col'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 dark:from-violet-500/20 dark:to-blue-500/20">
            <Bot className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI Assistant</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {resource.kind}/{resource.name}
              {resource.namespace && ` in ${resource.namespace}`}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close AI panel"
        >
          <X className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        </button>
      </div>

      {/* Context Badge */}
      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">Context:</span>
          <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 font-medium">
            {resource.kind}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium">
            {resource.name}
          </span>
          {resource.status && (
            <span className={cn(
              'px-2 py-0.5 rounded-full font-medium',
              resource.status.toLowerCase() === 'running'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                : resource.status.toLowerCase() === 'error' || resource.status.toLowerCase() === 'failed'
                  ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
            )}>
              {resource.status}
            </span>
          )}
        </div>
      </div>

      {/* Suggested Prompts */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
          Suggested Questions
        </h4>
        <div className="space-y-2">
          {suggestedPrompts.map((prompt, i) => {
            const Icon = prompt.icon;
            return (
              <button
                key={i}
                onClick={() => onSubmitPrompt(prompt.prompt)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200',
                  'bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800',
                  'border border-slate-200/60 dark:border-slate-700/40 hover:border-primary/30',
                  'text-sm text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100',
                  'group'
                )}
              >
                <Icon className="h-4 w-4 text-slate-400 dark:text-slate-500 group-hover:text-primary shrink-0" />
                <span className="flex-1">{prompt.label}</span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 group-hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Prompt Input */}
      <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={`Ask about ${resource.kind}/${resource.name}...`}
            className={cn(
              'flex-1 px-4 py-2.5 rounded-xl text-sm',
              'bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
              'text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500',
              'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40'
            )}
            aria-label="Custom AI prompt"
          />
          <button
            type="submit"
            disabled={!customPrompt.trim()}
            className={cn(
              'p-2.5 rounded-xl transition-all duration-200',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            aria-label="Send prompt"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </form>
      </div>
    </motion.div>
  );
}

// ─── AI Setup Inline Wizard ──────────────────────────────────────────────────

function AISetupInline({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className={cn(
        'absolute right-0 top-full mt-2 w-80 z-50',
        'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700',
        'rounded-xl shadow-xl dark:shadow-slate-950/50 p-5'
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl bg-violet-100 dark:bg-violet-900/30">
          <Bot className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Set Up AI</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Configure an AI provider to get started</p>
        </div>
        <button onClick={onClose} className="ml-auto p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">
          <X className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>

      <a
        href="/settings/ai"
        className={cn(
          'flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-medium',
          'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors'
        )}
      >
        <Sparkles className="h-4 w-4" />
        Configure AI Provider
      </a>
    </motion.div>
  );
}

// ─── Main Button Component ───────────────────────────────────────────────────

export interface ContextualAIButtonProps {
  /** Resource context for AI */
  resource: ResourceContext;
  /** Callback when user submits a prompt */
  onSubmitPrompt?: (prompt: string) => void;
  /** Button size */
  size?: 'sm' | 'md';
  /** Additional className */
  className?: string;
}

/**
 * ContextualAIButton — "Ask AI" button for resource detail page headers.
 *
 * @example
 * <ContextualAIButton
 *   resource={{ kind: 'Deployment', name: 'nginx', namespace: 'default', status: 'Running' }}
 *   onSubmitPrompt={(prompt) => aiChat.send(prompt)}
 * />
 */
export function ContextualAIButton({
  resource,
  onSubmitPrompt,
  size = 'md',
  className,
}: ContextualAIButtonProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const aiStatus = useAIStatus();

  const handleClick = useCallback(() => {
    if (aiStatus.status === 'unconfigured') {
      setShowSetup(true);
    } else {
      setIsPanelOpen(true);
    }
  }, [aiStatus.status]);

  const handleSubmit = useCallback(
    (prompt: string) => {
      onSubmitPrompt?.(prompt);
    },
    [onSubmitPrompt]
  );

  const sizeClasses = size === 'sm'
    ? 'px-2.5 py-1.5 text-xs gap-1.5'
    : 'px-4 py-2 text-sm gap-2';

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={handleClick}
        className={cn(
          'inline-flex items-center font-medium rounded-xl transition-all duration-200',
          'bg-gradient-to-r from-violet-500/10 to-blue-500/10 dark:from-violet-500/20 dark:to-blue-500/20',
          'text-violet-700 dark:text-violet-300',
          'border border-violet-200/60 dark:border-violet-800/40',
          'hover:from-violet-500/15 hover:to-blue-500/15 dark:hover:from-violet-500/25 dark:hover:to-blue-500/25',
          'hover:border-violet-300/60 dark:hover:border-violet-700/60',
          'focus:outline-none focus:ring-2 focus:ring-violet-500/30',
          sizeClasses
        )}
        aria-label="Ask AI about this resource"
      >
        <Bot className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        <span>Ask AI</span>
      </button>

      <AnimatePresence>
        {showSetup && (
          <AISetupInline onClose={() => setShowSetup(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isPanelOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40"
              onClick={() => setIsPanelOpen(false)}
            />
            <AISidePanel
              resource={resource}
              onClose={() => setIsPanelOpen(false)}
              onSubmitPrompt={handleSubmit}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
