import { useAIReady, type AIReadyReason } from '@/hooks/useAIReady';
import { useChatStore } from '@/stores/chatStore';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  variant?: 'pill' | 'dot';
}

/**
 * AI status indicator in the global header.
 *
 * Reads ONLY from useAIReady — the single source of truth. Direct imports
 * of useAIStatus / useAICapabilities / useAIUserConfig are blocked by
 * scripts/check-frontend-discipline.mjs.
 *
 *   green   — AI is ready (or degraded; still usable)
 *   amber   — user has not configured a provider+key
 *   red     — brain unreachable / errored
 *   gray    — initial load only
 */
const DOT_CLASS: Record<AIReadyReason, string> = {
  ready: 'bg-emerald-500',
  degraded: 'bg-emerald-500',
  not_configured: 'bg-amber-500',
  brain_unreachable: 'bg-rose-500',
  brain_error: 'bg-rose-500',
  loading: 'bg-muted-foreground',
};

export function ChatStatusPill({ variant = 'pill' }: Props) {
  const clusterId = useActiveCluster()?.id;
  const aiReady = useAIReady(clusterId);
  const togglePanel = useChatStore((s) => s.togglePanel);

  const dotClass = DOT_CLASS[aiReady.reason];
  const label = aiReady.label;

  if (variant === 'dot') {
    return <span className={cn('inline-block w-2 h-2 rounded-full', dotClass)} aria-label={label} />;
  }

  return (
    <button
      onClick={() => togglePanel()}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted transition-colors"
      aria-label={label}
      title={aiReady.detail ? `${label} — ${aiReady.detail}` : label}
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className={cn('inline-block w-2 h-2 rounded-full', dotClass)} />
      <span>{label}</span>
    </button>
  );
}
