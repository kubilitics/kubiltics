import { useState, useCallback, useRef, useEffect } from 'react';
import * as aiService from '@/services/aiService';

// ─── Response shapes from the AI backend ─────────────────────────────────────

/** A K8s resource returned by GET /api/v1/memory/resources */
export interface AIResourceResult {
  key: string;           // "<namespace>/<kind>/<name>" or "<kind>/<name>"
  kind: string;
  name: string;
  namespace: string;
  health?: string;       // "healthy" | "warning" | "critical" | "unknown"
  labels?: Record<string, string>;
  /** Score assigned by multi-term keyword matching (higher = more relevant) */
  score?: number;
}

/** A vector-store hit returned by POST /api/v1/memory/vector/search */
export interface AIVectorResult {
  id: string;
  text: string;
  score: number;
  payload?: Record<string, unknown>;
}

export interface NaturalLanguageSearchResult {
  resources: AIResourceResult[];
  patterns: AIVectorResult[];
  isLoading: boolean;
  error: string | null;
}

const DEBOUNCE_MS = 350;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNaturalLanguageSearch(): {
  results: NaturalLanguageSearchResult;
  search: (query: string) => void;
  clear: () => void;
} {
  const [resources, setResources] = useState<AIResourceResult[]>([]);
  const [patterns, setPatterns] = useState<AIVectorResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResources([]);
      setPatterns([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Run both searches concurrently; partial failure is OK
      const [resourcesRes, patternsRes] = await Promise.allSettled([
        // 1. World-model resource search
        aiService.searchMemoryResources(query, 10),

        // 2. Semantic error-pattern search
        aiService.searchMemoryVector({ query, type: 'error_patterns', limit: 5 }),
      ]);

      if (resourcesRes.status === 'fulfilled') {
        const data = resourcesRes.value;
        // Backend returns { resources: [...], count: N }
        setResources(Array.isArray(data.resources) ? data.resources : []);
      } else {
        console.warn('[NLSearch] resources fetch failed:', resourcesRes.reason);
      }

      if (patternsRes.status === 'fulfilled') {
        const data = patternsRes.value;
        // Backend returns { results: [...], count: N }
        setPatterns(Array.isArray(data.results) ? data.results : []);
      } else {
        console.warn('[NLSearch] vector search failed:', patternsRes.reason);
      }

      // Surface a user error only when BOTH failed
      if (
        resourcesRes.status === 'rejected' &&
        patternsRes.status === 'rejected'
      ) {
        setError('AI search unavailable — check kubilitics-ai is running');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const search = useCallback(
    (query: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => doSearch(query), DEBOUNCE_MS);
    },
    [doSearch],
  );

  const clear = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setResources([]);
    setPatterns([]);
    setError(null);
    setIsLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return {
    results: { resources, patterns, isLoading, error },
    search,
    clear,
  };
}
