/**
 * useAISafety — Hook managing AI autonomy levels, safety rules, and audit trail.
 *
 * Provides:
 *   - Current autonomy level (persisted to localStorage)
 *   - Immutable safety rule evaluation
 *   - In-memory audit trail for all AI actions
 *   - Helpers for evaluating proposals
 */

import { useState, useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AIAutonomyLevel,
  AUTONOMY_LEVEL_DEFINITIONS,
  IMMUTABLE_SAFETY_RULES,
  evaluateActionProposal,
  evaluateImmutableRules,
  isOperationAllowed,
  generateAuditId,
  type ActionProposal,
  type ActionProposalResult,
  type SafetyViolation,
  type AuditEntry,
  type AuditAction,
  type AIOperationType,
} from '../lib/aiSafetyModel';

// ─── Audit Trail Store (Zustand) ────────────────────────────────────────────

interface AuditTrailState {
  entries: AuditEntry[];
  addEntry: (entry: AuditEntry) => void;
  clearEntries: () => void;
}

const MAX_AUDIT_ENTRIES = 500;

const useAuditTrailStore = create<AuditTrailState>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (entry) =>
        set((state) => ({
          entries: [entry, ...state.entries].slice(0, MAX_AUDIT_ENTRIES),
        })),
      clearEntries: () => set({ entries: [] }),
    }),
    {
      name: 'kubilitics-ai-audit-trail',
    },
  ),
);

// ─── Autonomy Level Store (Zustand) ─────────────────────────────────────────

interface AutonomyLevelState {
  level: AIAutonomyLevel;
  setLevel: (level: AIAutonomyLevel) => void;
}

const useAutonomyLevelStore = create<AutonomyLevelState>()(
  persist(
    (set) => ({
      level: AIAutonomyLevel.Observe,
      setLevel: (level) => set({ level }),
    }),
    {
      name: 'kubilitics-ai-autonomy-level',
    },
  ),
);

// ─── useAISafety Hook ───────────────────────────────────────────────────────

export interface UseAISafetyReturn {
  /** Current AI autonomy level. */
  autonomyLevel: AIAutonomyLevel;
  /** Human-readable definition of the current level. */
  autonomyLevelDefinition: (typeof AUTONOMY_LEVEL_DEFINITIONS)[number];
  /** Update the autonomy level. */
  setAutonomyLevel: (level: AIAutonomyLevel) => void;
  /** All immutable safety rules. */
  immutableRules: typeof IMMUTABLE_SAFETY_RULES;
  /** Evaluate a proposal against all safety rules and the current autonomy level. */
  evaluateProposal: (proposal: ActionProposal) => ActionProposalResult;
  /** Check if an operation is allowed at the current level. */
  canPerformOperation: (operation: AIOperationType) => boolean;
  /** Log an entry to the audit trail. */
  logAuditEntry: (
    entry: Omit<AuditEntry, 'id' | 'timestamp' | 'userId'>,
  ) => void;
  /** All audit trail entries (newest first). */
  auditEntries: AuditEntry[];
  /** Clear the audit trail. */
  clearAuditTrail: () => void;
}

export function useAISafety(userId = 'default'): UseAISafetyReturn {
  const { level, setLevel } = useAutonomyLevelStore();
  const { entries, addEntry, clearEntries } = useAuditTrailStore();

  const autonomyLevelDefinition = useMemo(
    () =>
      AUTONOMY_LEVEL_DEFINITIONS.find((d) => d.level === level) ??
      AUTONOMY_LEVEL_DEFINITIONS[0],
    [level],
  );

  const evaluateProposal = useCallback(
    (proposal: ActionProposal): ActionProposalResult => {
      const result = evaluateActionProposal(proposal, level);

      // Log blocked actions automatically
      if (result.isBlocked) {
        addEntry({
          id: generateAuditId(),
          timestamp: new Date().toISOString(),
          action: 'safety_violation_blocked',
          proposalId: proposal.id,
          userId,
          operation: proposal.operation,
          resourceKind: proposal.resourceKind,
          resourceName: proposal.resourceName,
          namespace: proposal.namespace,
          details: `Blocked: ${result.safetyViolations.map((v) => v.ruleName).join(', ')}`,
          safetyViolations: result.safetyViolations,
        });
      }

      return result;
    },
    [level, userId, addEntry],
  );

  const canPerformOperation = useCallback(
    (operation: AIOperationType): boolean => {
      return isOperationAllowed(level, operation);
    },
    [level],
  );

  const logAuditEntry = useCallback(
    (entry: Omit<AuditEntry, 'id' | 'timestamp' | 'userId'>) => {
      addEntry({
        ...entry,
        id: generateAuditId(),
        timestamp: new Date().toISOString(),
        userId,
      });
    },
    [userId, addEntry],
  );

  return {
    autonomyLevel: level,
    autonomyLevelDefinition,
    setAutonomyLevel: setLevel,
    immutableRules: IMMUTABLE_SAFETY_RULES,
    evaluateProposal,
    canPerformOperation,
    logAuditEntry,
    auditEntries: entries,
    clearAuditTrail: clearEntries,
  };
}
