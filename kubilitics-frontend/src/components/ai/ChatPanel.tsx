import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useChatStore, type Turn } from '@/stores/chatStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useChatController } from '@/hooks/useChatController';
import { useAICapabilities } from '@/hooks/useAICapabilities';
import { useAIUserConfig } from '@/hooks/useAIUserConfig';
import { ChatHeader } from './ChatHeader';
import { ChatTranscript } from './ChatTranscript';
import { ChatInput } from './ChatInput';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const CHAT_PANEL_WIDTH_PX = 480;

/**
 * Decode an AI "not ready" state into something the user can act on.
 * Reasons come from the brain's /status (disabled_reason, last_error) via the
 * backend /api/v1/ai/capabilities endpoint. If the brain is unreachable, the
 * capabilities call itself errors and we flag it here too.
 */
type CapsShape = {
  ready?: boolean;
  state?: string;
  disabled_reason?: string;
  last_error?: string;
  capabilities?: { providers?: string[]; models?: string[] };
};

function decodeNotReady(
  capsData: CapsShape | undefined,
  capsError: unknown,
  userConfig: { isConfigured: boolean; isLoading: boolean } | undefined,
): { title: string; detail: string } | null {
  // Gate strictly on the user-visible Kubilitics Settings. Even when the
  // brain is hot (e.g. started with a dev-baked provider in its config
  // file), the chat stays disabled until the operator has explicitly
  // chosen a provider + credentials in Settings → AI and hit Save. This
  // prevents the "I never configured AI but the panel let me type"
  // regression where the brain's private config leaks into UX.
  if (userConfig && !userConfig.isLoading && !userConfig.isConfigured) {
    return {
      title: 'AI is not configured',
      detail:
        'Pick a provider and add an API key in Settings → AI, then click Validate to turn this on.',
    };
  }
  if (capsError) {
    return {
      title: 'AI is unreachable',
      detail:
        'The AI service did not respond. Check that it is running, or configure a provider in Settings.',
    };
  }
  if (!capsData) {
    // No data yet — be conservative: treat as not ready until we know.
    return {
      title: 'Checking AI…',
      detail:
        'Verifying that the AI service is configured and reachable. If this stays here for more than a few seconds, configure a provider in Settings.',
    };
  }
  if (capsData.ready === true) {
    // Belt-and-braces: ready=true but providers list is empty means the brain
    // is up with no provider configured. (Models are not always returned; only
    // the providers list is authoritative.) Treat that as not configured.
    const providers = capsData.capabilities?.providers ?? [];
    if (providers.length === 0) {
      return {
        title: 'AI is not configured',
        detail:
          'The AI service is running but has no provider configured. Pick one in Settings → AI and click Validate to turn this on.',
      };
    }
    return null;
  }

  switch (capsData.disabled_reason) {
    case 'ai_disabled':
      return { title: 'AI is disabled', detail: 'AI features are turned off in this deployment.' };
    case 'provider_not_configured':
    case 'no_api_key':
    case 'missing_api_key':
      return {
        title: 'AI is not configured',
        detail:
          'Pick a provider and add an API key in Settings → AI, then click Validate to turn this on.',
      };
    case 'connection_failed':
    case 'provider_unavailable':
      return {
        title: 'AI provider is unreachable',
        detail: capsData.last_error || 'The configured LLM provider could not be reached.',
      };
    default:
      return {
        title: 'AI is not ready',
        detail:
          capsData.last_error ||
          'Pick a provider and add an API key in Settings → AI, then click Validate to turn this on.',
      };
  }
}

export function ChatPanel() {
  const open = useChatStore((s) => s.panelOpen);
  const transcripts = useChatStore((s) => s.transcripts);
  const sessionByCluster = useChatStore((s) => s.sessionByCluster);
  const connectionState = useChatStore((s) => s.connectionState);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusterId = activeCluster?.id;
  const caps = useAICapabilities(clusterId);
  const userConfig = useAIUserConfig();
  const { sendMessage, cancelTurn } = useChatController();

  const turns = clusterId ? transcripts[clusterId] ?? [] : [];
  const hasSession = !!(clusterId && sessionByCluster[clusterId]);
  const sessionExpired = !!(clusterId && !hasSession && turns.length > 0 &&
    turns.some((t) => t.kind === 'assistant' && t.state === 'historical'));

  const lastAssistant = [...turns].reverse().find((t) => t.kind === 'assistant') as
    | (Turn & { kind: 'assistant' })
    | undefined;
  const streaming = lastAssistant?.state === 'streaming';

  const notReady = decodeNotReady(caps.data, caps.error, userConfig);
  const inputDisabled = !clusterId || !!notReady || sessionExpired || connectionState === 'error';

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
  if (notReady) {
    return (
      <aside className={cn('flex flex-col bg-background border-l')} style={{ width: CHAT_PANEL_WIDTH_PX }}>
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
          connectionState === 'error' ? 'Reconnecting…' :
          undefined
        }
      />
    </aside>
  );
}
