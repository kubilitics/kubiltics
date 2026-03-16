/**
 * useAIInvestigation — TanStack Query mutation for triggering and polling
 * AI investigations on failed/warning resources.
 *
 * Results are cached by resource key and can be shared via URL using the
 * investigation ID as a query parameter.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as aiService from '../services/aiService';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InvestigationFinding {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  details: string;
  evidence?: string;
}

export interface InvestigationRemediation {
  title: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  command?: string;
}

export interface InvestigationResult {
  rootCause: string;
  overallConfidence: number;
  findings: InvestigationFinding[];
  remediations: InvestigationRemediation[];
}

interface InvestigationProgress {
  investigationId: string;
  state: string;
  currentStep: number;
}

// ─── Query Keys ─────────────────────────────────────────────────────────────

function investigationQueryKey(
  resourceKind: string,
  resourceName: string,
  namespace: string,
) {
  return ['ai-investigation', namespace, resourceKind, resourceName] as const;
}

function investigationByIdKey(id: string) {
  return ['ai-investigation-id', id] as const;
}

// ─── Step Mapping ───────────────────────────────────────────────────────────

function stateToStep(state: string): number {
  switch (state) {
    case 'CREATED':
      return 0;
    case 'INVESTIGATING':
      return 1;
    case 'ANALYZING':
      return 2;
    case 'CONCLUDED':
      return 3;
    case 'FAILED':
    case 'CANCELLED':
      return -1;
    default:
      return 0;
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAIInvestigation(
  resourceKind: string,
  resourceName: string,
  namespace: string,
) {
  const queryClient = useQueryClient();
  const [investigationId, setInvestigationId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const queryKey = investigationQueryKey(resourceKind, resourceName, namespace);

  // Check for cached result
  const cachedResult = queryClient.getQueryData<InvestigationResult>(queryKey);

  // Check URL for shared investigation ID
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('investigation');
    if (sharedId && !investigationId) {
      setInvestigationId(sharedId);
      // Fetch the shared investigation
      pollInvestigation(sharedId);
    }
  }, []);

  // Polling function
  const pollInvestigation = useCallback(
    async (id: string) => {
      try {
        const inv = await aiService.getInvestigation(id);
        const step = stateToStep(inv.state);
        setCurrentStep(Math.max(step, 0));

        if (inv.state === 'CONCLUDED') {
          // Build result from investigation
          const investigationResult: InvestigationResult = {
            rootCause: inv.conclusion || 'Root cause could not be determined.',
            overallConfidence: inv.confidence || 0,
            findings: (inv.findings || []).map(
              (f: { statement: string; severity: string; confidence: number; evidence?: string }) => ({
                title: f.statement,
                severity: f.severity as InvestigationFinding['severity'],
                confidence: f.confidence,
                details: f.statement,
                evidence: f.evidence,
              }),
            ),
            remediations: [], // Backend can provide remediations in the future
          };

          setResult(investigationResult);
          setIsComplete(true);

          // Cache the result
          queryClient.setQueryData(queryKey, investigationResult);
          queryClient.setQueryData(investigationByIdKey(id), investigationResult);

          // Stop polling
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } else if (inv.state === 'FAILED' || inv.state === 'CANCELLED') {
          setError(
            inv.conclusion || `Investigation ${inv.state.toLowerCase()}.`,
          );
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch (err) {
        // Polling errors are non-fatal; we keep polling
      }
    },
    [queryClient, queryKey],
  );

  // Start polling when we have an investigation ID
  const startPolling = useCallback(
    (id: string) => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      // Poll every 2 seconds
      pollingRef.current = setInterval(() => pollInvestigation(id), 2000);
      // Also poll immediately
      pollInvestigation(id);
    },
    [pollInvestigation],
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // Create investigation mutation
  const createMutation = useMutation({
    mutationFn: async (description: string) => {
      const resp = await aiService.createInvestigation({
        description,
        type: 'general',
      });
      return resp;
    },
    onSuccess: (data) => {
      setInvestigationId(data.id);
      setCurrentStep(0);
      setIsComplete(false);
      setError(null);
      setResult(null);
      startPolling(data.id);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to start investigation.');
    },
  });

  const investigate = useCallback(
    (description: string) => {
      // If we have a cached result, use it
      if (cachedResult) {
        setResult(cachedResult);
        setIsComplete(true);
        setCurrentStep(3);
        return;
      }
      createMutation.mutate(description);
    },
    [createMutation, cachedResult],
  );

  return {
    investigate,
    result: result ?? cachedResult ?? null,
    currentStep,
    isInvestigating: createMutation.isPending || (!!investigationId && !isComplete && !error),
    isComplete: isComplete || !!cachedResult,
    error,
    investigationId,
  };
}
