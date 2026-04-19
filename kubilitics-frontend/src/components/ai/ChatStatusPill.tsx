import { useAIStatus } from '@/hooks/useAIStatus';
import { useChatStore } from '@/stores/chatStore';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  variant?: 'pill' | 'dot';
}

export function ChatStatusPill({ variant = 'pill' }: Props) {
  const { data, error } = useAIStatus();
  const togglePanel = useChatStore((s) => s.togglePanel);

  // Map kubilitics-ai status states to UI state. The supervisor-era
  // 'starting' / 'crashed' states no longer exist; runtime is in-cluster
  // and either reachable (ready/degraded) or not (unavailable/error).
  const state = error ? 'unavailable' : data?.state ?? 'unknown';
  const dotClass =
    state === 'ready'
      ? 'bg-emerald-500'
      : state === 'degraded'
        ? 'bg-amber-500'
        : state === 'unavailable' || state === 'error' || error
          ? 'bg-rose-500'
          : 'bg-muted-foreground';

  const label =
    state === 'ready'
      ? 'AI Ready'
      : state === 'degraded'
        ? 'AI Degraded'
        : state === 'unavailable'
          ? 'AI Unreachable'
          : state === 'error'
            ? 'AI Error'
            : 'AI';

  if (variant === 'dot') {
    return <span className={cn('inline-block w-2 h-2 rounded-full', dotClass)} aria-label={label} />;
  }

  return (
    <button
      onClick={() => togglePanel()}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted transition-colors"
      aria-label={label}
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className={cn('inline-block w-2 h-2 rounded-full', dotClass)} />
      <span>{label}</span>
    </button>
  );
}
