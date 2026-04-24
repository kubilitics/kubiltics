import { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useAIContextStore } from '@/stores/aiContextStore';
import { useActiveCluster } from '@/stores/clusterPresenceStore';
import { ChatClient } from '@/services/ai/chatClient';
import type { ServerFrame } from '@/services/ai/protocol';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function wsUrlFor(clusterId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/v1/ai/chat?cluster_id=${encodeURIComponent(clusterId)}`;
}

export function useChatController() {
  const activeCluster = useActiveCluster();
  const clusterId = activeCluster?.id;

  const clientRef = useRef<ChatClient | null>(null);

  // Keep one client per cluster; recreate on cluster change.
  useEffect(() => {
    if (!clusterId) return;
    const onFrame = (f: ServerFrame) => handleFrame(clusterId, f);
    const onState = (s: 'idle' | 'connecting' | 'open' | 'error', err?: string) =>
      useChatStore.getState().setConnectionState(s, err);
    const c = new ChatClient(wsUrlFor(clusterId), onFrame, onState);
    clientRef.current = c;
    return () => {
      c.close();
      clientRef.current = null;
      useChatStore.getState().setConnectionState('idle');
    };
  }, [clusterId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!clusterId || !clientRef.current) return;

    // 1. Resolve context (filtered for cluster match per stale-context safeguard).
    const ctx = useAIContextStore.getState().current();
    const contextHint = ctx && ctx.cluster === clusterId ? JSON.stringify(ctx) : undefined;

    // 2. Ensure WS open.
    if (clientRef.current.state() !== 'open') {
      try {
        await clientRef.current.open();
      } catch (e) {
        console.error('[chat] failed to open WS:', e);
        return;
      }
    }

    // 3. Ensure session: read existing or create one server-side.
    let sessionId = useChatStore.getState().sessionByCluster[clusterId];
    if (!sessionId) {
      try {
        sessionId = await createSession(clusterId);
        useChatStore.getState().setSession(clusterId, sessionId);
      } catch (e) {
        console.error('[chat] createSession failed:', e);
        return;
      }
    }

    // 4. Optimistic user turn.
    const turnId = newId('turn');
    useChatStore.getState().appendUserTurn(clusterId, {
      turnId, text, contextHint, startedAt: Date.now(),
    });

    // 5. Open assistant turn placeholder.
    useChatStore.getState().appendAssistantTurn(clusterId, {
      turnId: newId('asst'),
      anchorId: turnId,
      blocks: [],
      state: 'streaming',
      startedAt: Date.now(),
    });

    // 6. Send the user_message frame.
    clientRef.current.send({
      type: 'user_message',
      payload: { text, session_id: sessionId, turn_id: turnId, context_hint: contextHint },
    });
  }, [clusterId]);

  const cancelTurn = useCallback(() => {
    if (!clusterId || !clientRef.current) return;
    const sessionId = useChatStore.getState().sessionByCluster[clusterId];
    const turns = useChatStore.getState().transcripts[clusterId] ?? [];
    const last = turns[turns.length - 1];
    if (!sessionId || !last || last.kind !== 'assistant' || last.state !== 'streaming') return;
    try {
      clientRef.current.send({
        type: 'cancel_turn',
        payload: { session_id: sessionId, turn_id: last.anchorId },
      });
    } catch (e) {
      console.error('[chat] cancel failed:', e);
    }
  }, [clusterId]);

  const newChat = useCallback(() => {
    if (!clusterId) return;
    useChatStore.getState().newChat(clusterId);
  }, [clusterId]);

  return { sendMessage, cancelTurn, newChat };
}

async function createSession(clusterId: string): Promise<string> {
  const res = await fetch('/api/v1/ai/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ focus_cluster_id: clusterId, title: '' }),
  });
  if (!res.ok) throw new Error(`createSession ${res.status}`);
  const body = await res.json();
  return body.session_id;
}

function handleFrame(clusterId: string, frame: ServerFrame): void {
  if (frame.type === 'done') {
    useChatStore.getState().finishActiveTurn(clusterId, Date.now(), undefined, {
      promptTokens: frame.payload.prompt_tokens,
      completionTokens: frame.payload.completion_tokens,
    });
    return;
  }
  if (frame.type === 'error') {
    const err = frame.payload;
    if (err.code === 'Aborted' && err.message.includes('spawn_changed')) {
      useChatStore.getState().markAllHistorical(clusterId);
      useChatStore.getState().setSession(clusterId, undefined);
      return;
    }
    useChatStore.getState().finishActiveTurn(clusterId, Date.now(), err);
    return;
  }
  useChatStore.getState().applyEventToActiveTurn(clusterId, frame);
}
