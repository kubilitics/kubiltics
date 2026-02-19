/**
 * useWizardAISuggestions — E-PLAT-006
 *
 * Hook for AI-powered resource suggestion and validation in creation wizards.
 *
 * Endpoints consumed:
 *   POST /api/v1/wizards/suggest   — get CPU/memory/replica suggestions for an image
 *   POST /api/v1/wizards/validate  — detect misconfigurations in a resource spec
 */

import { useState, useCallback } from 'react';
import { AI_BASE_URL } from '@/services/aiService';
import { guardAIAvailable } from '@/stores/aiAvailableStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResourceSuggestion {
  cpu_request: string;
  cpu_limit: string;
  memory_request: string;
  memory_limit: string;
  replicas: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'heuristic' | 'llm' | 'default';
}

export interface CostEstimate {
  monthly_cpu_cost_usd: number;
  monthly_mem_cost_usd: number;
  monthly_total_usd: number;
  replicas: number;
}

export interface WizardSuggestion {
  suggestion: ResourceSuggestion;
  rationale: string;
  similar_images?: string[];
  cost_estimate?: CostEstimate;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  field: string;
  message: string;
  fix: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  score: number;
  summary: string;
}

export interface ContainerSpec {
  name: string;
  image: string;
  cpu: string;
  memory: string;
  port: string;
  has_probes?: boolean;
  run_as_root?: boolean;
}

// ─── Hook: useWizardAISuggestions ─────────────────────────────────────────────

export function useWizardAISuggestions() {
  const [suggestion, setSuggestion] = useState<WizardSuggestion | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch AI resource suggestions for a container image.
   */
  const suggest = useCallback(async (params: {
    image: string;
    namespace?: string;
    replicas?: number;
    workloadType?: string;
    existingCpu?: string;
    existingMemory?: string;
  }) => {
    if (!params.image?.trim()) return;
    try {
      guardAIAvailable();
    } catch {
      setError('AI backend is not available.');
      return null;
    }
    setSuggesting(true);
    setError(null);
    setSuggestion(null);
    try {
      const res = await fetch(`${AI_BASE_URL}/api/v1/wizards/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: params.image,
          namespace: params.namespace ?? 'default',
          replicas: params.replicas ?? 0,
          workload_type: params.workloadType ?? '',
          existing_cpu: params.existingCpu ?? '',
          existing_memory: params.existingMemory ?? '',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WizardSuggestion = await res.json();
      setSuggestion(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSuggesting(false);
    }
  }, []);

  /**
   * Validate a resource spec against best practices.
   */
  const validate = useCallback(async (params: {
    resourceKind: string;
    containers: ContainerSpec[];
    replicas: number;
    namespace: string;
  }) => {
    try {
      guardAIAvailable();
    } catch {
      setError('AI backend is not available.');
      setValidating(false);
      return null;
    }
    setValidating(true);
    setError(null);
    setValidation(null);
    try {
      const res = await fetch(`${AI_BASE_URL}/api/v1/wizards/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource_kind: params.resourceKind,
          containers: params.containers,
          replicas: params.replicas,
          namespace: params.namespace,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ValidationResult = await res.json();
      setValidation(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setValidating(false);
    }
  }, []);

  const clear = useCallback(() => {
    setSuggestion(null);
    setValidation(null);
    setError(null);
  }, []);

  return {
    suggestion,
    validation,
    suggesting,
    validating,
    error,
    suggest,
    validate,
    clear,
  };
}
