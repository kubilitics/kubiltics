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

  const state = error ? 'crashed' : data?.state ?? 'stopped';
  const dotClass =
    state === 'ready' ? 'bg-emerald-500' :
    state === 'starting' ? 'bg-amber-500 animate-pulse' :
    state === 'crashed' || error ? 'bg-rose-500' :
    'bg-muted-foreground';

  const label =
    state === 'ready' ? 'AI Ready' :
    state === 'starting' ? 'AI Starting…' :
    state === 'crashed' ? 'AI Crashed' :
    'AI';

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
