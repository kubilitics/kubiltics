import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Search,
  Zap,
  Target,
  Clock,
  ArrowRight,
  Info,
  ChevronRight,
} from 'lucide-react';
import {
  useAnalyticsAnomalies,
  useAnalyticsForecast,
  type Anomaly,
  type ForecastResponse,
} from '../../hooks/useAnalytics';

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalyticsTab = 'anomalies' | 'trends' | 'scores' | 'forecast';

// ─── Shared Helpers ───────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 80) return 'text-red-400';
  if (confidence >= 60) return 'text-amber-400';
  return 'text-yellow-400';
}

function confidenceBg(confidence: number): string {
  if (confidence >= 80) return 'bg-red-500/10 border-red-500/20';
  if (confidence >= 60) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-yellow-500/10 border-yellow-500/20';
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(2);
}

// ─── Anomaly Row ─────────────────────────────────────────────────────────────

function AnomalyRow({ anomaly, index }: { anomaly: Anomaly; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const parts = anomaly.resource_id.split('/');
  const name = parts[parts.length - 1] || anomaly.resource_id;
  const kind = parts.length >= 2 ? parts[parts.length - 2] : '';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      className={`border rounded-lg overflow-hidden cursor-pointer ${confidenceBg(anomaly.confidence)}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3 p-3">
        <div className={`mt-0.5 flex-shrink-0 ${confidenceColor(anomaly.confidence)}`}>
          <AlertTriangle size={14} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-zinc-100 truncate max-w-[120px]">
              {name}
            </span>
            {kind && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400 uppercase tracking-wider">
                {kind}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300 font-mono">
              {anomaly.metric_name}
            </span>
            <span className={`text-xs font-semibold ml-auto ${confidenceColor(anomaly.confidence)}`}>
              {anomaly.confidence}% conf
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-zinc-300">
              val: <span className="font-mono text-zinc-100">{formatValue(anomaly.value)}</span>
            </span>
            <span className="text-[10px] text-zinc-500">
              {timeAgo(anomaly.timestamp)}
            </span>
          </div>
        </div>

        <ChevronRight
          size={12}
          className={`flex-shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t border-zinc-700/40 pt-2">
              <p className="text-xs text-zinc-400 leading-relaxed">{anomaly.reason}</p>
              <p className="text-[10px] text-zinc-600 mt-1 font-mono">{anomaly.resource_id}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Anomalies Tab ────────────────────────────────────────────────────────────

function AnomaliesTab() {
  const [namespace, setNamespace] = useState('');
  const [filterInput, setFilterInput] = useState('');

  const { data, loading, error, lastRefreshedAt, refresh } = useAnalyticsAnomalies({
    namespace,
    limit: 50,
    pollIntervalMs: 20_000,
  });

  const anomalies = data?.anomalies ?? [];
  const filtered = filterInput
    ? anomalies.filter(
        (a) =>
          a.resource_id.toLowerCase().includes(filterInput.toLowerCase()) ||
          a.metric_name.toLowerCase().includes(filterInput.toLowerCase()) ||
          a.reason.toLowerCase().includes(filterInput.toLowerCase())
      )
    : anomalies;

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Filter anomalies..."
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg pl-7 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <input
          type="text"
          placeholder="namespace"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          className="w-28 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
        />
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:border-violet-500/50 transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 mb-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          {anomalies.filter((a) => a.confidence >= 80).length} critical
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          {anomalies.filter((a) => a.confidence >= 60 && a.confidence < 80).length} warning
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
          {anomalies.filter((a) => a.confidence < 60).length} info
        </span>
        {lastRefreshedAt && (
          <span className="ml-auto">updated {timeAgo(lastRefreshedAt.toISOString())}</span>
        )}
      </div>

      {/* Anomaly list */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {error ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-300">{error}</span>
          </div>
        ) : loading && !data ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-zinc-800/40 border border-zinc-700/30 animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
              <Activity size={20} className="text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-zinc-300">No anomalies detected</p>
            <p className="text-xs text-zinc-600 mt-1">
              {namespace ? `Namespace "${namespace}" is healthy` : 'All systems nominal'}
            </p>
          </div>
        ) : (
          filtered.map((a, i) => (
            <AnomalyRow key={`${a.resource_id}-${a.metric_name}-${i}`} anomaly={a} index={i} />
          ))
        )}
      </div>

      {data && filtered.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-800/60 text-[10px] text-zinc-600 text-center">
          Showing {filtered.length} of {data.total} anomalies
        </div>
      )}
    </div>
  );
}

// ─── Trend Visualizer ────────────────────────────────────────────────────────

function TrendIcon({ direction }: { direction: string }) {
  if (direction === 'increasing') return <TrendingUp size={14} className="text-red-400" />;
  if (direction === 'decreasing') return <TrendingDown size={14} className="text-emerald-400" />;
  return <Minus size={14} className="text-zinc-400" />;
}

// ─── Trends Tab ───────────────────────────────────────────────────────────────

function TrendsTab() {
  const [resourceId, setResourceId] = useState('');
  const [metric, setMetric] = useState('cpu_usage');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const METRICS = ['cpu_usage', 'memory_usage', 'restart_count', 'availability', 'error_rate'];

  const fetchTrend = useCallback(async () => {
    if (!resourceId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ resource_id: resourceId, metric });
      const res = await window.fetch(`/api/v1/analytics/pipeline/trends?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [resourceId, metric]);

  const trend = result?.trend as Record<string, unknown> | undefined;
  const direction = (trend?.direction as string) || 'unknown';
  const strength = (trend?.strength as string) || '';

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Input form */}
      <div className="space-y-2">
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Resource ID</label>
        <input
          type="text"
          placeholder="e.g. default/Pod/my-app"
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchTrend()}
          className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
        />

        <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Metric</label>
        <div className="flex gap-1.5 flex-wrap">
          {METRICS.map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                metric === m
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                  : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 hover:border-violet-500/30 hover:text-zinc-300'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <button
          onClick={fetchTrend}
          disabled={loading || !resourceId.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-600/30 hover:border-violet-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <RefreshCw size={12} className="animate-spin" /> Analyzing…
            </>
          ) : (
            <>
              <BarChart2 size={12} /> Analyze Trend
            </>
          )}
        </button>
      </div>

      {/* Results */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
          >
            <AlertTriangle size={13} className="text-red-400" />
            <span className="text-xs text-red-300">{error}</span>
          </motion.div>
        )}

        {result && trend && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 overflow-y-auto space-y-3"
          >
            {/* Direction badge */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/40">
              <TrendIcon direction={direction} />
              <div>
                <p className="text-sm font-semibold text-zinc-100 capitalize">
                  {direction === 'unknown' ? 'Insufficient data' : `${direction} trend`}
                </p>
                {strength && (
                  <p className="text-xs text-zinc-500 capitalize">{strength} signal</p>
                )}
              </div>
            </div>

            {/* Metrics grid */}
            {[
              {
                label: 'Current Value',
                value: trend.current_value != null ? formatValue(trend.current_value as number) : '—',
                icon: <Activity size={11} />,
              },
              {
                label: 'Hourly Growth',
                value:
                  trend.hourly_growth_rate != null
                    ? `${(trend.hourly_growth_rate as number) >= 0 ? '+' : ''}${formatValue(
                        trend.hourly_growth_rate as number
                      )}/h`
                    : '—',
                icon: <TrendingUp size={11} />,
              },
              {
                label: 'R² Fit',
                value:
                  trend.r_squared != null
                    ? `${((trend.r_squared as number) * 100).toFixed(0)}%`
                    : '—',
                icon: <Target size={11} />,
              },
              {
                label: '24h Forecast',
                value:
                  trend.forecast_24h != null ? formatValue(trend.forecast_24h as number) : '—',
                icon: <ArrowRight size={11} />,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/30"
              >
                <span className="text-zinc-500">{item.icon}</span>
                <span className="text-xs text-zinc-400 flex-1">{item.label}</span>
                <span className="text-xs font-mono text-zinc-100">{item.value}</span>
              </div>
            ))}

            <p className="text-[10px] text-zinc-600 text-center">
              Analyzed {(trend.data_points as number) ?? 0} data points over 24h window
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
            <BarChart2 size={20} className="text-violet-400" />
          </div>
          <p className="text-xs text-zinc-400">Enter a resource ID to analyze trends</p>
          <p className="text-[10px] text-zinc-600 mt-1">Format: namespace/Kind/name</p>
        </div>
      )}
    </div>
  );
}

// ─── Scores Tab ───────────────────────────────────────────────────────────────

function ScoresTab() {
  const [resourceId, setResourceId] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScore = useCallback(async () => {
    if (!resourceId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ resource_id: resourceId });
      const res = await window.fetch(`/api/v1/analytics/pipeline/scores?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

  const health = result?.health as Record<string, unknown> | undefined;
  const score = (health?.score as number) ?? (result?.overall_score as number) ?? null;
  const status = (health?.status as string) ?? '';

  function scoreColor(s: number): string {
    if (s >= 80) return 'text-emerald-400';
    if (s >= 60) return 'text-amber-400';
    return 'text-red-400';
  }

  function scoreArcColor(s: number): string {
    if (s >= 80) return '#10b981';
    if (s >= 60) return '#f59e0b';
    return '#ef4444';
  }

  const r = 36;
  const circumference = 2 * Math.PI * r;
  const arc = score != null ? circumference - (score / 100) * circumference : circumference;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Input */}
      <div className="space-y-2">
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Resource ID</label>
        <input
          type="text"
          placeholder="e.g. default/Pod/my-app"
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchScore()}
          className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
        />
        <button
          onClick={fetchScore}
          disabled={loading || !resourceId.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-600/30 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw size={12} className="animate-spin" /> Scoring…
            </>
          ) : (
            <>
              <Zap size={12} /> Compute Score
            </>
          )}
        </button>
      </div>

      {/* Results */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
          >
            <AlertTriangle size={13} className="text-red-400" />
            <span className="text-xs text-red-300">{error}</span>
          </motion.div>
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 overflow-y-auto"
          >
            {/* Score ring */}
            {score != null && (
              <div className="flex items-center gap-6 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/40 mb-3">
                <div className="relative flex-shrink-0">
                  <svg width="88" height="88" viewBox="0 0 88 88">
                    <circle cx="44" cy="44" r={r} fill="none" stroke="#27272a" strokeWidth="8" />
                    <motion.circle
                      cx="44"
                      cy="44"
                      r={r}
                      fill="none"
                      stroke={scoreArcColor(score)}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      initial={{ strokeDashoffset: circumference }}
                      animate={{ strokeDashoffset: arc }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                      transform="rotate(-90 44 44)"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</span>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Health Score</p>
                  <p className={`text-xs capitalize mt-0.5 ${scoreColor(score)}`}>{status || 'computed'}</p>
                  <p className="text-[10px] text-zinc-600 mt-1 font-mono truncate max-w-[120px]">
                    {resourceId}
                  </p>
                </div>
              </div>
            )}

            {/* Details */}
            {health?.details && typeof health.details === 'object' && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Breakdown</p>
                {Object.entries(health.details as Record<string, unknown>).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-700/30"
                  >
                    <span className="text-xs text-zinc-400 flex-1 capitalize">
                      {k.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs font-mono text-zinc-200">
                      {typeof v === 'number' ? v.toFixed(1) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
            <Zap size={20} className="text-violet-400" />
          </div>
          <p className="text-xs text-zinc-400">Compute a health score for any resource</p>
          <p className="text-[10px] text-zinc-600 mt-1">
            Analyzes restarts, errors, CPU, memory, and availability
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Forecast Tab ─────────────────────────────────────────────────────────────

function ForecastTab() {
  const [resourceId, setResourceId] = useState('');
  const [metric, setMetric] = useState('cpu_usage');
  const [horizon, setHorizon] = useState('1h');
  const [capacity, setCapacity] = useState('');
  const [threshold, setThreshold] = useState('');

  const { data, loading, error, submit } = useAnalyticsForecast();

  const handleSubmit = useCallback(() => {
    if (!resourceId.trim()) return;
    submit({
      resource_id: resourceId,
      metric_name: metric,
      horizon,
      capacity: capacity ? parseFloat(capacity) : undefined,
      threshold: threshold ? parseFloat(threshold) : undefined,
    });
  }, [resourceId, metric, horizon, capacity, threshold, submit]);

  const forecast = data?.forecast;
  const trend = data?.trend;
  const cc = data?.capacity_comparison as Record<string, unknown> | undefined;
  const tc = data?.threshold_crossing as Record<string, unknown> | undefined;

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {/* Form */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Resource ID</label>
            <input
              type="text"
              placeholder="default/Pod/web"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              className="w-full mt-1 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Metric</label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full mt-1 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-violet-500/50"
            >
              {['cpu_usage', 'memory_usage', 'restart_count', 'availability', 'error_rate'].map(
                (m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                )
              )}
            </select>
          </div>
        </div>

        {/* Horizon */}
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Horizon</label>
          <div className="flex gap-1.5 mt-1">
            {['30m', '1h', '6h', '1d', '7d'].map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`flex-1 text-[10px] py-1 rounded-md border transition-colors ${
                  horizon === h
                    ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                    : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 hover:border-violet-500/30'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        {/* Optional fields */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Capacity (opt)
            </label>
            <input
              type="number"
              placeholder="e.g. 100"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="w-full mt-1 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Threshold (opt)
            </label>
            <input
              type="number"
              placeholder="e.g. 80"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full mt-1 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !resourceId.trim()}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-600/30 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw size={12} className="animate-spin" /> Forecasting…
            </>
          ) : (
            <>
              <TrendingUp size={12} /> Run Forecast
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-300">{error}</span>
        </div>
      )}

      {/* Forecast result */}
      <AnimatePresence>
        {data && forecast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Point estimate card */}
            <div className="p-4 rounded-xl bg-zinc-800/60 border border-zinc-700/40">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-zinc-500">Forecast in {horizon}</p>
                  <p className="text-2xl font-bold text-zinc-100 mt-0.5">
                    {forecast.point_estimate != null
                      ? formatValue(forecast.point_estimate)
                      : '—'}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-700/60 text-zinc-400 uppercase">
                  {forecast.method}
                </span>
              </div>

              {/* CI bar */}
              {forecast.confidence_low != null && forecast.confidence_high != null && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Low: {formatValue(forecast.confidence_low)}</span>
                    <span>{forecast.confidence_level}% CI</span>
                    <span>High: {formatValue(forecast.confidence_high)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-700/60 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-violet-500/60"
                      initial={{ width: 0 }}
                      animate={{ width: `${forecast.confidence_level}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              )}

              <p className="text-[10px] text-zinc-600 mt-2">
                Based on {forecast.data_points} data points
              </p>
            </div>

            {/* Trend summary */}
            {trend && trend.direction !== 'unknown' && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/40 border border-zinc-700/30">
                <TrendIcon direction={trend.direction} />
                <div className="flex-1">
                  <p className="text-xs text-zinc-300 capitalize">
                    {trend.direction} — {trend.strength || 'trend'}
                  </p>
                  {trend.hourly_growth_rate != null && (
                    <p className="text-[10px] text-zinc-500">
                      {(trend.hourly_growth_rate as number) >= 0 ? '+' : ''}
                      {formatValue(trend.hourly_growth_rate as number)}/h growth rate
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Capacity comparison */}
            {cc && (
              <div
                className={`p-3 rounded-lg border ${
                  cc.will_exceed
                    ? 'bg-red-500/10 border-red-500/20'
                    : 'bg-emerald-500/10 border-emerald-500/20'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Target size={12} className={cc.will_exceed ? 'text-red-400' : 'text-emerald-400'} />
                  <span className={`text-xs font-medium ${cc.will_exceed ? 'text-red-300' : 'text-emerald-300'}`}>
                    Capacity: {(cc.utilization_pct as number)?.toFixed(0)}% utilization forecasted
                  </span>
                </div>
                {cc.recommended_action && (
                  <p className="text-[10px] text-zinc-400">{String(cc.recommended_action)}</p>
                )}
              </div>
            )}

            {/* Threshold crossing */}
            {tc && (tc.found as boolean) && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={12} className="text-amber-400" />
                  <span className="text-xs font-medium text-amber-300">
                    Threshold crossing predicted
                    {(tc.is_imminent as boolean) && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 bg-red-500/20 border border-red-500/30 rounded text-red-400 animate-pulse">
                        imminent
                      </span>
                    )}
                  </span>
                </div>
                {tc.predicted_time && (
                  <p className="text-[10px] text-zinc-400">
                    at {new Date(tc.predicted_time as string).toLocaleTimeString()} · {tc.confidence}% confidence
                  </p>
                )}
              </div>
            )}

            {/* Info row */}
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
              <Info size={10} />
              <span>Forecast generated {timeAgo(data.timestamp)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!data && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
            <TrendingUp size={20} className="text-violet-400" />
          </div>
          <p className="text-xs text-zinc-400">Forecast future metric values</p>
          <p className="text-[10px] text-zinc-600 mt-1">
            Uses ARIMA or linear regression with confidence intervals
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const TABS: { id: AnalyticsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle size={12} /> },
  { id: 'trends', label: 'Trends', icon: <BarChart2 size={12} /> },
  { id: 'scores', label: 'Scores', icon: <Zap size={12} /> },
  { id: 'forecast', label: 'Forecast', icon: <TrendingUp size={12} /> },
];

export function AnalyticsPanel() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('anomalies');

  const { data: anomalyData } = useAnalyticsAnomalies({
    pollIntervalMs: 30_000,
  });
  const anomalyCount = anomalyData?.total ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-800/60">
        <div className="p-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <Activity size={14} className="text-orange-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Analytics</h3>
          <p className="text-[10px] text-zinc-500">
            Real-time anomaly detection &amp; forecasting
          </p>
        </div>
        {anomalyCount > 0 && (
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400 font-medium animate-pulse">
            {anomalyCount} anomalies
          </span>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-0.5 mb-4 bg-zinc-900/60 p-0.5 rounded-lg border border-zinc-800/40">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${
              activeTab === tab.id
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-400'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeTab === 'anomalies' && <AnomaliesTab />}
            {activeTab === 'trends' && <TrendsTab />}
            {activeTab === 'scores' && <ScoresTab />}
            {activeTab === 'forecast' && <ForecastTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
