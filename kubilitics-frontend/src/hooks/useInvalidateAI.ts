import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * useInvalidateAI — returns an awaitable function that refetches every
 * AI-related query and resolves only when all three have completed
 * (success OR failure).
 *
 * Uses refetchQueries (not invalidateQueries) so the returned promise
 * carries the actual refetch completion. invalidateQueries would resolve
 * as soon as invalidation is *scheduled*, which is the bug today:
 * AISettingsPage's fire-and-forget refresh races against subsequent UI
 * renders.
 *
 * Uses Promise.allSettled (not Promise.all) so a transient refetch
 * failure on one query doesn't bubble up as a "save failed" error in
 * AISettingsPage — the save itself already succeeded and the next poll
 * cycle (5s) will retry any failed refetch. This hook is best-effort
 * verification, not a hard gate.
 *
 * Each refetchQueries call uses `exact: true` to avoid accidentally
 * matching prefix-extended keys a future contributor might add.
 *
 * Callers MUST `await` the returned promise before showing success state
 * to the user — that guarantee is what closes the staleness window.
 *
 * Spec: docs/superpowers/specs/2026-04-26-ai-status-single-source-design.md
 */
export function useInvalidateAI(): () => Promise<void> {
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.allSettled([
      qc.refetchQueries({ queryKey: ['ai', 'status'], exact: true }),
      qc.refetchQueries({ queryKey: ['ai', 'capabilities'], exact: true }),
      qc.refetchQueries({ queryKey: ['ai', 'user-config'], exact: true }),
    ]);
  }, [qc]);
}
