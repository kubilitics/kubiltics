/**
 * ImpactBar — bottom summary strip for the Intelligence Workspace.
 *
 * Shows impact metrics as clickable pills that expand inline micro-detail.
 * Two modes:
 *  - "live"    → BlastRadiusResult data (affected resources, blast score, namespaces, SPOFs)
 *  - "preview" → PreviewResult data (creates/modifies/deletes, blast score, health delta, new SPOFs)
 *
 * Only one section is expanded at a time; clicking the same pill collapses it.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Crosshair,
  FilePlus,
  FileMinus,
  FileEdit,
  Globe,
  Layers,
  Link2,
  Minus,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlastRadiusResult } from '@/services/api/types';
import type { PreviewResult } from '@/services/api/preview';
import { useCausalChainStore } from '@/stores/causalChainStore';

// --- Local type ---
type WorkspaceMode = 'live' | 'preview';

// --- Helpers ---
function blastLevelColors(level: string): { bg: string; text: string; ring: string } {
  switch (level) {
    case 'critical':
      return { bg: 'bg-red-500/20', text: 'text-red-400', ring: 'ring-red-500/40' };
    case 'high':
      return { bg: 'bg-orange-500/20', text: 'text-orange-400', ring: 'ring-orange-500/40' };
    case 'medium':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', ring: 'ring-yellow-500/40' };
    case 'low':
    default:
      return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', ring: 'ring-emerald-500/40' };
  }
}

function healthDeltaIcon(delta: number) {
  if (delta > 0) return <ArrowUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (delta < 0) return <ArrowDown className="h-3.5 w-3.5 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-slate-400" />;
}

function healthDeltaColor(delta: number): string {
  if (delta > 0) return 'text-emerald-400';
  if (delta < 0) return 'text-red-400';
  return 'text-slate-400';
}

// --- Sub-components ---
interface MetricPillProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  accentClass?: string;
}

function MetricPill({ id, icon, label, value, expanded, onToggle, accentClass }: MetricPillProps) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={`impact-detail-${id}`}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150',
        'bg-slate-800 hover:bg-slate-700 ring-1 ring-slate-700/60 hover:ring-slate-600',
        expanded && 'bg-slate-700 ring-slate-500',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
      )}
    >
      <span className={cn('shrink-0', accentClass ?? 'text-slate-400')}>{icon}</span>
      <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">{label}</span>
      <span className={cn('text-[13px] font-semibold text-white', accentClass)}>{value}</span>
      {expanded ? (
        <ChevronUp className="h-3 w-3 text-slate-500 ml-0.5" />
      ) : (
        <ChevronDown className="h-3 w-3 text-slate-500 ml-0.5" />
      )}
    </button>
  );
}

interface DetailPanelProps {
  id: string;
  children: React.ReactNode;
}

function DetailPanel({ id, children }: DetailPanelProps) {
  return (
    <motion.div
      id={`impact-detail-${id}`}
      role="region"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="mt-2 px-3 py-2.5 rounded-lg bg-slate-800/80 ring-1 ring-slate-700/50 text-[12px] text-slate-300">
        {children}
      </div>
    </motion.div>
  );
}

// --- Live section ---
interface LiveImpactBarProps {
  data: BlastRadiusResult;
}

function LiveImpactBar({ data }: LiveImpactBarProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded(prev => (prev === id ? null : id));
  const navigate = useNavigate();

  const { chainData, overlayEnabled, isTimelineExpanded, highlightedStep, toggleTimeline, setHighlightedStep } = useCausalChainStore();

  const levelColors = blastLevelColors(data.criticalityLevel);

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Pills row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Affected resources */}
        <MetricPill
          id="affected"
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Affected"
          value={data.totalAffected}
          expanded={expanded === 'affected'}
          onToggle={() => toggle('affected')}
        />

        {/* Blast score */}
        <MetricPill
          id="blast"
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Blast score"
          value={
            <span className={cn('font-bold', levelColors.text)}>
              {typeof data.criticalityScore === 'number' ? data.criticalityScore.toFixed(2) : data.criticalityScore}
              <span className="text-[10px] font-medium ml-1 capitalize">({data.criticalityLevel})</span>
            </span>
          }
          expanded={expanded === 'blast'}
          onToggle={() => toggle('blast')}
          accentClass={levelColors.text}
        />

        {/* Namespaces */}
        <MetricPill
          id="ns"
          icon={<Globe className="h-3.5 w-3.5" />}
          label="Namespaces"
          value={data.affectedNamespaces}
          expanded={expanded === 'ns'}
          onToggle={() => toggle('ns')}
        />

        {/* SPOF */}
        {data.isSPOF && (
          <MetricPill
            id="spof"
            icon={<ShieldAlert className="h-3.5 w-3.5" />}
            label="SPOF"
            value="Yes"
            expanded={expanded === 'spof'}
            onToggle={() => toggle('spof')}
            accentClass="text-red-400"
          />
        )}

        {/* Root Cause pill — only visible when chain overlay is active */}
        {overlayEnabled && chainData && (
          <MetricPill
            id="root-cause"
            icon={<Crosshair className="h-3.5 w-3.5" />}
            label="Root Cause"
            value={chainData.rootCause.name}
            expanded={false}
            onToggle={() => {}}
            accentClass="text-amber-500"
          />
        )}

        {/* Chain pill — toggles timeline drawer */}
        {overlayEnabled && chainData && chainData.links.length > 0 && (
          <MetricPill
            id="chain"
            icon={<Link2 className="h-3.5 w-3.5" />}
            label="Chain"
            value={`${chainData.links.length} step${chainData.links.length !== 1 ? 's' : ''}`}
            expanded={isTimelineExpanded}
            onToggle={toggleTimeline}
            accentClass="text-orange-400"
          />
        )}
      </div>

      {/* Chain timeline drawer */}
      <AnimatePresence>
        {overlayEnabled && chainData && chainData.links.length > 0 && isTimelineExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="col-span-full overflow-hidden"
          >
            <div className="mt-2 px-3 py-2.5 rounded-lg bg-slate-800/80 ring-1 ring-slate-700/50">
              <div className="flex flex-col gap-0">
                {chainData.links.map((link, i) => {
                  const isRoot = i === 0;
                  const isSymptom = i === chainData.links.length - 1;
                  const stepIndex = isRoot ? 0 : i + 1;
                  const isHighlighted = highlightedStep === stepIndex;

                  return (
                    <div
                      key={`${link.rule}-${i}`}
                      className={cn(
                        'flex gap-3 items-start py-2 px-2 rounded-lg cursor-pointer transition-colors duration-150',
                        isHighlighted && 'bg-slate-700/50',
                        isRoot && 'bg-amber-500/5 ring-1 ring-amber-500/10'
                      )}
                      onClick={() => setHighlightedStep(stepIndex)}
                      onMouseEnter={() => setHighlightedStep(stepIndex)}
                      onMouseLeave={() => setHighlightedStep(null)}
                    >
                      <div className="flex flex-col items-center shrink-0">
                        <div className={cn(
                          'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                          isRoot ? 'bg-amber-500 text-black' :
                          isSymptom ? 'bg-red-500 text-white' :
                          'bg-orange-500 text-black'
                        )}>
                          {stepIndex + 1}
                        </div>
                        {!isSymptom && (
                          <div className="w-0.5 h-5 bg-gradient-to-b from-amber-500 to-red-500 mt-1" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-white truncate">
                            {isRoot ? link.cause.name : link.effect.name}
                          </span>
                          <span className="text-[10px] text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded shrink-0">
                            {isRoot ? link.cause.kind : link.effect.kind}
                          </span>
                          {isRoot && (
                            <span className="text-[9px] text-amber-500 font-semibold uppercase tracking-wider">
                              Root Cause
                            </span>
                          )}
                          {isSymptom && (
                            <span className="text-[9px] text-red-500 font-semibold uppercase tracking-wider">
                              Symptom
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {isRoot ? link.cause.eventMessage : link.effect.eventMessage}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {link.timeDeltaMs > 0 && `${(link.timeDeltaMs / 1000).toFixed(0)}s after cause · `}
                          confidence {(link.confidence * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  Overall confidence: <span className="text-amber-500 font-semibold">{(chainData.confidence * 100).toFixed(0)}%</span>
                </span>
                <button
                  onClick={() => {
                    if (chainData?.insightId) {
                      navigate(`/health/issues/${chainData.insightId}`);
                    }
                  }}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 bg-indigo-500/8 hover:bg-indigo-500/15 px-2.5 py-1 rounded transition-colors"
                >
                  Investigate →
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expandable detail panels */}
      <AnimatePresence>
        {expanded === 'affected' && (
          <DetailPanel id="affected">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span><span className="text-red-400 font-semibold">{data.impactSummary.brokenCount}</span> broken</span>
              <span><span className="text-yellow-400 font-semibold">{data.impactSummary.degradedCount}</span> degraded</span>
              <span><span className="text-emerald-400 font-semibold">{data.impactSummary.selfHealingCount}</span> self-healing</span>
              <span className="text-slate-500">of {data.impactSummary.totalWorkloads} workloads</span>
            </div>
            {data.impactSummary.capacityNotes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-slate-400 list-disc list-inside">
                {data.impactSummary.capacityNotes.slice(0, 3).map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
          </DetailPanel>
        )}

        {expanded === 'blast' && (
          <DetailPanel id="blast">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span>Resilience: <span className="font-semibold text-white">{data.subScores.resilience.score}</span></span>
              <span>Exposure: <span className="font-semibold text-white">{data.subScores.exposure.score}</span></span>
              <span>Recovery: <span className="font-semibold text-white">{data.subScores.recovery.score}</span></span>
              <span>Impact: <span className="font-semibold text-white">{data.subScores.impact.score}</span></span>
            </div>
            <p className="mt-1.5 text-slate-400 italic">{data.verdict}</p>
          </DetailPanel>
        )}

        {expanded === 'ns' && (
          <DetailPanel id="ns">
            <p>{data.affectedNamespaces} namespace{data.affectedNamespaces !== 1 ? 's' : ''} in blast radius</p>
            <p className="text-slate-400 mt-0.5">{data.blastRadiusPercent.toFixed(1)}% cluster blast radius · {data.graphNodeCount} nodes / {data.graphEdgeCount} edges in graph</p>
          </DetailPanel>
        )}

        {expanded === 'spof' && data.isSPOF && (
          <DetailPanel id="spof">
            <p className="text-red-400 font-semibold">Single Point of Failure detected</p>
            <div className="mt-1 text-slate-400">
              <span>Replicas: {data.replicaCount}</span>
              {!data.hasHPA && <span className="ml-3 text-yellow-400">No HPA</span>}
              {!data.hasPDB && <span className="ml-3 text-yellow-400">No PDB</span>}
            </div>
            {data.isIngressExposed && data.ingressHosts.length > 0 && (
              <p className="mt-1 text-slate-400">
                Ingress exposed: {data.ingressHosts.slice(0, 2).join(', ')}
                {data.ingressHosts.length > 2 && ` +${data.ingressHosts.length - 2} more`}
              </p>
            )}
          </DetailPanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Preview section ---
interface PreviewImpactBarProps {
  data: PreviewResult;
  manifestFilename?: string;
}

function PreviewImpactBar({ data, manifestFilename }: PreviewImpactBarProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded(prev => (prev === id ? null : id));

  const levelColors = blastLevelColors(data.blast_radius_level);

  const creates = data.affected_resources.filter(r => r.impact === 'created').length;
  const modifies = data.affected_resources.filter(r => r.impact === 'modified').length;
  const deletes = data.affected_resources.filter(r => r.impact === 'deleted').length;

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Pills row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Creates */}
        {creates > 0 && (
          <MetricPill
            id="creates"
            icon={<FilePlus className="h-3.5 w-3.5" />}
            label="Creates"
            value={creates}
            expanded={expanded === 'creates'}
            onToggle={() => toggle('creates')}
            accentClass="text-emerald-400"
          />
        )}

        {/* Modifies */}
        {modifies > 0 && (
          <MetricPill
            id="modifies"
            icon={<FileEdit className="h-3.5 w-3.5" />}
            label="Modifies"
            value={modifies}
            expanded={expanded === 'modifies'}
            onToggle={() => toggle('modifies')}
            accentClass="text-yellow-400"
          />
        )}

        {/* Deletes */}
        {deletes > 0 && (
          <MetricPill
            id="deletes"
            icon={<FileMinus className="h-3.5 w-3.5" />}
            label="Deletes"
            value={deletes}
            expanded={expanded === 'deletes'}
            onToggle={() => toggle('deletes')}
            accentClass="text-red-400"
          />
        )}

        {/* Blast score */}
        <MetricPill
          id="blast"
          icon={<Zap className="h-3.5 w-3.5" />}
          label="Blast score"
          value={
            <span className={cn('font-bold', levelColors.text)}>
              {typeof data.blast_radius_score === 'number' ? data.blast_radius_score.toFixed(2) : data.blast_radius_score}
              <span className="text-[10px] font-medium ml-1 capitalize">({data.blast_radius_level})</span>
            </span>
          }
          expanded={expanded === 'blast'}
          onToggle={() => toggle('blast')}
          accentClass={levelColors.text}
        />

        {/* Health delta */}
        <MetricPill
          id="health"
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Health Δ"
          value={
            <span className={cn('flex items-center gap-0.5', healthDeltaColor(data.health_score_delta))}>
              {healthDeltaIcon(data.health_score_delta)}
              {Math.abs(data.health_score_delta).toFixed(1)}
            </span>
          }
          expanded={expanded === 'health'}
          onToggle={() => toggle('health')}
          accentClass={healthDeltaColor(data.health_score_delta)}
        />

        {/* New SPOFs */}
        {data.new_spofs.length > 0 && (
          <MetricPill
            id="spofs"
            icon={<ShieldAlert className="h-3.5 w-3.5" />}
            label="New SPOFs"
            value={data.new_spofs.length}
            expanded={expanded === 'spofs'}
            onToggle={() => toggle('spofs')}
            accentClass="text-red-400"
          />
        )}

        {/* Warnings */}
        {data.warnings.length > 0 && (
          <MetricPill
            id="warn"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Warnings"
            value={data.warnings.length}
            expanded={expanded === 'warn'}
            onToggle={() => toggle('warn')}
            accentClass="text-amber-400"
          />
        )}
      </div>

      {/* Expandable detail panels */}
      <AnimatePresence>
        {expanded === 'creates' && (
          <DetailPanel id="creates">
            <ul className="space-y-0.5">
              {data.affected_resources
                .filter(r => r.impact === 'created')
                .slice(0, 5)
                .map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-emerald-400 font-mono text-[10px] uppercase">{r.kind}</span>
                    <span>{r.name}</span>
                    {r.namespace && <span className="text-slate-500">({r.namespace})</span>}
                  </li>
                ))}
              {creates > 5 && <li className="text-slate-500">+{creates - 5} more</li>}
            </ul>
          </DetailPanel>
        )}

        {expanded === 'modifies' && (
          <DetailPanel id="modifies">
            <ul className="space-y-0.5">
              {data.affected_resources
                .filter(r => r.impact === 'modified')
                .slice(0, 5)
                .map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-yellow-400 font-mono text-[10px] uppercase">{r.kind}</span>
                    <span>{r.name}</span>
                    {r.namespace && <span className="text-slate-500">({r.namespace})</span>}
                    <span className="text-slate-500 ml-auto">score {r.blast_score}</span>
                  </li>
                ))}
              {modifies > 5 && <li className="text-slate-500">+{modifies - 5} more</li>}
            </ul>
          </DetailPanel>
        )}

        {expanded === 'deletes' && (
          <DetailPanel id="deletes">
            <ul className="space-y-0.5">
              {data.affected_resources
                .filter(r => r.impact === 'deleted')
                .slice(0, 5)
                .map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-red-400 font-mono text-[10px] uppercase">{r.kind}</span>
                    <span>{r.name}</span>
                    {r.namespace && <span className="text-slate-500">({r.namespace})</span>}
                  </li>
                ))}
              {deletes > 5 && <li className="text-slate-500">+{deletes - 5} more</li>}
            </ul>
          </DetailPanel>
        )}

        {expanded === 'blast' && (
          <DetailPanel id="blast">
            <p>Predicted blast radius score: <span className={cn('font-semibold', levelColors.text)}>{data.blast_radius_score} ({data.blast_radius_level})</span></p>
            <p className="mt-0.5 text-slate-400">Total affected resources: {data.total_affected}</p>
          </DetailPanel>
        )}

        {expanded === 'health' && (
          <DetailPanel id="health">
            <div className="flex items-center gap-4">
              <span>Before: <span className="font-semibold text-white">{data.health_score_before.toFixed(1)}</span></span>
              <span>After: <span className={cn('font-semibold', healthDeltaColor(data.health_score_delta))}>{data.health_score_after.toFixed(1)}</span></span>
              <span className={cn('font-semibold', healthDeltaColor(data.health_score_delta))}>
                {data.health_score_delta >= 0 ? '+' : ''}{data.health_score_delta.toFixed(1)} pts
              </span>
            </div>
          </DetailPanel>
        )}

        {expanded === 'spofs' && (
          <DetailPanel id="spofs">
            <p className="text-red-400 font-semibold mb-1">New single points of failure introduced:</p>
            <ul className="space-y-0.5">
              {data.new_spofs.map((spof, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-red-400 font-mono text-[10px] uppercase">{spof.kind}</span>
                  <span>{spof.name}</span>
                  {spof.namespace && <span className="text-slate-500">({spof.namespace})</span>}
                </li>
              ))}
            </ul>
          </DetailPanel>
        )}

        {expanded === 'warn' && (
          <DetailPanel id="warn">
            <ul className="space-y-0.5">
              {data.warnings.slice(0, 5).map((w, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
              {data.warnings.length > 5 && <li className="text-slate-500">+{data.warnings.length - 5} more</li>}
            </ul>
          </DetailPanel>
        )}
      </AnimatePresence>

      {/* Confidence footer */}
      <p className="text-[10px] text-slate-500 select-none">
        Based on current cluster state
        {manifestFilename && <span> · <span className="font-mono">{manifestFilename}</span></span>}
      </p>
    </div>
  );
}

// --- Main export ---
export interface ImpactBarProps {
  mode: WorkspaceMode;
  blastData?: BlastRadiusResult | null;
  previewData?: PreviewResult | null;
  isLoading?: boolean;
  manifestFilename?: string;
}

export function ImpactBar({ mode, blastData, previewData, isLoading, manifestFilename }: ImpactBarProps) {
  return (
    <div
      className={cn(
        'w-full bg-slate-900 border-t border-slate-800/70 px-4 py-3',
        'text-white text-sm',
      )}
      role="complementary"
      aria-label="Impact summary"
    >
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-slate-400 text-[13px]"
          >
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            Analyzing impact…
          </motion.div>
        ) : mode === 'live' && blastData ? (
          <motion.div
            key="live"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <LiveImpactBar data={blastData} />
          </motion.div>
        ) : mode === 'preview' && previewData ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <PreviewImpactBar data={previewData} manifestFilename={manifestFilename} />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-slate-500 text-[12px]"
          >
            {mode === 'live' ? 'Select a resource to see blast radius impact.' : 'Upload a manifest to preview impact.'}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
