import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { toast } from '@/components/ui/sonner';
import { useChatStore, type Turn } from '@/stores/chatStore';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { useChatController } from '@/hooks/useChatController';
import { useAIReady, type AIReadyReason } from '@/hooks/useAIReady';
import { ChatHeader } from './ChatHeader';
import { ChatTranscript } from './ChatTranscript';
import { ChatInput } from './ChatInput';
import { ChatResizeHandle } from './ChatResizeHandle';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatPanelLayoutStore } from '@/stores/chatPanelLayoutStore';
import {
  BudgetExceededBanner,
  isBudgetExceededError,
} from '@/components/chat/BudgetExceededBanner';

const NOT_READY_BY_REASON: Partial<Record<AIReadyReason, { title: string; detail: string }>> = {
  not_configured: {
    title: 'AI is not configured',
    detail:
      'Pick a provider and add an API key in Settings → AI, then click Validate to turn this on.',
  },
  brain_unreachable: {
    title: 'AI is unreachable',
    detail:
      'The AI service did not respond. Check that it is running, or configure a provider in Settings.',
  },
  brain_error: {
    title: 'AI is not ready',
    detail:
      'The AI service is not in a working state. Open Settings → AI and re-validate the connection.',
  },
  loading: {
    title: 'Checking AI…',
    detail:
      'Verifying that the AI service is configured and reachable. If this stays here for more than a few seconds, configure a provider in Settings.',
  },
  // ready / degraded — falsy → chat is usable.
};

// Header is h-[60px] — drawer starts below it and fills remaining viewport
// height. Width is driven by useChatPanelLayoutStore (resizable, persisted,
// clamped). The drawer floats OVER the main content (position: fixed, no
// reserved padding in AppLayout) so dashboards stay full-width. A soft
// drop shadow + thin border give the panel its own surface; the slight
// translucency on the surface lets users sense content underneath without
// reading it — the same affordance Cursor / Claude desktop use.
function ChatDrawer({ children }: { children: React.ReactNode }) {
  const width = useChatPanelLayoutStore((s) => s.width);
  const isResizing = useChatPanelLayoutStore((s) => s.isResizing);

  return (
    <motion.aside
      key="chat-drawer"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      style={{
        width: `min(${width}px, 95vw)`,
        maxWidth: '95vw',
      }}
      className={cn(
        'fixed right-0 z-40 flex flex-col',
        // Floating overlay: solid background (no transparency on the
        // surface itself; legibility wins), a refined left border, and
        // a soft elevation shadow that visually separates it from the
        // content underneath.
        'bg-background border-l border-border/80',
        'shadow-[-12px_0_32px_-12px_rgba(0,0,0,0.18)]',
        'dark:shadow-[-16px_0_40px_-12px_rgba(0,0,0,0.55)]',
        'top-[60px] h-[calc(100vh-60px)]',
        isResizing && 'transition-none',
      )}
    >
      <ChatResizeHandle />
      {children}
    </motion.aside>
  );
}

export function ChatPanel() {
  const open = useChatStore((s) => s.panelOpen);
  const transcripts = useChatStore((s) => s.transcripts);
  const sessionByCluster = useChatStore((s) => s.sessionByCluster);
  const connectionState = useChatStore((s) => s.connectionState);
  const activeCluster = useActiveCluster();
  const clusterId = activeCluster?.id;
  const aiReady = useAIReady(clusterId);
  const { sendMessage, cancelTurn } = useChatController();

  const turns = clusterId ? transcripts[clusterId] ?? [] : [];
  const hasSession = !!(clusterId && sessionByCluster[clusterId]);
  const sessionExpired = !!(clusterId && !hasSession && turns.length > 0 &&
    turns.some((t) => t.kind === 'assistant' && t.state === 'historical'));

  const lastAssistant = [...turns].reverse().find((t) => t.kind === 'assistant') as
    | (Turn & { kind: 'assistant' })
    | undefined;
  const streaming = lastAssistant?.state === 'streaming';

  const notReady = aiReady.ready ? null : (NOT_READY_BY_REASON[aiReady.reason] ?? null);
  const inputDisabled = !clusterId || !!notReady || sessionExpired || connectionState === 'error';

  // Phase 2 / Gap 3 — when the brain trips the monthly budget cap, its
  // last error event on this turn is {code:"budget_exceeded", message}.
  // Surface the dedicated banner above the input so the user can reset
  // the cap (via the reset_budget Tauri command) without leaving chat.
  const rawBudgetError =
    lastAssistant?.state === 'error' &&
    isBudgetExceededError(lastAssistant.error?.code)
      ? lastAssistant.error
      : undefined;

  // Phase 2 / quality fix #5 — auto-clear the banner after successful reset.
  // A component-local "dismissed" flag suppresses the banner until a NEW
  // budget_exceeded event arrives on the next turn. The flag re-arms
  // whenever the error REFERENCE changes, so subsequent trips still show.
  const [dismissedError, setDismissedError] = useState<unknown>(null);
  const budgetError =
    rawBudgetError && dismissedError !== rawBudgetError ? rawBudgetError : undefined;

  const [resettingBudget, setResettingBudget] = useState(false);
  const handleResetBudget = async () => {
    if (resettingBudget) return;
    setResettingBudget(true);
    try {
      await invoke('reset_budget');
      // Unmount the banner immediately on success; a future trip will
      // re-mount because rawBudgetError will be a NEW object reference.
      setDismissedError(rawBudgetError);
      toast.success('Budget cap reset');
    } catch (e) {
      toast.error(`Reset failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResettingBudget(false);
    }
  };

  const systemNotices = useMemo(() => {
    const out: { id: string; message: string; afterIndex: number }[] = [];
    if (sessionExpired && turns.length > 0) {
      out.push({
        id: 'session-reset',
        message: 'AI restarted. Start a new chat to continue.',
        afterIndex: turns.length - 1,
      });
    }
    return out;
  }, [sessionExpired, turns.length]);

  return (
    <AnimatePresence>
      {open && (
        notReady ? (
          <ChatDrawer>
            <ChatHeader />
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="rounded-full bg-muted p-3">
                <Settings2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-base">{notReady.title}</h3>
              <p className="text-sm text-muted-foreground max-w-[340px] leading-relaxed">
                {notReady.detail}
              </p>
              <Button asChild size="sm" className="mt-2">
                <Link to="/settings/ai">Open AI Settings</Link>
              </Button>
            </div>
          </ChatDrawer>
        ) : (
          <ChatDrawer>
            <ChatHeader />
            <ChatTranscript turns={turns} systemNotices={systemNotices} />
            {budgetError && (
              <div className="px-3 pt-2">
                <BudgetExceededBanner
                  message={budgetError.message}
                  onReset={handleResetBudget}
                />
              </div>
            )}
            <ChatInput
              onSend={sendMessage}
              onStop={cancelTurn}
              disabled={inputDisabled}
              streaming={streaming}
              disabledPlaceholder={
                sessionExpired ? 'Session expired — start a new chat' :
                connectionState === 'error' ? 'Reconnecting…' :
                undefined
              }
            />
          </ChatDrawer>
        )
      )}
    </AnimatePresence>
  );
}
