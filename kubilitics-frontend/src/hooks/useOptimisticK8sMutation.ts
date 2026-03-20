/**
 * PERF Area 5: Optimistic UI for Kubernetes mutations.
 *
 * Shows the expected result immediately (e.g., replica count changes, pod
 * disappears from list) before the server confirms. If the server responds
 * with an error, the change is reverted and an error toast is shown.
 *
 * Works by snapshotting the React Query cache before the mutation, applying
 * the optimistic change via setQueryData, then reverting on error.
 */
import { useCallback } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';

interface OptimisticDeleteOptions {
  /** Query key of the list to remove the item from */
  listQueryKey: QueryKey;
  /** UID of the resource to remove */
  uid: string;
}

interface OptimisticScaleOptions {
  /** Query key of the resource detail to update */
  detailQueryKey: QueryKey;
  /** New replica count */
  replicas: number;
}

/**
 * Returns helpers for optimistic cache manipulation.
 * Use in conjunction with existing useMutation hooks' onMutate/onError/onSettled.
 */
export function useOptimisticK8sMutation() {
  const queryClient = useQueryClient();

  /**
   * Optimistically remove a resource from a list query.
   * Returns a rollback function to call on error.
   */
  const optimisticDelete = useCallback(
    ({ listQueryKey, uid }: OptimisticDeleteOptions) => {
      // Snapshot current cache for rollback
      const previousData = queryClient.getQueryData(listQueryKey);

      // Optimistically remove the item
      queryClient.setQueryData(listQueryKey, (old: any) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.filter(
            (item: any) => item.metadata?.uid !== uid
          ),
        };
      });

      // Return rollback function
      return () => {
        queryClient.setQueryData(listQueryKey, previousData);
        toast.error('Delete failed — change reverted');
      };
    },
    [queryClient],
  );

  /**
   * Optimistically update replica count in a resource's cache entry.
   * Returns a rollback function.
   */
  const optimisticScale = useCallback(
    ({ detailQueryKey, replicas }: OptimisticScaleOptions) => {
      const previousData = queryClient.getQueryData(detailQueryKey);

      queryClient.setQueryData(detailQueryKey, (old: any) => {
        if (!old?.spec) return old;
        return {
          ...old,
          spec: { ...old.spec, replicas },
        };
      });

      return () => {
        queryClient.setQueryData(detailQueryKey, previousData);
        toast.error('Scale failed — change reverted');
      };
    },
    [queryClient],
  );

  return { optimisticDelete, optimisticScale };
}
