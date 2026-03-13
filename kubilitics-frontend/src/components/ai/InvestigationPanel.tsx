/**
 * InvestigationPanel — World-class AI Investigation UI for A-CORE-005.
 *
 * Features:
 *  - Animated investigation launcher with type selector
 *  - Real-time step tracker (5 steps with progress animation)
 *  - Live LLM text streaming display
 *  - Tool call cards showing every MCP tool the AI invoked
 *  - Finding cards with severity badges and evidence
 *  - Conclusion panel with confidence gauge
 *  - History list of past investigations
 *  - Cancel / retry support
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Brain,
  Zap,
  ChevronRight,
  ChevronDown,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Wrench,
  FileText,
  Target,
  Loader2,
  X,
  RotateCcw,
  History,
  Sparkles,
  Shield,
  TrendingUp,
  Eye,
  BookOpen,
  PlayCircle,
  StopCircle,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Progress } from '../ui/progress';
import {
  useInvestigation,
  useInvestigationList,
  type Investigation,
  type Finding,
  type ToolCallRecord,
  type InvestigationStep,
  type InvestigationEvent,
  type InvestigationState,
} from '../../hooks/useInvestigation';

// ─── Investigation type config ────────────────────────────────────────────────

const INVESTIGATION_TYPES = [
  {
    value: 'general',
    label: 'General',
    icon: Search,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    description: 'Broad cluster investigation',
  },
  {
    value: 'performance',
    label: 'Performance',
    icon: TrendingUp,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    description: 'Latency, throughput, resource usage',
  },
  {
    value: 'reliability',
    label: 'Reliability',
    icon: Shield,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    description: 'Crashes, restarts, availability',
  },
  {
    value: 'security',
    label: 'Security',
    icon: Eye,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    description: 'RBAC, network policies, vulnerabilities',
  },
  {
    value: 'cost',
    label: 'Cost',
    icon: Sparkles,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    description: 'Over-provisioning, waste, optimization',
  },
] as const;

const SUGGESTED_QUERIES = [
  'Why are pods in the default namespace crashlooping?',
  'Which nodes are under memory pressure?',
  'Find performance bottlenecks in the payment service',
  'Audit RBAC permissions across all namespaces',
  'Identify over-provisioned deployments wasting resources',
  'Diagnose intermittent network connectivity issues',
];

// ─── State helpers ────────────────────────────────────────────────────────────

function stateColor(state: InvestigationState) {
  switch (state) {
    case 'CREATED':       return 'text-slate-400';
    case 'INVESTIGATING': return 'text-blue-400';
    case 'ANALYZING':     return 'text-purple-400';
    case 'CONCLUDED':     return 'text-green-400';
    case 'FAILED':        return 'text-red-400';
    case 'CANCELLED':     return 'text-slate-500';
  }
}

function stateBadgeVariant(state: InvestigationState): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state) {
    case 'CONCLUDED': return 'default';
    case 'FAILED':    return 'destructive';
    default:          return 'secondary';
  }
}

function stateLabel(state: InvestigationState) {
  switch (state) {
    case 'CREATED':       return 'Created';
    case 'INVESTIGATING': return 'Investigating…';
    case 'ANALYZING':     return 'Analyzing…';
    case 'CONCLUDED':     return 'Concluded';
    case 'FAILED':        return 'Failed';
    case 'CANCELLED':     return 'Cancelled';
  }
}

function isTerminal(state: InvestigationState) {
  return state === 'CONCLUDED' || state === 'FAILED' || state === 'CANCELLED';
}

// ─── Severity helpers ─────────────────────────────────────────────────────────

function severityColor(sev: string) {
  switch (sev) {
    case 'critical': return 'bg-red-500/20 text-red-300 border-red-500/40';
    case 'high':     return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    case 'medium':   return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'low':      return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    default:         return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
  }
}

function severityIcon(sev: string) {
  switch (sev) {
    case 'critical': return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case 'high':     return <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />;
    case 'medium':   return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
    default:         return <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />;
  }
}

// ─── ConfidenceGauge ──────────────────────────────────────────────────────────

function ConfidenceGauge({ value }: { value: number }) {
  const r = 30;
  const cx = 40;
  const cy = 40;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  const color =
    value >= 80 ? '#22c55e' : value >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="80" height="80" className="-rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#334155" strokeWidth="6" />
        <motion.circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circ}`}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - dash }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <span className="text-xs font-semibold" style={{ color }}>
        {value}% confidence
      </span>
    </div>
  );
}

// ─── StepTracker ─────────────────────────────────────────────────────────────

function StepTracker({
  steps,
  state,
}: {
  steps: InvestigationStep[];
  state: InvestigationState;
}) {
  // The 5 canonical steps in order
  const canonicalSteps = [
    { key: 'Build cluster context',        icon: Activity,  label: 'Build Context' },
    { key: 'Generate investigation prompt', icon: FileText,  label: 'Build Prompt' },
    { key: 'LLM investigation',            icon: Brain,     label: 'AI Analysis' },
    { key: 'Extract findings',             icon: Search,    label: 'Extract Findings' },
    { key: 'Conclude',                     icon: Target,    label: 'Conclude' },
  ];

  const getStepStatus = (key: string) => {
    const match = steps.find(s =>
      s.description.toLowerCase().includes(key.toLowerCase())
    );
    if (!match) return 'pending';
    if (match.result && match.result !== 'Gathering relevant cluster state…' &&
        match.result !== 'Rendering chain-of-thought template…' &&
        match.result !== 'Running agentic investigation loop…') {
      return 'done';
    }
    return 'active';
  };

  return (
    <div className="flex items-center gap-1 py-2">
      {canonicalSteps.map((cs, i) => {
        const status = getStepStatus(cs.key);
        const Icon = cs.icon;
        return (
          <React.Fragment key={cs.key}>
            <div className="flex flex-col items-center gap-1 min-w-0">
              <motion.div
                className={[
                  'w-7 h-7 rounded-full flex items-center justify-center border',
                  status === 'done'
                    ? 'bg-green-500/20 border-green-500/50 text-green-400'
                    : status === 'active'
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                    : 'bg-slate-800 border-slate-700 text-slate-600',
                ].join(' ')}
                animate={status === 'active' ? { scale: [1, 1.1, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                {status === 'active' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : status === 'done' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </motion.div>
              <span className="text-[9px] text-slate-500 text-center leading-tight max-w-12 truncate">
                {cs.label}
              </span>
            </div>
            {i < canonicalSteps.length - 1 && (
              <div
                className={[
                  'flex-1 h-0.5 mb-4 rounded-full',
                  getStepStatus(canonicalSteps[i + 1].key) !== 'pending' ||
                  status === 'done'
                    ? 'bg-blue-500/40'
                    : 'bg-slate-700',
                ].join(' ')}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── ToolCallCard ─────────────────────────────────────────────────────────────

function ToolCallCard({ rec }: { rec: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const argsStr = Object.keys(rec.args).length
    ? JSON.stringify(rec.args, null, 2)
    : null;
  const resultPreview = rec.result.slice(0, 120);
  const hasMore = rec.result.length > 120;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex gap-2.5 group"
    >
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1">
        <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0">
          <Wrench className="h-2.5 w-2.5 text-cyan-400" />
        </div>
        <div className="w-px flex-1 bg-slate-700/50 mt-1" />
      </div>

      {/* Card body */}
      <div className="flex-1 pb-3">
        <button
          className="w-full text-left"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center gap-2">
            <code className="text-[11px] font-mono text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded">
              {rec.tool_name}
            </code>
            <span className="text-[10px] text-slate-500">turn {rec.turn_index}</span>
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-slate-600 ml-auto" />
            ) : (
              <ChevronRight className="h-3 w-3 text-slate-600 ml-auto" />
            )}
          </div>
        </button>

        {/* Result preview */}
        <div className="mt-1 text-[11px] text-slate-400 leading-relaxed">
          {resultPreview}
          {hasMore && !expanded && (
            <span className="text-slate-600">…</span>
          )}
        </div>

        {/* Expanded: args + full result */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mt-2 space-y-2"
            >
              {argsStr && (
                <div>
                  <div className="text-[10px] text-slate-600 mb-1 uppercase tracking-wide">Arguments</div>
                  <pre className="text-[10px] font-mono bg-slate-800/60 rounded p-2 overflow-x-auto text-slate-300">
                    {argsStr}
                  </pre>
                </div>
              )}
              <div>
                <div className="text-[10px] text-slate-600 mb-1 uppercase tracking-wide">Full Result</div>
                <pre className="text-[10px] font-mono bg-slate-800/60 rounded p-2 overflow-x-auto text-slate-300 max-h-40">
                  {rec.result}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── FindingCard ──────────────────────────────────────────────────────────────

function FindingCard({ finding, index }: { finding: Finding; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={[
        'rounded-lg border p-3 cursor-pointer transition-all',
        severityColor(finding.severity),
      ].join(' ')}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-start gap-2">
        {severityIcon(finding.severity)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
              {finding.severity}
            </span>
            <span className="text-[10px] opacity-50">·</span>
            <span className="text-[10px] opacity-60">{finding.confidence}% confidence</span>
          </div>
          <p className="text-[12px] leading-relaxed font-medium">
            {finding.statement}
          </p>
          <AnimatePresence>
            {expanded && finding.evidence && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mt-2"
              >
                <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Evidence</div>
                <p className="text-[11px] opacity-80 leading-relaxed">{finding.evidence}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {finding.evidence && (
          <button className="opacity-50 hover:opacity-100 flex-shrink-0">
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── ConclusionPanel ──────────────────────────────────────────────────────────

function ConclusionPanel({
  conclusion,
  confidence,
  state,
}: {
  conclusion: string;
  confidence: number;
  state: InvestigationState;
}) {
  if (state === 'FAILED') {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <XCircle className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold text-red-400">Investigation Failed</span>
        </div>
        <p className="text-xs text-red-300/80">{conclusion || 'Investigation failed — check backend logs.'}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
      <div className="flex items-start gap-4">
        <ConfidenceGauge value={confidence} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <span className="text-sm font-semibold text-green-400">Root Cause Identified</span>
          </div>
          <p className="text-[12px] text-slate-300 leading-relaxed">{conclusion}</p>
        </div>
      </div>
    </div>
  );
}

// ─── StreamingTextDisplay ─────────────────────────────────────────────────────

function StreamingTextDisplay({ text }: { text: string }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [text]);

  if (!text) return null;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Brain className="h-3 w-3 text-purple-400" />
        <span className="text-[10px] text-purple-400 uppercase tracking-wide font-semibold">
          AI Reasoning
        </span>
        <div className="ml-auto flex gap-0.5">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-1 h-1 rounded-full bg-purple-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
            />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed font-mono whitespace-pre-wrap">
        {text}
        <motion.span
          className="inline-block w-0.5 h-3 bg-purple-400 ml-0.5 align-middle"
          animate={{ opacity: [1, 0] }}
          transition={{ repeat: Infinity, duration: 0.8 }}
        />
      </p>
      <div ref={endRef} />
    </div>
  );
}

// ─── InvestigationHistory ─────────────────────────────────────────────────────

function InvestigationHistory({
  onResume,
}: {
  onResume: (id: string) => void;
}) {
  const { investigations, loading, error, reload } = useInvestigationList();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading history…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-red-400">{error}</p>
        <Button variant="ghost" size="sm" onClick={reload} className="mt-2 text-xs">
          <RotateCcw className="h-3 w-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  if (!investigations || investigations.length === 0) {
    return (
      <div className="text-center py-8">
        <BookOpen className="h-8 w-8 text-slate-700 mx-auto mb-2" />
        <p className="text-xs text-slate-500">No investigations yet</p>
      </div>
    );
  }

  const sorted = [...investigations].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-2">
      {sorted.map(inv => (
        <button
          key={inv.id}
          onClick={() => onResume(inv.id)}
          className="w-full text-left rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 hover:border-slate-600 hover:bg-slate-800/60 transition-all group"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-slate-300 leading-snug line-clamp-2 flex-1">
              {inv.description}
            </p>
            <Badge variant={stateBadgeVariant(inv.state)} className="text-[9px] flex-shrink-0">
              {stateLabel(inv.state)}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[9px] text-slate-600">{inv.type}</span>
            <span className="text-[9px] text-slate-700">·</span>
            {inv.findings && (
              <span className="text-[9px] text-slate-600">{inv.findings.length} findings</span>
            )}
            <span className="text-[9px] text-slate-700 ml-auto">
              {new Date(inv.created_at).toLocaleDateString()}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── ActiveInvestigation ──────────────────────────────────────────────────────

function ActiveInvestigation({
  investigation,
  events,
  streamText,
  isStreaming,
  onCancel,
}: {
  investigation: Investigation;
  events: InvestigationEvent[];
  streamText: string;
  isStreaming: boolean;
  onCancel: () => void;
}) {
  const toolCalls = investigation.tool_calls ?? [];
  const findings = investigation.findings ?? [];
  const steps = investigation.steps ?? [];
  const concluded = isTerminal(investigation.state);

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
          ) : concluded ? (
            investigation.state === 'CONCLUDED' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-400" />
            )
          ) : (
            <Activity className="h-3.5 w-3.5 text-blue-400" />
          )}
          <span className={`text-xs font-semibold ${stateColor(investigation.state)}`}>
            {stateLabel(investigation.state)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {investigation.tokens_used > 0 && (
            <span className="text-[10px] text-slate-600">
              {investigation.tokens_used.toLocaleString()} tokens
            </span>
          )}
          {!concluded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="h-6 px-2 text-[10px] text-slate-500 hover:text-red-400"
            >
              <StopCircle className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3">
        <p className="text-[11px] text-slate-400 italic leading-relaxed">
          "{investigation.description}"
        </p>
      </div>

      {/* Step tracker */}
      {steps.length > 0 && (
        <StepTracker steps={steps} state={investigation.state} />
      )}

      {/* Streaming text */}
      {streamText && !concluded && (
        <StreamingTextDisplay text={streamText} />
      )}

      {/* Tool call timeline */}
      {toolCalls.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <Wrench className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Tool Calls ({toolCalls.length})
            </span>
          </div>
          <div className="space-y-0">
            {toolCalls.map((tc, i) => (
              <ToolCallCard key={`${tc.tool_name}-${i}`} rec={tc} />
            ))}
          </div>
        </div>
      )}

      {/* Findings */}
      {findings.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <Target className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Findings ({findings.length})
            </span>
          </div>
          <div className="space-y-2">
            {findings.map((f, i) => (
              <FindingCard key={i} finding={f} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Conclusion */}
      {concluded && (
        <ConclusionPanel
          conclusion={investigation.conclusion}
          confidence={investigation.confidence}
          state={investigation.state}
        />
      )}
    </div>
  );
}

// ─── LauncherForm ─────────────────────────────────────────────────────────────

function LauncherForm({
  onStart,
  isLoading,
}: {
  onStart: (description: string, type: string) => void;
  isLoading: boolean;
}) {
  const [description, setDescription] = useState('');
  const [type, setType] = useState('general');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!description.trim() || isLoading) return;
    onStart(description.trim(), type);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="space-y-4">
      {/* Type selector */}
      <div className="grid grid-cols-5 gap-1.5">
        {INVESTIGATION_TYPES.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={[
                'flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all',
                type === t.value
                  ? `${t.bg} ${t.border} ${t.color}`
                  : 'border-slate-700/50 bg-slate-800/40 text-slate-500 hover:border-slate-600 hover:text-slate-400',
              ].join(' ')}
              title={t.description}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="text-[9px] font-medium leading-tight">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Text input */}
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Describe what you want to investigate… (⌘↵ to run)"
          className="min-h-[80px] resize-none bg-slate-800/60 border-slate-700 text-slate-200 placeholder:text-slate-600 text-sm pr-4 focus:border-blue-500/50"
          disabled={isLoading}
        />
      </div>

      {/* Suggested queries */}
      <div>
        <p className="text-[10px] text-slate-600 mb-1.5 uppercase tracking-wide">Quick Start</p>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUERIES.slice(0, 3).map(q => (
            <button
              key={q}
              onClick={() => {
                setDescription(q);
                textareaRef.current?.focus();
              }}
              className="text-[10px] text-slate-500 border border-slate-700/50 rounded-full px-2 py-0.5 hover:border-blue-500/30 hover:text-blue-400 transition-colors"
            >
              {q.slice(0, 40)}…
            </button>
          ))}
        </div>
      </div>

      {/* Run button */}
      <Button
        onClick={handleSubmit}
        disabled={!description.trim() || isLoading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <PlayCircle className="h-4 w-4" />
            Run Investigation
          </>
        )}
      </Button>
    </div>
  );
}

// ─── InvestigationPanel (main) ────────────────────────────────────────────────

type PanelView = 'launcher' | 'active' | 'history';

interface InvestigationPanelProps {
  /** Optional pre-filled description (e.g. from context menu) */
  initialDescription?: string;
  /** Optional callback when investigation concludes */
  onConcluded?: (inv: Investigation) => void;
}

export function InvestigationPanel({
  initialDescription,
  onConcluded,
}: InvestigationPanelProps) {
  const [view, setView] = useState<PanelView>(initialDescription ? 'launcher' : 'launcher');
  const [starting, setStarting] = useState(false);

  const {
    investigation,
    events,
    streamText,
    isStreaming,
    error,
    startInvestigation,
    cancelInvestigation,
  } = useInvestigation();

  // Notify parent when concluded
  useEffect(() => {
    if (investigation && investigation.state === 'CONCLUDED' && onConcluded) {
      onConcluded(investigation);
    }
  }, [investigation?.state, onConcluded]);

  // Auto-switch to active view when investigation starts
  useEffect(() => {
    if (investigation) {
      setView('active');
    }
  }, [investigation?.id]);

  const handleStart = useCallback(
    async (description: string, type: string) => {
      setStarting(true);
      try {
        await startInvestigation(description, type);
        setView('active');
      } catch {
        // error shown in hook state
      } finally {
        setStarting(false);
      }
    },
    [startInvestigation]
  );

  const handleCancel = useCallback(async () => {
    if (investigation) {
      await cancelInvestigation(investigation.id);
    }
  }, [investigation, cancelInvestigation]);

  const handleNewInvestigation = useCallback(() => {
    setView('launcher');
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Brain className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">AI Investigation</h3>
            <p className="text-[10px] text-slate-500">
              {investigation
                ? `#${investigation.id.slice(-8)}`
                : 'Autonomous root-cause analysis'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Nav tabs */}
          {[
            { id: 'launcher' as PanelView, icon: Zap, label: 'New' },
            { id: 'history' as PanelView, icon: History, label: 'History' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={[
                'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
                view === tab.id
                  ? 'bg-slate-700 text-slate-200'
                  : 'text-slate-500 hover:text-slate-300',
              ].join(' ')}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label}
            </button>
          ))}
          {investigation && (
            <button
              onClick={() => setView('active')}
              className={[
                'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
                view === 'active'
                  ? 'bg-slate-700 text-slate-200'
                  : 'text-slate-500 hover:text-slate-300',
              ].join(' ')}
            >
              <Activity className="h-3 w-3" />
              Active
              {isStreaming && (
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-blue-400"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <AnimatePresence mode="wait">
            {view === 'launcher' && (
              <motion.div
                key="launcher"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <LauncherForm
                  onStart={handleStart}
                  isLoading={starting}
                />
              </motion.div>
            )}

            {view === 'active' && investigation && (
              <motion.div
                key="active"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <ActiveInvestigation
                  investigation={investigation}
                  events={events}
                  streamText={streamText}
                  isStreaming={isStreaming}
                  onCancel={handleCancel}
                />
                {isTerminal(investigation.state) && (
                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleNewInvestigation}
                      className="flex-1 text-xs border-slate-700 text-slate-400 hover:text-slate-200"
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      New Investigation
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {view === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <InvestigationHistory
                  onResume={(_id) => {
                    // For now just reload new investigation
                    setView('launcher');
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-300">{error}</p>
            </motion.div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── InvestigationTriggerButton ───────────────────────────────────────────────
// Small inline button for resource detail pages

interface InvestigationTriggerButtonProps {
  description: string;
  type?: string;
  className?: string;
}

export function InvestigationTriggerButton({
  description,
  type = 'general',
  className = '',
}: InvestigationTriggerButtonProps) {
  const [open, setOpen] = useState(false);
  const { startInvestigation, investigation, isStreaming } = useInvestigation();
  const [launched, setLaunched] = useState(false);

  const handleClick = async () => {
    if (launched) {
      setOpen(true);
      return;
    }
    setLaunched(true);
    setOpen(true);
    await startInvestigation(description, type);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className={`gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 ${className}`}
      >
        {isStreaming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Brain className="h-3.5 w-3.5" />
        )}
        {launched ? 'View Investigation' : 'Investigate with AI'}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-lg mx-4 rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
              style={{ maxHeight: '80vh' }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-semibold text-slate-200">AI Investigation</span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 56px)' }}>
                {investigation ? (
                  <div className="p-4">
                    <ActiveInvestigation
                      investigation={investigation}
                      events={[]}
                      streamText=""
                      isStreaming={isStreaming}
                      onCancel={() => {}}
                    />
                  </div>
                ) : (
                  <div className="p-4 flex items-center gap-2 text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Starting investigation…</span>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default InvestigationPanel;
