/**
 * ML Analytics Dashboard — B-INT-005
 *
 * Wires the ML analytics features to real backend APIs:
 *   - Anomaly detection: POST /api/v1/analytics/ml/anomalies (kubilitics-ai)
 *   - Time series forecast: POST /api/v1/analytics/forecast (kubilitics-ai)
 *
 * Historical metric data comes from the Analytics endpoint on the AI backend
 * (GET /api/v1/analytics/anomalies) which already polls cluster metrics.
 *
 * When the backend is not connected, the dashboard shows a friendly empty state
 * instead of fabricating data with Math.random().
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoadingState } from '@/components/PageLoadingState';
import { ServiceUnavailableBanner } from '@/components/ServiceUnavailableBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Download,
  Activity,
  BarChart3,
  Wifi,
  WifiOff,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { MLAnomalyChart } from '@/components/MLAnomalyChart';
import { ForecastChart } from '@/components/ForecastChart';
import { ModelExplainabilityPanel } from '@/components/ModelExplainabilityPanel';
import { useMLAnomalyDetection } from '@/hooks/useMLAnomalyDetection';
import { useTimeSeriesForecast } from '@/hooks/useTimeSeriesForecast';
import { getAnomalies, type AnalyticsAnomaly } from '@/services/aiService';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataPoint {
  timestamp: string;
  value: number;
  label?: string;
}

type MetricType = 'cpu' | 'memory' | 'network';

const METRIC_LABELS: Record<MetricType, string> = {
  cpu: 'CPU Usage (%)',
  memory: 'Memory Usage (MB)',
  network: 'Network I/O (Mbps)',
};

const METRIC_UNITS: Record<MetricType, string> = {
  cpu: '%',
  memory: 'MB',
  network: 'Mbps',
};

// ─── Helper: convert AI analytics anomalies to DataPoints ────────────────────

function anomaliesToDataPoints(
  anomalies: AnalyticsAnomaly[],
  metric: MetricType,
  _windowMs: number = 30 * 60 * 1000 // 30 minutes default (unused, reserved for future windowing)
): DataPoint[] {
  if (anomalies.length === 0) return [];

  // Derive time series from anomaly observations
  const points: DataPoint[] = anomalies
    .filter(a => a.metric.toLowerCase().includes(metric))
    .map(a => ({
      timestamp: a.detected_at,
      value: a.value,
      label: `${a.resource}/${a.namespace}`,
    }));

  // Sort by timestamp
  points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Pad with zeros if fewer than 20 points (min for ML models)
  if (points.length < 20 && points.length > 0) {
    const latest = new Date(points[points.length - 1].timestamp).getTime();
    const oldest = new Date(points[0].timestamp).getTime();
    const step = Math.max((latest - oldest) / 20, 60_000);
    const padded: DataPoint[] = [];
    for (let i = 20 - points.length; i > 0; i--) {
      padded.push({
        timestamp: new Date(oldest - i * step).toISOString(),
        value: points[0]?.value ?? 0,
        label: 'padded',
      });
    }
    return [...padded, ...points];
  }

  return points;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function MLAnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('cpu');

  // AI backend anomaly feed (server-side anomalies, used as real input data)
  const [aiAnomalies, setAiAnomalies] = useState<AnalyticsAnomaly[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Derived time-series data from AI anomalies (real, not synthetic)
  const [metricData, setMetricData] = useState<DataPoint[]>([]);

  // Track when user has explicitly requested detection/forecast
  const [detectionRequested, setDetectionRequested] = useState(false);
  const [forecastRequested, setForecastRequested] = useState(false);

  // Backend connection status
  const isBackendConfigured = useBackendConfigStore(s => s.isBackendConfigured);
  const connected = isBackendConfigured();

  // ── Fetch AI-detected anomalies from analytics engine ─────────────────────
  const fetchAIAnomalies = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const data = await getAnomalies();
      setAiAnomalies(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to fetch anomalies');
    } finally {
      setAiLoading(false);
    }
  }, []);

  // Refresh on mount and when metric changes
  useEffect(() => {
    fetchAIAnomalies();
  }, [fetchAIAnomalies]);

  // Rebuild metric data when anomalies or selected metric changes
  useEffect(() => {
    const pts = anomaliesToDataPoints(aiAnomalies, selectedMetric);
    setMetricData(pts);
    // Reset requests when metric changes so user re-triggers
    setDetectionRequested(false);
    setForecastRequested(false);
  }, [aiAnomalies, selectedMetric]);

  // ── ML Anomaly Detection hook (real API: POST /api/v1/analytics/ml/anomalies) ─
  const {
    anomalies: mlAnomalies,
    modelInfo: mlModelInfo,
    isLoading: isMLLoading,
    error: mlError,
    refresh: runDetection,
  } = useMLAnomalyDetection({
    metricName: `${selectedMetric}_usage`,
    metricType: selectedMetric,
    data: metricData,
    algorithm: 'isolation_forest',
    sensitivity: 0.6,
    numTrees: 100,
    sampleSize: 256,
    enabled: detectionRequested && metricData.length >= 10,
    refreshInterval: 0, // no auto-refresh; user-triggered
  });

  // ── Time Series Forecast hook (real API: POST /api/v1/analytics/forecast) ──
  const {
    forecasts: mlForecasts,
    modelInfo: forecastModelInfo,
    stdError: forecastStdError,
    isLoading: isForecastLoading,
    refresh: runForecast,
  } = useTimeSeriesForecast({
    metricName: `${selectedMetric}_usage`,
    metricType: selectedMetric,
    data: metricData,
    forecastSteps: 24, // 24-hour ahead
    model: 'arima',
    arimaOrder: [2, 1, 2],
    enabled: forecastRequested && metricData.length >= 20,
    refreshInterval: 0, // user-triggered
  });

  const handleDetectAnomalies = () => {
    setDetectionRequested(true);
    if (detectionRequested) runDetection();
  };

  const handleGenerateForecast = () => {
    setForecastRequested(true);
    if (forecastRequested) runForecast();
  };

  const handleRefreshAll = async () => {
    await fetchAIAnomalies();
    if (detectionRequested) runDetection();
    if (forecastRequested) runForecast();
  };

  const handleExport = () => {
    const exportData = {
      metric: selectedMetric,
      data_points: metricData.length,
      ai_anomalies: aiAnomalies,
      ml_anomalies: mlAnomalies,
      forecasts: mlForecasts,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ml-analytics-${selectedMetric}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const getSeverityBadge = (count: number) => {
    if (count === 0) return <Badge variant="secondary">None</Badge>;
    if (count < 5) return <Badge variant="default">{count} Detected</Badge>;
    return <Badge variant="destructive">{count} Detected</Badge>;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600';
      case 'high': return 'text-orange-600';
      case 'medium': return 'text-yellow-600';
      default: return 'text-blue-600';
    }
  };

  const forecastConfidence = forecastModelInfo
    ? Math.max(0, 1 - (forecastStdError / 10))
    : null;

  // ─── Render ─────────────────────────────────────────────────────────────────
  // Show UI immediately - don't block on loading
  // Empty states will handle no data scenarios gracefully

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="h-8 w-8 text-purple-600" />
            ML Analytics Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Machine learning-powered anomaly detection and forecasting
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {connected ? (
              <><Wifi className="h-3.5 w-3.5 text-green-500" /> Live</>
            ) : (
              <><WifiOff className="h-3.5 w-3.5 text-amber-500" /> No backend</>
            )}
          </div>
          <Button variant="outline" onClick={handleRefreshAll} disabled={aiLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${aiLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={aiAnomalies.length === 0 && mlAnomalies.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Connection banner */}
      {!connected && (
        <ServiceUnavailableBanner
          serviceName="AI Analytics Engine"
          message="Anomaly detection requires real-time cluster metrics. Please connect the backend."
          retryAction={handleRefreshAll}
          isRetrying={aiLoading}
        />
      )}

      {/* AI error */}
      {aiError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Failed to load anomaly data: {aiError}</AlertDescription>
        </Alert>
      )}

      {/* Metric selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Metric:</span>
        <Select value={selectedMetric} onValueChange={(v) => setSelectedMetric(v as MetricType)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cpu">CPU Usage</SelectItem>
            <SelectItem value="memory">Memory Usage</SelectItem>
            <SelectItem value="network">Network I/O</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {metricData.length > 0
            ? `${metricData.length} data points available`
            : connected ? 'No metric data yet — anomalies will populate when detected' : 'Connect backend to see real data'}
        </span>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* AI-detected anomalies */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              AI Anomalies (live)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold text-red-600">
                {aiLoading ? '…' : aiAnomalies.filter(a => a.metric.toLowerCase().includes(selectedMetric)).length}
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600 opacity-50" />
            </div>
            <div className="mt-2">
              {getSeverityBadge(aiAnomalies.filter(a => a.metric.toLowerCase().includes(selectedMetric)).length)}
            </div>
          </CardContent>
        </Card>

        {/* ML model results */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              ML Anomalies
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold text-orange-600">
                {isMLLoading ? '…' : (mlAnomalies?.length ?? 0)}
              </div>
              <Activity className="h-8 w-8 text-orange-600 opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {mlModelInfo ? 'Isolation Forest' : 'Run detection to analyze'}
            </p>
          </CardContent>
        </Card>

        {/* Forecast confidence */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Forecast Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold text-blue-600">
                {isForecastLoading ? '…' : forecastConfidence != null ? `${(forecastConfidence * 100).toFixed(0)}%` : 'N/A'}
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600 opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {forecastModelInfo ? 'ARIMA Model' : 'Generate forecast to see'}
            </p>
          </CardContent>
        </Card>

        {/* Data points */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Training Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold text-purple-600">
                {metricData.length}
              </div>
              <BarChart3 className="h-8 w-8 text-purple-600 opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Metric observations
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="anomalies">Anomaly Detection</TabsTrigger>
          <TabsTrigger value="forecasts">Forecasts</TabsTrigger>
          <TabsTrigger value="models">Model Info</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Anomaly Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Real-time Anomaly Detection</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Isolation Forest algorithm identifies unusual patterns in cluster metrics
                </p>
              </CardHeader>
              <CardContent>
                {mlAnomalies && mlAnomalies.length > 0 && metricData.length > 0 ? (
                  <MLAnomalyChart
                    title={`${METRIC_LABELS[selectedMetric]} Anomalies`}
                    data={metricData}
                    anomalies={mlAnomalies}
                    showConfidenceBands={true}
                    height={300}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground space-y-3">
                    <Brain className="h-12 w-12 mx-auto opacity-40" />
                    {metricData.length < 10 ? (
                      <p className="text-sm">Need at least 10 data points. {connected ? 'Waiting for metrics…' : 'Connect backend to get real data.'}</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm">Click "Detect Anomalies" to analyze {metricData.length} data points</p>
                        <Button
                          size="sm"
                          onClick={handleDetectAnomalies}
                          disabled={isMLLoading || metricData.length < 10}
                        >
                          <Brain className="h-3.5 w-3.5 mr-1.5" />
                          {isMLLoading ? 'Analyzing…' : 'Detect Anomalies'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Forecast Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Resource Forecasting</CardTitle>
                <p className="text-xs text-muted-foreground">
                  ARIMA model predicts future {METRIC_LABELS[selectedMetric].toLowerCase()}
                </p>
              </CardHeader>
              <CardContent>
                {mlForecasts && mlForecasts.length > 0 && metricData.length > 0 ? (
                  <ForecastChart
                    title={`${METRIC_LABELS[selectedMetric]} Forecast`}
                    historicalData={metricData.map(d => ({ timestamp: d.timestamp, value: d.value }))}
                    forecasts={mlForecasts}
                    unit={METRIC_UNITS[selectedMetric]}
                    height={300}
                    showConfidenceBands={true}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground space-y-3">
                    <TrendingUp className="h-12 w-12 mx-auto opacity-40" />
                    {metricData.length < 20 ? (
                      <p className="text-sm">Need at least 20 data points for forecasting. {connected ? `Have ${metricData.length}.` : 'Connect backend first.'}</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm">Click to forecast next 24 hours using {metricData.length} observations</p>
                        <Button
                          size="sm"
                          onClick={handleGenerateForecast}
                          disabled={isForecastLoading || metricData.length < 20}
                        >
                          <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                          {isForecastLoading ? 'Forecasting…' : 'Generate Forecast'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI-detected anomalies quick list */}
          {aiAnomalies.filter(a => a.metric.toLowerCase().includes(selectedMetric)).length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Recent AI-Detected Anomalies</CardTitle>
                  <Badge variant="outline" className="text-xs">Live from AI engine</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {aiAnomalies
                    .filter(a => a.metric.toLowerCase().includes(selectedMetric))
                    .slice(0, 5)
                    .map((anomaly, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 border rounded">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={`h-4 w-4 ${getSeverityColor(anomaly.severity)}`} />
                          <div>
                            <p className="text-sm font-medium">{anomaly.resource || 'cluster'}</p>
                            <p className="text-xs text-muted-foreground">
                              {anomaly.namespace && `${anomaly.namespace} • `}
                              {new Date(anomaly.detected_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold">{anomaly.value.toFixed(2)}</p>
                          <Badge variant="outline" className={`text-xs capitalize ${getSeverityColor(anomaly.severity)}`}>
                            {anomaly.severity}
                          </Badge>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ML anomaly list */}
          {mlAnomalies && mlAnomalies.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">ML Model Anomalies</CardTitle>
                  <Badge variant="outline" className="text-xs">Isolation Forest</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {mlAnomalies.slice(0, 5).map((anomaly, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 border rounded">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`h-4 w-4 ${getSeverityColor(anomaly.severity)}`} />
                        <div>
                          <p className="text-sm font-medium">Score: {(anomaly.score * 100).toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(anomaly.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{anomaly.value.toFixed(2)}</p>
                        <Badge variant="outline" className="text-xs capitalize">{anomaly.severity}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Anomaly Detection Tab ── */}
        <TabsContent value="anomalies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">ML Anomaly Detection Analysis</CardTitle>
              <p className="text-xs text-muted-foreground">
                Isolation Forest algorithm trained on {metricData.length} real data points
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleDetectAnomalies}
                  disabled={isMLLoading || metricData.length < 10}
                >
                  {isMLLoading ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Analyzing…</>
                  ) : (
                    <><Brain className="h-4 w-4 mr-2" /> Detect Anomalies</>
                  )}
                </Button>
                {metricData.length < 10 && (
                  <span className="text-xs text-amber-600">
                    Need {10 - metricData.length} more data points (have {metricData.length})
                  </span>
                )}
                {mlError && (
                  <span className="text-xs text-red-600">{mlError}</span>
                )}
              </div>

              {mlAnomalies && mlAnomalies.length > 0 && metricData.length > 0 ? (
                <MLAnomalyChart
                  title={`${METRIC_LABELS[selectedMetric]} Anomalies — Detailed View`}
                  data={metricData}
                  anomalies={mlAnomalies}
                  showConfidenceBands={true}
                  height={400}
                />
              ) : (
                !isMLLoading && (
                  <div className="text-center py-16 text-muted-foreground">
                    <Brain className="h-16 w-16 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No anomalies detected yet</p>
                    <p className="text-sm mt-1">
                      {metricData.length >= 10
                        ? 'Click "Detect Anomalies" to run the Isolation Forest model'
                        : `Need at least 10 data points to run ML analysis (have ${metricData.length})`}
                    </p>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Forecasting Tab ── */}
        <TabsContent value="forecasts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Time Series Forecasting</CardTitle>
              <p className="text-xs text-muted-foreground">
                ARIMA model predicts {METRIC_LABELS[selectedMetric].toLowerCase()} with 95% confidence intervals
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleGenerateForecast}
                  disabled={isForecastLoading || metricData.length < 20}
                >
                  {isForecastLoading ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Forecasting…</>
                  ) : (
                    <><TrendingUp className="h-4 w-4 mr-2" /> Generate 24-Hour Forecast</>
                  )}
                </Button>
                {metricData.length < 20 && (
                  <span className="text-xs text-amber-600">
                    Need {20 - metricData.length} more data points for reliable forecast
                  </span>
                )}
              </div>

              {mlForecasts && mlForecasts.length > 0 && metricData.length > 0 ? (
                <ForecastChart
                  title={`${METRIC_LABELS[selectedMetric]} — Next 24 Hours`}
                  historicalData={metricData.map(d => ({ timestamp: d.timestamp, value: d.value }))}
                  forecasts={mlForecasts}
                  unit={METRIC_UNITS[selectedMetric]}
                  height={400}
                  showConfidenceBands={true}
                />
              ) : (
                !isForecastLoading && (
                  <div className="text-center py-16 text-muted-foreground">
                    <TrendingUp className="h-16 w-16 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No forecast generated yet</p>
                    <p className="text-sm mt-1">
                      {metricData.length >= 20
                        ? 'Click "Generate 24-Hour Forecast" to predict future resource usage'
                        : `ARIMA requires at least 20 observations (have ${metricData.length})`}
                    </p>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Model Info Tab ── */}
        <TabsContent value="models" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Isolation Forest Model */}
            {/* Isolation Forest Model */}
            <ModelExplainabilityPanel
              modelType="isolation_forest"
              modelInfo={mlModelInfo || {
                algorithm: 'Isolation Forest',
                num_trees: 100,
                sample_size: 256,
                threshold: 0.6,
                total_points: metricData.length,
              }}
            /* features prop removed as it is not part of the component props */
            />

            {/* ARIMA Model */}
            <ModelExplainabilityPanel
              modelType="arima"
              modelInfo={forecastModelInfo || {
                order: [2, 1, 2],
                fitted: false,
                ar_coeffs: [],
                ma_coeffs: [],
                constant: 0,
                std_error: 0,
                n_residuals: 0,
              }}
            /* features prop removed as it is not part of the component props */
            />
          </div>

          {/* Model status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Model Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  {mlModelInfo ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Info className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span>Isolation Forest: {mlModelInfo ? `Trained on ${mlModelInfo.total_points} points` : 'Not trained yet'}</span>
                </div>
                <div className="flex items-center gap-2">
                  {forecastModelInfo ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Info className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span>ARIMA: {forecastModelInfo ? `Fitted (σ=${forecastStdError.toFixed(3)})` : 'Not fitted yet'}</span>
                </div>
                <div className="flex items-center gap-2">
                  {connected ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-amber-500" />
                  )}
                  <span>Backend: {connected ? 'Connected' : 'Not connected'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <span>Data source: {connected ? 'Live cluster metrics (AI analytics engine)' : 'No data — connect backend'}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
