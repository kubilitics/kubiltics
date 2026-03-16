/**
 * AISafetyGuard — Wraps AI action execution with safety checks, visual diff
 * preview, and explicit user confirmation.
 *
 * All AI actions are logged to an in-memory audit trail (accessible via
 * the useAISafety hook).
 */

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Eye,
  ArrowRight,
  Zap,
  Lock,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import {
  type ActionProposal,
  type ActionProposalResult,
  type SafetyViolation,
  type AffectedResource,
  type BlastRadiusLevel,
  evaluateActionProposal,
  AIAutonomyLevel,
} from '../../lib/aiSafetyModel';
import { useAISafety } from '../../hooks/useAISafety';

// ─── Blast Radius Badge ─────────────────────────────────────────────────────

function BlastRadiusBadge({ level }: { level: BlastRadiusLevel }) {
  const config: Record<
    BlastRadiusLevel,
    { bg: string; text: string; border: string }
  > = {
    minimal: {
      bg: 'bg-green-500/10',
      text: 'text-green-400',
      border: 'border-green-500/30',
    },
    contained: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/30',
    },
    significant: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
    },
    critical: {
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      border: 'border-red-500/30',
    },
  };
  const c = config[level];
  return (
    <span
      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${c.bg} ${c.text} ${c.border}`}
    >
      {level}
    </span>
  );
}

// ─── Diff Line ──────────────────────────────────────────────────────────────

function DiffLine({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  const changed = before !== after;
  return (
    <div className="grid grid-cols-[120px_1fr_20px_1fr] gap-2 items-center text-[11px] py-1">
      <span className="text-slate-500 font-medium truncate">{label}</span>
      <span
        className={`font-mono px-1.5 py-0.5 rounded ${changed ? 'bg-red-500/10 text-red-300 line-through' : 'text-slate-400'}`}
      >
        {before}
      </span>
      {changed ? (
        <ArrowRight className="h-3 w-3 text-blue-400 mx-auto" />
      ) : (
        <span className="text-slate-700 text-center">=</span>
      )}
      <span
        className={`font-mono px-1.5 py-0.5 rounded ${changed ? 'bg-green-500/10 text-green-300' : 'text-slate-400'}`}
      >
        {after}
      </span>
    </div>
  );
}

// ─── Visual Diff Preview ────────────────────────────────────────────────────

function DiffPreview({ proposal }: { proposal: ActionProposal }) {
  const currentFields = proposal.currentState.fields;
  const proposedFields = proposal.proposedState.fields;

  const allKeys = useMemo(() => {
    const keys = new Set([
      ...Object.keys(currentFields),
      ...Object.keys(proposedFields),
    ]);
    return Array.from(keys).sort();
  }, [currentFields, proposedFields]);

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/40 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-[11px] font-semibold text-slate-300">
            Diff Preview
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-red-400">Before</span>
          <span className="text-green-400">After</span>
        </div>
      </div>

      {/* Resource header */}
      <div className="px-3 py-2 border-b border-slate-800/50">
        <div className="text-[10px] text-slate-500">
          {proposal.namespace}/{proposal.resourceKind}/{proposal.resourceName}
        </div>
      </div>

      {/* Diff lines */}
      <div className="px-3 py-1 divide-y divide-slate-800/30">
        {proposal.currentState.replicas !== undefined && (
          <DiffLine
            label="replicas"
            before={String(proposal.currentState.replicas)}
            after={String(proposal.proposedState.replicas ?? proposal.currentState.replicas)}
          />
        )}
        {allKeys.map((key) => (
          <DiffLine
            key={key}
            label={key}
            before={String(currentFields[key] ?? '(none)')}
            after={String(proposedFields[key] ?? '(none)')}
          />
        ))}
        {proposal.currentState.images &&
          proposal.proposedState.images &&
          JSON.stringify(proposal.currentState.images) !==
            JSON.stringify(proposal.proposedState.images) && (
            <DiffLine
              label="images"
              before={proposal.currentState.images.join(', ')}
              after={proposal.proposedState.images.join(', ')}
            />
          )}
      </div>
    </div>
  );
}

// ─── Affected Resources List ────────────────────────────────────────────────

function AffectedResourcesList({
  resources,
}: {
  resources: AffectedResource[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (resources.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/50">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-[11px] font-semibold text-slate-300">
            Affected Resources ({resources.length})
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 space-y-1">
              {resources.map((r, i) => (
                <div
                  key={`${r.kind}-${r.name}-${i}`}
                  className="flex items-center gap-2 text-[10px]"
                >
                  <span className="text-slate-500">{r.kind}</span>
                  <span className="text-slate-300 font-mono">
                    {r.namespace}/{r.name}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1 py-0 ml-auto"
                  >
                    {r.impact}
                  </Badge>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Safety Violations Display ──────────────────────────────────────────────

function SafetyViolationsDisplay({
  violations,
}: {
  violations: SafetyViolation[];
}) {
  if (violations.length === 0) return null;

  return (
    <div className="space-y-2">
      {violations.map((v) => (
        <motion.div
          key={v.ruleId}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          className={`rounded-lg border p-3 ${
            v.severity === 'critical'
              ? 'border-red-500/40 bg-red-500/10'
              : 'border-orange-500/40 bg-orange-500/10'
          }`}
        >
          <div className="flex items-start gap-2">
            <Lock className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px] font-semibold text-red-300">
                  {v.ruleName}
                </span>
                <Badge
                  variant="destructive"
                  className="text-[9px] px-1 py-0"
                >
                  {v.severity}
                </Badge>
              </div>
              <p className="text-[10px] text-red-200/80 leading-relaxed">
                {v.message}
              </p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ─── AISafetyGuard (main component) ─────────────────────────────────────────

interface AISafetyGuardProps {
  /** The action proposal to evaluate and optionally execute. */
  proposal: ActionProposal;
  /** Called when the user explicitly approves the action. */
  onApprove: (proposal: ActionProposal) => Promise<void>;
  /** Called when the user rejects the action. */
  onReject: (proposal: ActionProposal) => void;
  /** Current AI autonomy level. */
  autonomyLevel?: AIAutonomyLevel;
  /** Additional CSS class names. */
  className?: string;
}

export function AISafetyGuard({
  proposal,
  onApprove,
  onReject,
  autonomyLevel = AIAutonomyLevel.Recommend,
  className = '',
}: AISafetyGuardProps) {
  const [executing, setExecuting] = useState(false);
  const [executed, setExecuted] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const { logAuditEntry } = useAISafety();

  // Evaluate the proposal against safety rules
  const evaluation: ActionProposalResult = useMemo(
    () => evaluateActionProposal(proposal, autonomyLevel),
    [proposal, autonomyLevel],
  );

  const handleApprove = useCallback(async () => {
    if (evaluation.isBlocked) return;
    setExecuting(true);
    setExecuteError(null);

    logAuditEntry({
      action: 'proposal_approved',
      proposalId: proposal.id,
      operation: proposal.operation,
      resourceKind: proposal.resourceKind,
      resourceName: proposal.resourceName,
      namespace: proposal.namespace,
      details: `User approved: ${proposal.summary}`,
    });

    try {
      await onApprove(proposal);
      setExecuted(true);
      logAuditEntry({
        action: 'action_executed',
        proposalId: proposal.id,
        operation: proposal.operation,
        resourceKind: proposal.resourceKind,
        resourceName: proposal.resourceName,
        namespace: proposal.namespace,
        details: `Action executed successfully: ${proposal.summary}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExecuteError(msg);
      logAuditEntry({
        action: 'action_failed',
        proposalId: proposal.id,
        operation: proposal.operation,
        resourceKind: proposal.resourceKind,
        resourceName: proposal.resourceName,
        namespace: proposal.namespace,
        details: `Action failed: ${msg}`,
      });
    } finally {
      setExecuting(false);
    }
  }, [evaluation.isBlocked, proposal, onApprove, logAuditEntry]);

  const handleReject = useCallback(() => {
    logAuditEntry({
      action: 'proposal_rejected',
      proposalId: proposal.id,
      operation: proposal.operation,
      resourceKind: proposal.resourceKind,
      resourceName: proposal.resourceName,
      namespace: proposal.namespace,
      details: `User rejected: ${proposal.summary}`,
    });
    onReject(proposal);
  }, [proposal, onReject, logAuditEntry]);

  // Log safety violations
  if (evaluation.safetyViolations.length > 0) {
    // Violations are logged in the evaluation, not on every render
  }

  return (
    <div
      className={`rounded-xl border bg-slate-900 overflow-hidden ${
        evaluation.isBlocked
          ? 'border-red-500/40'
          : executed
            ? 'border-green-500/40'
            : 'border-slate-700'
      } ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
        {evaluation.isBlocked ? (
          <ShieldAlert className="h-5 w-5 text-red-400" />
        ) : executed ? (
          <ShieldCheck className="h-5 w-5 text-green-400" />
        ) : (
          <Shield className="h-5 w-5 text-blue-400" />
        )}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-slate-200">
            {evaluation.isBlocked
              ? 'Action Blocked'
              : executed
                ? 'Action Executed'
                : 'Review Proposed Action'}
          </h4>
          <p className="text-[10px] text-slate-500 truncate">
            {proposal.operation} {proposal.resourceKind}/{proposal.resourceName}{' '}
            in {proposal.namespace}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BlastRadiusBadge level={proposal.blastRadius.level} />
          <span className="text-[10px] text-slate-500">
            {proposal.confidence}% conf.
          </span>
        </div>
      </div>

      <ScrollArea className="max-h-[500px]">
        <div className="p-4 space-y-4">
          {/* Summary and Reasoning */}
          <div>
            <p className="text-[12px] text-slate-200 font-medium leading-relaxed">
              {proposal.summary}
            </p>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              {proposal.reasoning}
            </p>
          </div>

          {/* Safety Violations */}
          <SafetyViolationsDisplay violations={evaluation.safetyViolations} />

          {/* Diff Preview */}
          {!evaluation.isBlocked && <DiffPreview proposal={proposal} />}

          {/* Affected Resources */}
          <AffectedResourcesList
            resources={proposal.blastRadius.affectedResources}
          />

          {/* Blast radius summary */}
          {proposal.blastRadius.estimatedDowntimeSeconds > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Estimated downtime: {proposal.blastRadius.estimatedDowntimeSeconds}s
                affecting {proposal.blastRadius.affectedPodCount} pod(s).{' '}
                {proposal.blastRadius.userFacingImpact}
              </span>
            </div>
          )}

          {/* Error display */}
          {executeError && (
            <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/30">
              <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {executeError}
            </div>
          )}

          {/* Success display */}
          {executed && (
            <div className="flex items-center gap-2 text-[11px] text-green-400 bg-green-500/10 rounded-lg px-3 py-2 border border-green-500/30">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              Action executed successfully. Changes have been applied to the
              cluster.
            </div>
          )}

          {/* Action buttons */}
          {!executed && (
            <div className="flex gap-2 pt-1">
              {!evaluation.isBlocked && (
                <Button
                  onClick={handleApprove}
                  disabled={executing}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs gap-1.5"
                >
                  {executing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {executing ? 'Applying...' : 'Apply Changes'}
                </Button>
              )}
              <Button
                onClick={handleReject}
                variant="outline"
                disabled={executing}
                className="flex-1 border-slate-700 text-slate-400 hover:text-slate-200 text-xs gap-1.5"
              >
                <XCircle className="h-3.5 w-3.5" />
                {evaluation.isBlocked ? 'Dismiss' : 'Reject'}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default AISafetyGuard;
