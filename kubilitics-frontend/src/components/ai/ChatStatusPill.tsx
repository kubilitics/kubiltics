import { useAICapabilities } from '@/hooks/useAICapabilities';
import { useAIUserConfig } from '@/hooks/useAIUserConfig';
import { useChatStore } from '@/stores/chatStore';
import { useClusterStore } from '@/stores/clusterStore';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  variant?: 'pill' | 'dot';
}

/**
 * AI status indicator in the global header.
 *
 * Historically this hook derived state from /api/v1/ai/status which
 * returned `{"state": ""}` when the brain was up but hadn't pushed a
 * ready event yet — leaving the dot gray even after the chat itself
 * was working. That was the bug the user flagged: "I can't tell if AI
 * is connected or not."
 *
 * New semantics — same source of truth as ChatPanel so dot + panel
 * always agree:
 *   green   — user saved config AND brain capabilities report ready
 *   amber   — brain is ready but user hasn't configured in Settings
 *             (chat input is gated; dot tells them why at a glance)
 *   red     — brain unreachable / capabilities error
 *   gray    — still loading on first render only
 */
export function ChatStatusPill({ variant = 'pill' }: Props) {
  const clusterId = useClusterStore((s) => s.activeCluster?.id);
  const caps = useAICapabilities(clusterId);
  const userConfig = useAIUserConfig();
  const togglePanel = useChatStore((s) => s.togglePanel);

  type State = 'ready' | 'not_configured' | 'unreachable' | 'loading';
  let state: State;
  if (caps.isLoading || userConfig.isLoading) {
    state = 'loading';
  } else if (caps.error) {
    state = 'unreachable';
  } else if (!userConfig.isConfigured) {
    state = 'not_configured';
  } else if (caps.data?.ready) {
    state = 'ready';
  } else {
    state = 'unreachable';
  }

  const dotClass = {
    ready: 'bg-emerald-500',
    not_configured: 'bg-amber-500',
    unreachable: 'bg-rose-500',
    loading: 'bg-muted-foreground',
  }[state];

  const label = {
    ready: 'AI Ready',
    not_configured: 'AI Not Configured',
    unreachable: 'AI Unreachable',
    loading: 'AI',
  }[state];

  if (variant === 'dot') {
    return <span className={cn('inline-block w-2 h-2 rounded-full', dotClass)} aria-label={label} />;
  }

  return (
    <button
      onClick={() => togglePanel()}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted transition-colors"
      aria-label={label}
      title={label}
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className={cn('inline-block w-2 h-2 rounded-full', dotClass)} />
      <span>{label}</span>
    </button>
  );
}
