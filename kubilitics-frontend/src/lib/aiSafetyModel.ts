/**
 * AI Safety Model — Phase 1
 *
 * Defines the two-level autonomy model for AI interactions with the cluster:
 *   Level 1 (Observe): Read-only — describe resources, explain events, read state
 *   Level 2 (Recommend): Propose actions with visual diff preview, require confirmation
 *
 * Immutable safety rules that cannot be overridden:
 *   - Cannot delete namespaces
 *   - Cannot modify anything in kube-system
 *   - Cannot scale any resource to 0 replicas
 */

// ─── Autonomy Levels ────────────────────────────────────────────────────────

export enum AIAutonomyLevel {
  /** AI can read cluster state, describe resources, and explain events. */
  Observe = 1,
  /** AI proposes actions with diff preview; user must confirm every action. */
  Recommend = 2,
}

export interface AIAutonomyLevelDefinition {
  level: AIAutonomyLevel;
  name: string;
  label: string;
  description: string;
  allowedOperations: readonly AIOperationType[];
}

export const AUTONOMY_LEVEL_DEFINITIONS: readonly AIAutonomyLevelDefinition[] = [
  {
    level: AIAutonomyLevel.Observe,
    name: 'Observe',
    label: 'Observe Only',
    description:
      'AI can read cluster state, describe resources, and explain events. No mutations are permitted.',
    allowedOperations: ['get', 'list', 'describe', 'explain', 'logs'] as const,
  },
  {
    level: AIAutonomyLevel.Recommend,
    name: 'Recommend',
    label: 'Recommend with Preview',
    description:
      'AI proposes mutations with a visual diff preview. Every action requires explicit user confirmation before execution.',
    allowedOperations: [
      'get',
      'list',
      'describe',
      'explain',
      'logs',
      'scale',
      'restart',
      'patch',
      'rollback',
      'update_limits',
    ] as const,
  },
] as const;

// ─── Operation Types ────────────────────────────────────────────────────────

export type AIOperationType =
  | 'get'
  | 'list'
  | 'describe'
  | 'explain'
  | 'logs'
  | 'scale'
  | 'restart'
  | 'patch'
  | 'rollback'
  | 'delete'
  | 'drain'
  | 'cordon'
  | 'update_limits'
  | 'hpa_scale'
  | 'create';

export const READ_ONLY_OPERATIONS: readonly AIOperationType[] = [
  'get',
  'list',
  'describe',
  'explain',
  'logs',
] as const;

export const MUTATING_OPERATIONS: readonly AIOperationType[] = [
  'scale',
  'restart',
  'patch',
  'rollback',
  'delete',
  'drain',
  'cordon',
  'update_limits',
  'hpa_scale',
  'create',
] as const;

// ─── Immutable Safety Rules ─────────────────────────────────────────────────

export interface ImmutableSafetyRule {
  id: string;
  description: string;
  /** Evaluate the rule against a proposed action. Returns null if the rule does not apply. */
  evaluate: (action: ActionProposal) => SafetyViolation | null;
}

export interface SafetyViolation {
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high';
  message: string;
  blocksExecution: true;
}

/**
 * Immutable safety rules that are always enforced regardless of autonomy level,
 * user configuration, or policy overrides. These cannot be disabled.
 */
export const IMMUTABLE_SAFETY_RULES: readonly ImmutableSafetyRule[] = [
  {
    id: 'no-delete-namespace',
    description: 'Cannot delete namespaces via AI actions',
    evaluate: (action) => {
      if (
        action.operation === 'delete' &&
        action.resourceKind.toLowerCase() === 'namespace'
      ) {
        return {
          ruleId: 'no-delete-namespace',
          ruleName: 'Namespace Deletion Protection',
          severity: 'critical',
          message: `Deleting namespace "${action.resourceName}" is permanently blocked. Namespace deletion can destroy all resources within it and is not reversible.`,
          blocksExecution: true,
        };
      }
      return null;
    },
  },
  {
    id: 'no-modify-kube-system',
    description: 'Cannot modify any resource in kube-system namespace',
    evaluate: (action) => {
      if (
        action.namespace === 'kube-system' &&
        MUTATING_OPERATIONS.includes(action.operation)
      ) {
        return {
          ruleId: 'no-modify-kube-system',
          ruleName: 'kube-system Protection',
          severity: 'critical',
          message: `Mutating "${action.resourceKind}/${action.resourceName}" in kube-system is permanently blocked. This namespace contains critical cluster components.`,
          blocksExecution: true,
        };
      }
      return null;
    },
  },
  {
    id: 'no-scale-to-zero',
    description: 'Cannot scale any resource to 0 replicas',
    evaluate: (action) => {
      if (
        action.operation === 'scale' &&
        action.proposedState?.replicas === 0
      ) {
        return {
          ruleId: 'no-scale-to-zero',
          ruleName: 'Scale-to-Zero Protection',
          severity: 'high',
          message: `Scaling "${action.resourceKind}/${action.resourceName}" to 0 replicas is blocked. This would cause a complete service outage.`,
          blocksExecution: true,
        };
      }
      return null;
    },
  },
] as const;

// ─── Action Proposal Interface ──────────────────────────────────────────────

export interface ResourceState {
  /** The resource kind (e.g. Deployment, Pod, Service). */
  kind: string;
  /** The resource name. */
  name: string;
  /** The resource namespace. */
  namespace: string;
  /** Key-value pairs representing the relevant fields of the resource. */
  fields: Record<string, unknown>;
  /** Replicas count, if applicable. */
  replicas?: number;
  /** Container images, if applicable. */
  images?: string[];
  /** Resource limits/requests, if applicable. */
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
}

export interface AffectedResource {
  kind: string;
  name: string;
  namespace: string;
  relationship: 'direct' | 'dependent' | 'upstream' | 'downstream';
  impact: 'modified' | 'disrupted' | 'restarted' | 'unavailable';
}

export type BlastRadiusLevel = 'minimal' | 'contained' | 'significant' | 'critical';

export interface BlastRadiusEstimate {
  level: BlastRadiusLevel;
  affectedResources: AffectedResource[];
  affectedPodCount: number;
  estimatedDowntimeSeconds: number;
  userFacingImpact: string;
}

export interface ActionProposal {
  /** Unique identifier for this proposal. */
  id: string;
  /** The proposed operation. */
  operation: AIOperationType;
  /** The target resource kind. */
  resourceKind: string;
  /** The target resource name. */
  resourceName: string;
  /** The target namespace. */
  namespace: string;
  /** Human-readable summary of what this action does. */
  summary: string;
  /** AI-generated reasoning for why this action is recommended. */
  reasoning: string;
  /** Current state of the resource before the action. */
  currentState: ResourceState;
  /** Proposed state of the resource after the action. */
  proposedState: ResourceState;
  /** List of all resources that would be affected. */
  blastRadius: BlastRadiusEstimate;
  /** Timestamp when the proposal was generated. */
  createdAt: string;
  /** Whether the action requires user confirmation (always true in Phase 1). */
  requiresConfirmation: true;
  /** Confidence score from the AI (0-100). */
  confidence: number;
}

export interface ActionProposalResult {
  proposal: ActionProposal;
  safetyViolations: SafetyViolation[];
  isBlocked: boolean;
  requiresConfirmation: boolean;
}

// ─── Audit Trail ────────────────────────────────────────────────────────────

export type AuditAction =
  | 'proposal_created'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'action_executed'
  | 'action_failed'
  | 'safety_violation_blocked';

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  proposalId: string;
  userId: string;
  operation: AIOperationType;
  resourceKind: string;
  resourceName: string;
  namespace: string;
  details: string;
  safetyViolations?: SafetyViolation[];
}

// ─── Safety Evaluation Functions ────────────────────────────────────────────

/**
 * Evaluate a proposed action against all immutable safety rules.
 * Returns all violations found. If any violation has blocksExecution=true,
 * the action must not proceed.
 */
export function evaluateImmutableRules(
  proposal: ActionProposal,
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  for (const rule of IMMUTABLE_SAFETY_RULES) {
    const violation = rule.evaluate(proposal);
    if (violation) {
      violations.push(violation);
    }
  }
  return violations;
}

/**
 * Check whether an operation is allowed at the given autonomy level.
 */
export function isOperationAllowed(
  level: AIAutonomyLevel,
  operation: AIOperationType,
): boolean {
  const definition = AUTONOMY_LEVEL_DEFINITIONS.find(
    (d) => d.level === level,
  );
  if (!definition) return false;
  return (definition.allowedOperations as readonly string[]).includes(
    operation,
  );
}

/**
 * Full safety evaluation: checks autonomy level, immutable rules, and
 * returns an ActionProposalResult indicating whether the action can proceed.
 */
export function evaluateActionProposal(
  proposal: ActionProposal,
  autonomyLevel: AIAutonomyLevel,
): ActionProposalResult {
  // At Observe level, all mutations are blocked
  if (!isOperationAllowed(autonomyLevel, proposal.operation)) {
    return {
      proposal,
      safetyViolations: [
        {
          ruleId: 'autonomy-level',
          ruleName: 'Autonomy Level Restriction',
          severity: 'high',
          message: `Operation "${proposal.operation}" is not permitted at autonomy level ${autonomyLevel} (${AUTONOMY_LEVEL_DEFINITIONS.find((d) => d.level === autonomyLevel)?.name ?? 'unknown'}).`,
          blocksExecution: true,
        },
      ],
      isBlocked: true,
      requiresConfirmation: true,
    };
  }

  // Evaluate immutable rules
  const violations = evaluateImmutableRules(proposal);
  const isBlocked = violations.some((v) => v.blocksExecution);

  return {
    proposal,
    safetyViolations: violations,
    isBlocked,
    // In Phase 1, all actions at Recommend level require confirmation
    requiresConfirmation: true,
  };
}

/**
 * Compute the blast radius level from the number of affected resources.
 */
export function computeBlastRadiusLevel(
  affectedResources: AffectedResource[],
): BlastRadiusLevel {
  const count = affectedResources.length;
  if (count <= 1) return 'minimal';
  if (count <= 5) return 'contained';
  if (count <= 20) return 'significant';
  return 'critical';
}

/**
 * Generate a unique proposal ID.
 */
export function generateProposalId(): string {
  return `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate an audit entry ID.
 */
export function generateAuditId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
