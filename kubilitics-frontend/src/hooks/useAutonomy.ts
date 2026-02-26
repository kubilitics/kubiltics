import { useState, useCallback, useEffect } from 'react';
import * as aiService from '../services/aiService';
import {
  SafetyRule,
  SafetyPolicy,
  SafetyEvaluationResult,
  SafetyAction,
  NamespaceOverride,
  PendingApproval
} from '../services/aiService';

export {
  type SafetyRule,
  type SafetyPolicy,
  type SafetyEvaluationResult,
  type SafetyAction,
  type NamespaceOverride,
  type PendingApproval
};

// Autonomy level definitions matching backend
export const AUTONOMY_LEVELS = [
  {
    level: 0,
    name: 'Observatory',
    label: 'Observe Only',
    description: 'Read-only mode. No actions allowed — observe and report.',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    icon: '👁',
  },
  {
    level: 1,
    name: 'Recommend',
    label: 'Recommendations',
    description: 'AI suggests actions. Safe operations (restarts) are auto-executed; risky ones require your approval.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: '💡',
  },
  {
    level: 2,
    name: 'Propose',
    label: 'Semi-Autonomous',
    description: 'Scale and rollback auto-execute. Destructive operations (delete, drain) require approval.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    icon: '🤖',
  },
  {
    level: 3,
    name: 'ActWithGuard',
    label: 'Act with Guard',
    description: 'Most operations auto-execute. Only drain and delete require human approval.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: '⚡',
  },
  {
    level: 4,
    name: 'FullAutonomous',
    label: 'Full Autonomous',
    description: 'All policy-approved operations execute automatically. Use with extreme caution.',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: '🔥',
  },
] as const;

// ─── useImmutableRules ────────────────────────────────────────────────────────

export function useImmutableRules() {
  const [rules, setRules] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiService.getSafetyRules();
      const arr = Array.isArray(data)
        ? (data as string[])
        : ((data as { rules: string[] }).rules ?? []);
      setRules(arr);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { rules, loading, error, reload: load };
}

// ─── useSafetyPolicies ────────────────────────────────────────────────────────

export function useSafetyPolicies() {
  const [policies, setPolicies] = useState<SafetyPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiService.getSafetyPolicies();
      const arr = Array.isArray(data)
        ? (data as SafetyPolicy[])
        : ((data as { policies: SafetyPolicy[] }).policies ?? []);
      setPolicies(arr);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createPolicy = useCallback(async (policy: SafetyPolicy) => {
    setSaving(true);
    try {
      await aiService.createSafetyPolicy(policy);
      await load();
    } finally {
      setSaving(false);
    }
  }, [load]);

  const deletePolicy = useCallback(async (name: string) => {
    setSaving(true);
    try {
      await aiService.deleteSafetyPolicy(name);
      await load();
    } finally {
      setSaving(false);
    }
  }, [load]);

  return { policies, loading, error, saving, createPolicy, deletePolicy, reload: load };
}

// ─── useAutonomyLevel ─────────────────────────────────────────────────────────

export function useAutonomyLevel(userID = 'default') {
  const [level, setLevelState] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiService.getAutonomyLevel(userID);
      setLevelState(data.level ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => { load(); }, [load]);

  const setLevel = useCallback(async (newLevel: number) => {
    setSaving(true);
    setError(null);
    try {
      await aiService.setAutonomyLevel(userID, newLevel);
      setLevelState(newLevel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [userID]);

  return { level, loading, error, saving, setLevel, reload: load };
}

// ─── useSafetyEvaluate ────────────────────────────────────────────────────────

export function useSafetyEvaluate() {
  const [result, setResult] = useState<SafetyEvaluationResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluate = useCallback(async (action: SafetyAction) => {
    setEvaluating(true);
    setError(null);
    setResult(null);
    try {
      const data = await aiService.safetyEvaluate({
        action: action.operation,
        context: action as unknown as Record<string, unknown>,
      });
      setResult(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setEvaluating(false);
    }
  }, []);

  return { result, evaluating, error, evaluate };
}

// ─── Namespace overrides ──────────────────────────────────────────────────────

export function useNamespaceOverrides(userID = 'default') {
  const [overrides, setOverrides] = useState<NamespaceOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiService.getNamespaceOverrides(userID);
      setOverrides(Array.isArray(data.overrides) ? data.overrides : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => { load(); }, [load]);

  const upsert = useCallback(async (namespace: string, level: number) => {
    setSaving(true);
    setError(null);
    try {
      await aiService.upsertNamespaceOverride(userID, namespace, level);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [userID, load]);

  const remove = useCallback(async (namespace: string) => {
    setSaving(true);
    setError(null);
    try {
      await aiService.deleteNamespaceOverride(userID, namespace);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [userID, load]);

  return { overrides, loading, error, saving, upsert, remove, reload: load };
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export function useApprovals(userID = 'default', autoRefreshMs = 15_000) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiService.listApprovals(userID);
      const list = Array.isArray(data.approvals) ? data.approvals : [];
      setApprovals(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => {
    load();
    if (autoRefreshMs > 0) {
      const id = setInterval(load, autoRefreshMs);
      return () => clearInterval(id);
    }
  }, [load, autoRefreshMs]);

  const approve = useCallback(async (actionID: string) => {
    setActing(true);
    setError(null);
    try {
      await aiService.approveAction(actionID, userID);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }, [userID, load]);

  const reject = useCallback(async (actionID: string) => {
    setActing(true);
    setError(null);
    try {
      await aiService.rejectAction(actionID, userID);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }, [userID, load]);

  const pendingCount = approvals.filter(a => a.status === 'pending').length;

  return { approvals, pendingCount, loading, error, acting, approve, reject, reload: load };
}
