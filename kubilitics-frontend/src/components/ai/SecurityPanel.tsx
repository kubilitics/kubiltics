// A-CORE-012: Security Analysis Panel
// 4 sub-tabs: Posture, RBAC, Network, Compliance
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Lock,
  Network,
  Key,
  FileCheck,
  ChevronRight,
  XCircle,
  Info,
} from 'lucide-react';
import {
  useSecurityPosture,
  useSecurityIssues,
  useSecurityRBAC,
  useSecurityNetwork,
  useSecuritySecrets,
  useSecurityCompliance,
  useImageScan,
  type Severity,
  type ComplianceStatus,
  type RBACFinding,
  type NetworkPolicyGap,
  type SecretExposure,
  type ComplianceCheck,
} from '../../hooks/useSecurityAnalysis';

// ─── Types ────────────────────────────────────────────────────────────────────

type SecurityTab = 'posture' | 'rbac' | 'network' | 'compliance';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityColor(s: Severity | string): string {
  const upper = s?.toUpperCase();
  if (upper === 'CRITICAL') return 'text-red-400';
  if (upper === 'HIGH') return 'text-orange-400';
  if (upper === 'MEDIUM') return 'text-yellow-400';
  if (upper === 'LOW') return 'text-blue-400';
  return 'text-slate-400';
}

function severityBg(s: Severity | string): string {
  const upper = s?.toUpperCase();
  if (upper === 'CRITICAL') return 'bg-red-500/10 border-red-500/30';
  if (upper === 'HIGH') return 'bg-orange-500/10 border-orange-500/30';
  if (upper === 'MEDIUM') return 'bg-yellow-500/10 border-yellow-500/30';
  if (upper === 'LOW') return 'bg-blue-500/10 border-blue-500/30';
  return 'bg-slate-500/10 border-slate-500/30';
}

function statusIcon(status: ComplianceStatus) {
  if (status === 'pass') return <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (status === 'fail') return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  if (status === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />;
  return <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
}

function scoreRing(score: number, grade: string) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const gradeColor: Record<string, string> = { A: '#10b981', B: '#22c55e', C: '#eab308', D: '#f97316', F: '#ef4444' };
  const color = gradeColor[grade] ?? '#64748b';
  return { r, circ, dash, color };
}

// ─── Security Score Ring ──────────────────────────────────────────────────────

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const { r, circ, dash, color } = scoreRing(score, grade);
  return (
    <div className="relative flex items-center justify-center">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#1e293b" strokeWidth="6" />
        <motion.circle
          cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ / 4}
          initial={{ strokeDasharray: `0 ${circ}` }}
          animate={{ strokeDasharray: `${dash} ${circ}` }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-bold text-white">{score}</span>
        <span className="text-xs" style={{ color }}>{grade}</span>
      </div>
    </div>
  );
}

// ─── Posture Tab ──────────────────────────────────────────────────────────────

function PostureTab() {
  const { data, loading, error, lastRefreshedAt, refresh } = useSecurityPosture({ pollIntervalMs: 60_000 });
  const { data: issuesData } = useSecurityIssues();
  const { data: secretsData } = useSecuritySecrets();
  const [scanImage, setScanImage] = useState('');
  const { data: scanResult, loading: scanLoading, error: scanError, scan } = useImageScan();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 text-red-400 animate-spin mr-2" />
        <span className="text-sm text-slate-400">Analyzing cluster security…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm p-4">
        <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
      </div>
    );
  }

  const posture = data;
  const summary = posture?.summary ?? { total: 0, critical: 0, high: 0, medium: 0, low: 0 };

  return (
    <div className="space-y-4">
      {/* Score + summary */}
      {posture && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center gap-4">
          <ScoreRing score={posture.score} grade={posture.grade} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Security Score</p>
            <div className="grid grid-cols-2 gap-1 mt-1">
              {[
                { label: 'Critical', val: summary.critical, color: 'text-red-400' },
                { label: 'High', val: summary.high, color: 'text-orange-400' },
                { label: 'Medium', val: summary.medium, color: 'text-yellow-400' },
                { label: 'Low', val: summary.low, color: 'text-blue-400' },
              ].map(({ label, val, color }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className={`font-medium ${color}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      {posture && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-orange-400">{posture.rbac_findings}</p>
            <p className="text-xs text-slate-400">RBAC Issues</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-yellow-400">{posture.network_gaps}</p>
            <p className="text-xs text-slate-400">Net Gaps</p>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-red-400">{posture.secret_exposures}</p>
            <p className="text-xs text-slate-400">Secret Risks</p>
          </div>
        </div>
      )}

      {/* Secret exposures quick list */}
      {secretsData && secretsData.total > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Secret Exposures ({secretsData.total})
          </p>
          {secretsData.exposures.slice(0, 3).map((ex: SecretExposure, i: number) => (
            <div key={i} className={`border rounded-lg px-3 py-2 ${severityBg(ex.risk_level)}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Key className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  <span className="text-xs font-medium text-white truncate">{ex.name}</span>
                </div>
                <span className={`text-xs font-medium shrink-0 ml-2 ${severityColor(ex.risk_level)}`}>
                  {ex.risk_level}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{ex.namespace}</p>
            </div>
          ))}
        </div>
      )}

      {/* Top issues */}
      {issuesData && issuesData.issues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Top Issues
          </p>
          {issuesData.issues.slice(0, 4).map((iss, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`border rounded-lg px-3 py-2 ${severityBg(iss.severity)}`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${severityColor(iss.severity)}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white">{iss.title}</p>
                  <p className="text-xs text-slate-400 truncate">{iss.resource}{iss.namespace ? ` · ${iss.namespace}` : ''}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Image scanner */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 space-y-2">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Image Vulnerability Scan</p>
        <div className="flex gap-2">
          <input
            value={scanImage}
            onChange={e => setScanImage(e.target.value)}
            placeholder="nginx:1.21 or alpine:3.18"
            className="flex-1 bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-red-500/50"
          />
          <button
            onClick={() => scanImage && scan(scanImage)}
            disabled={scanLoading || !scanImage}
            className="px-3 py-1.5 bg-red-500/20 border border-red-500/30 text-red-300 text-xs rounded-lg hover:bg-red-500/30 disabled:opacity-50 transition-colors"
          >
            {scanLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Scan'}
          </button>
        </div>
        {scanError && <p className="text-xs text-red-400">{scanError}</p>}
        {scanResult && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className={`border rounded-lg px-3 py-2 ${scanResult.risk_level === 'CRITICAL' || scanResult.risk_level === 'HIGH' ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}
          >
            <div className="flex justify-between text-xs">
              <span className="text-slate-300 font-medium">{scanResult.image}</span>
              <span className={severityColor(scanResult.risk_level as Severity)}>{scanResult.risk_level}</span>
            </div>
            <div className="flex gap-3 mt-1 text-xs text-slate-400">
              <span><span className="text-red-400 font-medium">{scanResult.critical_count}</span> CRIT</span>
              <span><span className="text-orange-400 font-medium">{scanResult.high_count}</span> HIGH</span>
              <span><span className="text-yellow-400 font-medium">{scanResult.medium_count}</span> MED</span>
              <span className="ml-auto">Score: {scanResult.risk_score.toFixed(0)}/100</span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Meta */}
      {posture && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{posture.pod_scanned} pods · {posture.roles_audited} roles · {posture.namespaces} ns</span>
          <button onClick={refresh}
            className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString() : 'Refresh'}
          </button>
        </div>
      )}

      {/* Recommendations */}
      {posture?.recommendations && posture.recommendations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Recommendations</p>
          {posture.recommendations.slice(0, 4).map((rec, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
              <ChevronRight className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <span>{rec}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── RBAC Tab ─────────────────────────────────────────────────────────────────

function RBACTab() {
  const { data, loading, error, refresh } = useSecurityRBAC();

  if (loading && !data) return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="h-5 w-5 text-red-400 animate-spin mr-2" />
      <span className="text-sm text-slate-400">Auditing RBAC…</span>
    </div>
  );
  if (error) return <div className="flex items-center gap-2 text-red-400 text-sm p-4"><AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span></div>;

  const findings: RBACFinding[] = data?.findings ?? [];
  const bySev = data?.by_severity ?? {};

  return (
    <div className="space-y-3">
      {/* Severity summary */}
      {data && (
        <div className="grid grid-cols-4 gap-1.5">
          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(sev => (
            <div key={sev} className={`border rounded-lg p-2 text-center ${severityBg(sev)}`}>
              <p className={`text-lg font-bold ${severityColor(sev)}`}>{bySev[sev] ?? 0}</p>
              <p className="text-xs text-slate-400">{sev.slice(0, 4)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{findings.length} findings · {data?.roles_audited ?? 0} roles audited</p>
        <button onClick={refresh} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {findings.length === 0 && !loading && (
        <div className="flex items-center gap-2 py-8 justify-center text-emerald-400">
          <CheckCircle className="h-5 w-5" />
          <span className="text-sm">No RBAC issues found</span>
        </div>
      )}

      {findings.map((f, idx) => (
        <motion.div
          key={`${f.name}-${idx}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.03 }}
          className={`border rounded-lg p-3 ${severityBg(f.severity)}`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <Lock className={`h-3.5 w-3.5 shrink-0 ${severityColor(f.severity)}`} />
              <span className="text-sm font-medium text-white truncate">{f.name}</span>
            </div>
            <span className={`text-xs font-medium shrink-0 ml-2 ${severityColor(f.severity)}`}>{f.severity}</span>
          </div>
          <p className="text-xs text-slate-400 mb-1">{f.resource_type}{f.namespace ? ` · ${f.namespace}` : ''}</p>
          {f.issues.slice(0, 2).map((issue, i) => (
            <p key={i} className="text-xs text-slate-300">• {issue}</p>
          ))}
          {f.issues.length > 2 && (
            <p className="text-xs text-slate-500">+{f.issues.length - 2} more issues</p>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// ─── Network Tab ──────────────────────────────────────────────────────────────

function NetworkTab() {
  const { data, loading, error, refresh } = useSecurityNetwork();

  if (loading && !data) return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="h-5 w-5 text-red-400 animate-spin mr-2" />
      <span className="text-sm text-slate-400">Analyzing network policies…</span>
    </div>
  );
  if (error) return <div className="flex items-center gap-2 text-red-400 text-sm p-4"><AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span></div>;

  const gaps: NetworkPolicyGap[] = data?.gaps ?? [];

  return (
    <div className="space-y-3">
      {/* Summary banner */}
      {data && (
        <div className={`border rounded-xl p-3 ${data.total_gaps > 0 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
          <div className="flex items-center gap-2">
            <Network className={`h-4 w-4 ${data.total_gaps > 0 ? 'text-yellow-400' : 'text-emerald-400'}`} />
            <div>
              <p className={`text-xs font-medium ${data.total_gaps > 0 ? 'text-yellow-300' : 'text-emerald-300'}`}>
                {data.total_gaps > 0
                  ? `${data.total_gaps} namespace(s) with no NetworkPolicy`
                  : 'All namespaces have network policies'}
              </p>
              <p className="text-xs text-slate-400">
                {data.total_pods_exposed} pods exposed · {data.namespaces_scanned} namespaces scanned
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{gaps.length} gaps detected</p>
        <button onClick={refresh} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {gaps.length === 0 && !loading && (
        <div className="flex items-center gap-2 py-8 justify-center text-emerald-400">
          <CheckCircle className="h-5 w-5" />
          <span className="text-sm">No network policy gaps</span>
        </div>
      )}

      {gaps.map((gap, idx) => (
        <motion.div
          key={gap.namespace}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.04 }}
          className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Network className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
              <span className="text-sm font-medium text-white">{gap.namespace}</span>
            </div>
            <span className="text-xs text-yellow-400">{gap.pod_count} pods</span>
          </div>
          <p className="text-xs text-slate-300 mb-1">{gap.description}</p>
          <p className="text-xs text-slate-500">{gap.remediation}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Compliance Tab ───────────────────────────────────────────────────────────

function ComplianceTab() {
  const { data, loading, error, refresh } = useSecurityCompliance();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  if (loading && !data) return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="h-5 w-5 text-red-400 animate-spin mr-2" />
      <span className="text-sm text-slate-400">Loading CIS compliance…</span>
    </div>
  );
  if (error) return <div className="flex items-center gap-2 text-red-400 text-sm p-4"><AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span></div>;

  if (!data || !data.checks) return (
    <div className="text-center py-8 text-slate-500 text-sm">
      No compliance data yet. Run a security scan from the Posture tab.
    </div>
  );

  const score = data.compliance_score ?? 0;
  const passBar = data.total_checks > 0 ? (data.passed_checks / data.total_checks) * 100 : 0;
  const failBar = data.total_checks > 0 ? (data.failed_checks / data.total_checks) * 100 : 0;
  const warnBar = data.total_checks > 0 ? (data.warning_checks / data.total_checks) * 100 : 0;

  // Group checks by section.
  const sections: Record<string, ComplianceCheck[]> = {};
  for (const check of data.checks) {
    const sec = check.section ?? 'General';
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(check);
  }

  return (
    <div className="space-y-3">
      {/* Score header */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold text-white">CIS Kubernetes Benchmark</span>
          </div>
          <span className={`text-lg font-bold ${score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
            {score.toFixed(0)}%
          </span>
        </div>
        {/* Stacked bar */}
        <div className="flex h-2 rounded-full overflow-hidden gap-px">
          <motion.div className="bg-emerald-500 h-full" initial={{ width: '0%' }} animate={{ width: `${passBar}%` }} transition={{ duration: 0.6 }} />
          <motion.div className="bg-yellow-500 h-full" initial={{ width: '0%' }} animate={{ width: `${warnBar}%` }} transition={{ duration: 0.6 }} />
          <motion.div className="bg-red-500 h-full" initial={{ width: '0%' }} animate={{ width: `${failBar}%` }} transition={{ duration: 0.6 }} />
        </div>
        <div className="flex gap-3 mt-1.5 text-xs text-slate-400">
          <span className="text-emerald-400">{data.passed_checks} pass</span>
          <span className="text-yellow-400">{data.warning_checks} warn</span>
          <span className="text-red-400">{data.failed_checks} fail</span>
          <span className="ml-auto">/{data.total_checks} total</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Checks by Section</p>
        <button onClick={refresh} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {Object.entries(sections).map(([section, checks]) => {
        const failCount = checks.filter(c => c.status === 'fail').length;
        const isExpanded = expandedSection === section;
        return (
          <div key={section} className="bg-slate-800/60 border border-slate-700/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedSection(isExpanded ? null : section)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-700/30 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileCheck className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-xs font-medium text-white truncate">{section}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {failCount > 0 && <span className="text-xs text-red-400">{failCount} fail</span>}
                <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </div>
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="border-t border-slate-700/50 px-3 pb-2"
                >
                  {checks.map((check, i) => (
                    <div key={check.id} className={`py-1.5 ${i < checks.length - 1 ? 'border-b border-slate-700/30' : ''}`}>
                      <div className="flex items-start gap-2">
                        {statusIcon(check.status)}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white">{check.id} — {check.title}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{check.details}</p>
                          {check.status === 'fail' && check.remediation && (
                            <p className="text-xs text-slate-500 mt-0.5 italic">{check.remediation}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ─── SecurityPanel ────────────────────────────────────────────────────────────

const TABS: { id: SecurityTab; label: string; icon: React.ElementType }[] = [
  { id: 'posture',    label: 'Posture',    icon: Shield },
  { id: 'rbac',      label: 'RBAC',       icon: Lock },
  { id: 'network',   label: 'Network',    icon: Network },
  { id: 'compliance', label: 'CIS',       icon: FileCheck },
];

export function SecurityPanel() {
  const [activeTab, setActiveTab] = useState<SecurityTab>('posture');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold text-white">Security Analysis</span>
        </div>
        <span className="text-xs text-slate-500">A-CORE-012</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 py-2">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                active
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pr-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {activeTab === 'posture'    && <PostureTab />}
            {activeTab === 'rbac'       && <RBACTab />}
            {activeTab === 'network'    && <NetworkTab />}
            {activeTab === 'compliance' && <ComplianceTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
