/**
 * AIInvestigation — "Investigate" button and multi-step investigation UI for
 * failed or warning resources.
 *
 * Steps:
 *   1. Gather resource state, events, logs (loading indicator)
 *   2. Analyzing with LLM (progress)
 *   3. Present findings with confidence score
 *   4. Propose remediation actions
 *
 * Results are cached via TanStack Query and can be shared via URL using the
 * investigation ID query parameter.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Brain,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Activity,
  FileText,
  Wrench,
  Target,
  Shield,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useAIInvestigation, type InvestigationResult } from '../../hooks/useAIInvestigation';

// ─── Step Indicator ─────────────────────────────────────────────────────────

interface StepConfig {
  key: string;
  label: string;
  icon: React.ElementType;
  description: string;
}

const INVESTIGATION_STEPS: StepConfig[] = [
  {
    key: 'gather',
    label: 'Gathering Data',
    icon: Activity,
    description: 'Reading resource state, events, and logs',
  },
  {
    key: 'analyze',
    label: 'Analyzing',
    icon: Brain,
    description: 'LLM analyzing patterns and anomalies',
  },
  {
    key: 'findings',
    label: 'Findings',
    icon: Target,
    description: 'Presenting findings with confidence scores',
  },
  {
    key: 'remediation',
    label: 'Remediation',
    icon: Wrench,
    description: 'Proposing remediation actions',
  },
];

function StepIndicator({
  currentStep,
  isComplete,
  error,
}: {
  currentStep: number;
  isComplete: boolean;
  error: boolean;
}) {
  return (
    <div className="flex items-center gap-1 py-3">
      {INVESTIGATION_STEPS.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === currentStep && !isComplete && !error;
        const isDone = i < currentStep || isComplete;
        const isFailed = error && i === currentStep;

        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center gap-1 min-w-0">
              <motion.div
                className={[
                  'w-8 h-8 rounded-full flex items-center justify-center border transition-colors',
                  isDone
                    ? 'bg-green-500/20 border-green-500/50 text-green-400'
                    : isActive
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                      : isFailed
                        ? 'bg-red-500/20 border-red-500/50 text-red-400'
                        : 'bg-slate-800 border-slate-700 text-slate-600',
                ].join(' ')}
                animate={
                  isActive ? { scale: [1, 1.1, 1] } : { scale: 1 }
                }
                transition={
                  isActive
                    ? { repeat: Infinity, duration: 1.5 }
                    : undefined
                }
              >
                {isActive ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : isFailed ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </motion.div>
              <span className="text-[9px] text-slate-500 text-center leading-tight max-w-14">
                {step.label}
              </span>
            </div>
            {i < INVESTIGATION_STEPS.length - 1 && (
              <div
                className={[
                  'flex-1 h-0.5 mb-4 rounded-full transition-colors',
                  isDone ? 'bg-green-500/40' : 'bg-slate-700',
                ].join(' ')}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Finding Card ───────────────────────────────────────────────────────────

function FindingCard({
  finding,
}: {
  finding: InvestigationResult['findings'][number];
}) {
  const [expanded, setExpanded] = useState(false);

  const severityConfig: Record<string, { bg: string; icon: React.ReactNode }> = {
    critical: {
      bg: 'border-red-500/40 bg-red-500/10',
      icon: <XCircle className="h-3.5 w-3.5 text-red-400" />,
    },
    high: {
      bg: 'border-orange-500/40 bg-orange-500/10',
      icon: <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />,
    },
    medium: {
      bg: 'border-amber-500/40 bg-amber-500/10',
      icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
    },
    low: {
      bg: 'border-blue-500/40 bg-blue-500/10',
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />,
    },
  };

  const config = severityConfig[finding.severity] ?? severityConfig.medium;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border p-3 cursor-pointer transition-all ${config.bg}`}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start gap-2">
        {config.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {finding.severity}
            </Badge>
            <span className="text-[10px] text-slate-500">
              {finding.confidence}% confidence
            </span>
          </div>
          <p className="text-[11px] text-slate-200 font-medium leading-relaxed">
            {finding.title}
          </p>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                  {finding.details}
                </p>
                {finding.evidence && (
                  <div className="mt-2">
                    <span className="text-[9px] text-slate-600 uppercase tracking-wide">
                      Evidence
                    </span>
                    <pre className="text-[10px] font-mono bg-slate-800/60 rounded p-2 mt-1 overflow-x-auto text-slate-300">
                      {finding.evidence}
                    </pre>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {finding.details && (
          <button className="opacity-50 hover:opacity-100 flex-shrink-0">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Remediation Card ───────────────────────────────────────────────────────

function RemediationCard({
  action,
}: {
  action: InvestigationResult['remediations'][number];
}) {
  const riskColors: Record<string, string> = {
    low: 'text-green-400 bg-green-500/10 border-green-500/30',
    medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    high: 'text-red-400 bg-red-500/10 border-red-500/30',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3"
    >
      <div className="flex items-start gap-2">
        <Wrench className="h-3.5 w-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[11px] font-semibold text-slate-200">
              {action.title}
            </span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded border ${riskColors[action.risk] ?? riskColors.medium}`}
            >
              {action.risk} risk
            </span>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            {action.description}
          </p>
          {action.command && (
            <pre className="text-[10px] font-mono bg-slate-900/60 rounded p-2 mt-2 overflow-x-auto text-cyan-300">
              {action.command}
            </pre>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Investigation Results Display ──────────────────────────────────────────

function InvestigationResults({
  result,
  investigationId,
}: {
  result: InvestigationResult;
  investigationId: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('investigation', investigationId);
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [investigationId]);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              result.overallConfidence >= 80
                ? 'bg-green-500/20 text-green-400'
                : result.overallConfidence >= 50
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-red-500/20 text-red-400'
            }`}
          >
            <span className="text-xs font-bold">{result.overallConfidence}</span>
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-200">
              Investigation Complete
            </span>
            <p className="text-[10px] text-slate-500">
              {result.findings.length} findings, {result.remediations.length}{' '}
              remediations
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyLink}
          className="text-[10px] text-slate-500 hover:text-slate-300 gap-1"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? 'Copied' : 'Share'}
        </Button>
      </div>

      {/* Root cause */}
      {result.rootCause && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Search className="h-3 w-3 text-blue-400" />
            <span className="text-[10px] text-blue-400 uppercase tracking-wide font-semibold">
              Root Cause
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            {result.rootCause}
          </p>
        </div>
      )}

      {/* Findings */}
      {result.findings.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Target className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">
              Findings ({result.findings.length})
            </span>
          </div>
          <div className="space-y-2">
            {result.findings.map((f, i) => (
              <FindingCard key={i} finding={f} />
            ))}
          </div>
        </div>
      )}

      {/* Remediations */}
      {result.remediations.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Wrench className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">
              Proposed Remediations ({result.remediations.length})
            </span>
          </div>
          <div className="space-y-2">
            {result.remediations.map((r, i) => (
              <RemediationCard key={i} action={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AIInvestigation (main component) ───────────────────────────────────────

interface AIInvestigationProps {
  /** Resource kind (e.g. "Pod", "Deployment"). */
  resourceKind: string;
  /** Resource name. */
  resourceName: string;
  /** Resource namespace. */
  namespace: string;
  /** Current resource status (e.g. "Failed", "CrashLoopBackOff"). */
  status?: string;
  /** Additional CSS classes. */
  className?: string;
  /** Variant: "button" renders just the trigger button, "inline" renders full panel. */
  variant?: 'button' | 'inline';
}

export function AIInvestigation({
  resourceKind,
  resourceName,
  namespace,
  status,
  className = '',
  variant = 'button',
}: AIInvestigationProps) {
  const [showPanel, setShowPanel] = useState(variant === 'inline');
  const description = `Investigate ${status ? status + ' ' : ''}${resourceKind} ${resourceName} in namespace ${namespace}`;

  const {
    investigate,
    result,
    currentStep,
    isInvestigating,
    isComplete,
    error,
    investigationId,
  } = useAIInvestigation(resourceKind, resourceName, namespace);

  const handleInvestigate = useCallback(() => {
    setShowPanel(true);
    if (!isInvestigating && !isComplete) {
      investigate(description);
    }
  }, [investigate, description, isInvestigating, isComplete]);

  // Button-only variant
  if (variant === 'button' && !showPanel) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleInvestigate}
        className={`gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 ${className}`}
      >
        <Brain className="h-3.5 w-3.5" />
        Investigate
      </Button>
    );
  }

  return (
    <div
      className={`rounded-xl border border-slate-700 bg-slate-900 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Brain className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-200">
              AI Investigation
            </h4>
            <p className="text-[10px] text-slate-500 truncate max-w-60">
              {resourceKind}/{resourceName}
            </p>
          </div>
        </div>
        {status && (
          <Badge
            variant={
              status.toLowerCase().includes('fail') ||
              status.toLowerCase().includes('crash')
                ? 'destructive'
                : 'secondary'
            }
            className="text-[9px]"
          >
            {status}
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Step indicator */}
        <StepIndicator
          currentStep={currentStep}
          isComplete={isComplete}
          error={!!error}
        />

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 mb-4"
          >
            <div className="flex items-center gap-2">
              <XCircle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-[11px] text-red-300">{error}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => investigate(description)}
              className="mt-2 text-[10px] text-red-400 hover:text-red-300"
            >
              Retry Investigation
            </Button>
          </motion.div>
        )}

        {/* In-progress message */}
        {isInvestigating && !error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-4"
          >
            <p className="text-[11px] text-slate-400">
              {INVESTIGATION_STEPS[currentStep]?.description ??
                'Processing...'}
            </p>
          </motion.div>
        )}

        {/* Results */}
        {isComplete && result && investigationId && (
          <InvestigationResults
            result={result}
            investigationId={investigationId}
          />
        )}

        {/* Initial state */}
        {!isInvestigating && !isComplete && !error && (
          <div className="text-center py-4">
            <Button
              onClick={handleInvestigate}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
            >
              <Search className="h-3.5 w-3.5" />
              Start Investigation
            </Button>
            <p className="text-[10px] text-slate-600 mt-2">
              AI will analyze resource state, events, and logs to identify the
              root cause.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIInvestigation;
