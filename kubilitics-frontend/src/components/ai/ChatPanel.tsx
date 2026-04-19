import { useMemo } from 'react';
import { useChatStore, type Turn } from '@/stores/chatStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useChatController } from '@/hooks/useChatController';
import { useAICapabilities } from '@/hooks/useAICapabilities';
import { ChatHeader } from './ChatHeader';
import { ChatTranscript } from './ChatTranscript';
import { ChatInput } from './ChatInput';
import { cn } from '@/lib/utils';

export const CHAT_PANEL_WIDTH_PX = 480;

export function ChatPanel() {
  const open = useChatStore((s) => s.panelOpen);
  const transcripts = useChatStore((s) => s.transcripts);
  const sessionByCluster = useChatStore((s) => s.sessionByCluster);
  const connectionState = useChatStore((s) => s.connectionState);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusterId = activeCluster?.id;
  const caps = useAICapabilities(clusterId);
  const { sendMessage, cancelTurn } = useChatController();

  const turns = clusterId ? transcripts[clusterId] ?? [] : [];
  const hasSession = !!(clusterId && sessionByCluster[clusterId]);
  const sessionExpired = !!(clusterId && !hasSession && turns.length > 0 &&
    turns.some((t) => t.kind === 'assistant' && t.state === 'historical'));

  const lastAssistant = [...turns].reverse().find((t) => t.kind === 'assistant') as
    | (Turn & { kind: 'assistant' })
    | undefined;
  const streaming = lastAssistant?.state === 'streaming';

  const aiOff = caps.data && !caps.data.ready && caps.data.disabled_reason === 'ai_disabled';
  const inputDisabled = !clusterId || !!aiOff || sessionExpired || connectionState === 'error';

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

  if (!open) return null;
  if (aiOff) {
    return (
      <aside className={cn('flex flex-col bg-background border-l')} style={{ width: CHAT_PANEL_WIDTH_PX }}>
        <ChatHeader />
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6">
          AI is disabled in this deployment.
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn('flex flex-col bg-background border-l')}
      style={{ width: CHAT_PANEL_WIDTH_PX }}
    >
      <ChatHeader />
      <ChatTranscript turns={turns} systemNotices={systemNotices} />
      <ChatInput
        onSend={sendMessage}
        onStop={cancelTurn}
        disabled={inputDisabled}
        streaming={streaming}
        disabledPlaceholder={
          sessionExpired ? 'Session expired — start a new chat' :
          aiOff ? 'AI is disabled' :
          connectionState === 'error' ? 'Reconnecting…' :
          undefined
        }
      />
    </aside>
  );
}
