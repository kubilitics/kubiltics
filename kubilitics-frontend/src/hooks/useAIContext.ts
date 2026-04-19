import { useEffect } from 'react';
import { useAIContextStore, type AIContext } from '@/stores/aiContextStore';

/**
 * Page-level hook to publish "what the user is currently looking at" so the
 * chat panel can fill UserMessage.context_hint when the user opens it via
 * Cmd+I or the header pill (no explicit context).
 *
 * Usage:
 *   useAIContext({ type: 'pod', cluster, namespace, name, page: activeTab })
 *
 * Cleans up on unmount or when ctx changes.
 */
export function useAIContext(ctx: AIContext | null) {
  const setImplicit = useAIContextStore((s) => s.setImplicit);
  useEffect(() => {
    setImplicit(ctx);
    return () => setImplicit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setImplicit, ctx ? JSON.stringify(ctx) : null]);
}
