/**
 * TASK-OBS-010: Grafana Dashboard Templates
 *
 * Export button that generates Grafana JSON dashboard definitions
 * with pre-built templates for Kubilitics metrics.
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  FileJson,
  Copy,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/lib/exportUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GrafanaPanel {
  title: string;
  type: string;
  targets: { expr: string; legendFormat: string }[];
  gridPos: { h: number; w: number; x: number; y: number };
  fieldConfig?: object;
}

interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  panels: GrafanaPanel[];
  tags: string[];
}

// ─── Dashboard Templates ─────────────────────────────────────────────────────

const TEMPLATES: DashboardTemplate[] = [
  {
    id: 'platform-overview',
    name: 'Kubilitics Platform Overview',
    description: 'HTTP request rates, latency percentiles, WebSocket connections, and circuit breaker states.',
    tags: ['kubilitics', 'platform', 'http'],
    panels: [
      {
        title: 'HTTP Request Rate',
        type: 'timeseries',
        targets: [
          { expr: 'sum(rate(http_requests_total{job="kubilitics-backend"}[5m]))', legendFormat: 'Total req/s' },
          { expr: 'sum(rate(http_requests_total{job="kubilitics-backend"}[5m])) by (status_code)', legendFormat: '{{status_code}}' },
        ],
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
      },
      {
        title: 'HTTP Latency P50/P99',
        type: 'timeseries',
        targets: [
          { expr: 'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{job="kubilitics-backend"}[5m])) by (le))', legendFormat: 'P50' },
          { expr: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{job="kubilitics-backend"}[5m])) by (le))', legendFormat: 'P99' },
        ],
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
      },
      {
        title: 'WebSocket Connections',
        type: 'stat',
        targets: [
          { expr: 'kubilitics_websocket_connections_active', legendFormat: 'Active' },
        ],
        gridPos: { h: 4, w: 6, x: 0, y: 8 },
      },
      {
        title: 'Cache Hit Ratio',
        type: 'gauge',
        targets: [
          { expr: 'sum(rate(kubilitics_cache_hits_total[5m])) / (sum(rate(kubilitics_cache_hits_total[5m])) + sum(rate(kubilitics_cache_misses_total[5m])))', legendFormat: 'Hit Ratio' },
        ],
        gridPos: { h: 4, w: 6, x: 6, y: 8 },
        fieldConfig: { defaults: { min: 0, max: 1, unit: 'percentunit' } },
      },
      {
        title: 'Circuit Breaker State',
        type: 'stat',
        targets: [
          { expr: 'kubilitics_circuit_breaker_state', legendFormat: '{{name}}' },
        ],
        gridPos: { h: 4, w: 12, x: 12, y: 8 },
      },
    ],
  },
  {
    id: 'cluster-resources',
    name: 'Kubilitics Cluster Resources',
    description: 'Node CPU/Memory, Pod resource usage, and namespace-level aggregation.',
    tags: ['kubilitics', 'cluster', 'resources'],
    panels: [
      {
        title: 'Node CPU Utilization',
        type: 'timeseries',
        targets: [
          { expr: '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)', legendFormat: '{{instance}}' },
        ],
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
      },
      {
        title: 'Node Memory Utilization',
        type: 'timeseries',
        targets: [
          { expr: '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)', legendFormat: '{{instance}}' },
        ],
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
      },
      {
        title: 'Pod CPU Usage (Top 10)',
        type: 'timeseries',
        targets: [
          { expr: 'topk(10, sum by(pod, namespace) (rate(container_cpu_usage_seconds_total{container!="POD",container!=""}[5m])))', legendFormat: '{{namespace}}/{{pod}}' },
        ],
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
      },
      {
        title: 'Pod Memory Usage (Top 10)',
        type: 'timeseries',
        targets: [
          { expr: 'topk(10, sum by(pod, namespace) (container_memory_working_set_bytes{container!="POD",container!=""}))', legendFormat: '{{namespace}}/{{pod}}' },
        ],
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
      },
      {
        title: 'CPU by Namespace',
        type: 'piechart',
        targets: [
          { expr: 'sum by(namespace) (rate(container_cpu_usage_seconds_total{container!="POD",container!=""}[5m]))', legendFormat: '{{namespace}}' },
        ],
        gridPos: { h: 8, w: 8, x: 0, y: 16 },
      },
      {
        title: 'Memory by Namespace',
        type: 'piechart',
        targets: [
          { expr: 'sum by(namespace) (container_memory_working_set_bytes{container!="POD",container!=""})', legendFormat: '{{namespace}}' },
        ],
        gridPos: { h: 8, w: 8, x: 8, y: 16 },
      },
    ],
  },
  {
    id: 'network-observability',
    name: 'Kubilitics Network Metrics',
    description: 'Pod network I/O, DNS latency, and connection tracking.',
    tags: ['kubilitics', 'network'],
    panels: [
      {
        title: 'Network Receive (Top 10 Pods)',
        type: 'timeseries',
        targets: [
          { expr: 'topk(10, sum by(pod, namespace) (rate(container_network_receive_bytes_total[5m])))', legendFormat: '{{namespace}}/{{pod}}' },
        ],
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
      },
      {
        title: 'Network Transmit (Top 10 Pods)',
        type: 'timeseries',
        targets: [
          { expr: 'topk(10, sum by(pod, namespace) (rate(container_network_transmit_bytes_total[5m])))', legendFormat: '{{namespace}}/{{pod}}' },
        ],
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
      },
    ],
  },
  {
    id: 'slo-sli',
    name: 'Kubilitics SLO/SLI',
    description: 'Service Level Objectives with burn rate alerts and error budget tracking.',
    tags: ['kubilitics', 'slo', 'sli'],
    panels: [
      {
        title: 'Availability SLI (success ratio)',
        type: 'timeseries',
        targets: [
          { expr: 'sum(rate(http_requests_total{job="kubilitics-backend",status_code!~"5.."}[5m])) / sum(rate(http_requests_total{job="kubilitics-backend"}[5m]))', legendFormat: 'Availability' },
        ],
        gridPos: { h: 8, w: 12, x: 0, y: 0 },
      },
      {
        title: 'Latency SLI (P99 < 500ms)',
        type: 'timeseries',
        targets: [
          { expr: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{job="kubilitics-backend"}[5m])) by (le))', legendFormat: 'P99 Latency' },
        ],
        gridPos: { h: 8, w: 12, x: 12, y: 0 },
      },
      {
        title: 'Error Budget Remaining',
        type: 'gauge',
        targets: [
          { expr: '1 - ((1 - (sum(rate(http_requests_total{job="kubilitics-backend",status_code!~"5.."}[30d])) / sum(rate(http_requests_total{job="kubilitics-backend"}[30d])))) / (1 - 0.999))', legendFormat: 'Budget' },
        ],
        gridPos: { h: 8, w: 12, x: 0, y: 8 },
        fieldConfig: { defaults: { min: 0, max: 1, unit: 'percentunit', thresholds: { mode: 'absolute', steps: [{ value: 0, color: 'red' }, { value: 0.25, color: 'orange' }, { value: 0.5, color: 'green' }] } } },
      },
      {
        title: 'Burn Rate (1h/6h)',
        type: 'timeseries',
        targets: [
          { expr: '(1 - (sum(rate(http_requests_total{job="kubilitics-backend",status_code!~"5.."}[1h])) / sum(rate(http_requests_total{job="kubilitics-backend"}[1h])))) / (1 - 0.999)', legendFormat: '1h burn rate' },
          { expr: '(1 - (sum(rate(http_requests_total{job="kubilitics-backend",status_code!~"5.."}[6h])) / sum(rate(http_requests_total{job="kubilitics-backend"}[6h])))) / (1 - 0.999)', legendFormat: '6h burn rate' },
        ],
        gridPos: { h: 8, w: 12, x: 12, y: 8 },
      },
    ],
  },
];

// ─── Grafana JSON Builder ────────────────────────────────────────────────────

function buildGrafanaDashboard(template: DashboardTemplate): object {
  return {
    __inputs: [
      {
        name: 'DS_PROMETHEUS',
        label: 'Prometheus',
        description: 'Prometheus data source for Kubilitics metrics',
        type: 'datasource',
        pluginId: 'prometheus',
        pluginName: 'Prometheus',
      },
    ],
    __requires: [
      { type: 'grafana', id: 'grafana', name: 'Grafana', version: '10.0.0' },
      { type: 'datasource', id: 'prometheus', name: 'Prometheus', version: '1.0.0' },
    ],
    annotations: { list: [] },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    id: null,
    links: [],
    panels: template.panels.map((panel, idx) => ({
      id: idx + 1,
      title: panel.title,
      type: panel.type,
      datasource: { type: 'prometheus', uid: '${DS_PROMETHEUS}' },
      targets: panel.targets.map((t, ti) => ({
        datasource: { type: 'prometheus', uid: '${DS_PROMETHEUS}' },
        expr: t.expr,
        legendFormat: t.legendFormat,
        refId: String.fromCharCode(65 + ti),
      })),
      gridPos: panel.gridPos,
      fieldConfig: panel.fieldConfig ?? { defaults: {}, overrides: [] },
      options: {},
    })),
    schemaVersion: 39,
    tags: template.tags,
    templating: { list: [] },
    time: { from: 'now-1h', to: 'now' },
    timepicker: {},
    timezone: '',
    title: template.name,
    uid: `kubilitics-${template.id}`,
    version: 1,
    weekStart: '',
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GrafanaDashboardExport({ className }: { className?: string }) {
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const handleExport = useCallback((template: DashboardTemplate) => {
    const dashboard = buildGrafanaDashboard(template);
    const json = JSON.stringify(dashboard, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `kubilitics-${template.id}-dashboard.json`);
    setExported(template.id);
    setTimeout(() => setExported(null), 3000);
  }, []);

  const handleCopyJson = useCallback(async (template: DashboardTemplate) => {
    const dashboard = buildGrafanaDashboard(template);
    const json = JSON.stringify(dashboard, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setExported(template.id);
      setTimeout(() => setExported(null), 3000);
    } catch {
      // fallback — download instead
      handleExport(template);
    }
  }, [handleExport]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-4', className)}
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-950/40">
          <BarChart3 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Grafana Dashboard Templates
          </h3>
          <p className="text-sm text-muted-foreground">
            Export pre-built Grafana dashboards for Kubilitics metrics
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {TEMPLATES.map((template) => (
          <Card key={template.id} className="overflow-hidden">
            <button
              onClick={() => setExpandedTemplate(
                expandedTemplate === template.id ? null : template.id,
              )}
              className="w-full text-left"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{template.name}</CardTitle>
                    <Badge variant="secondary" className="text-[10px]">
                      {template.panels.length} panels
                    </Badge>
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform duration-200',
                      expandedTemplate === template.id && 'rotate-180',
                    )}
                  />
                </div>
                <CardDescription className="text-xs">{template.description}</CardDescription>
              </CardHeader>
            </button>

            <AnimatePresence>
              {expandedTemplate === template.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <CardContent className="pt-0 space-y-3">
                    {/* Panel list */}
                    <div className="space-y-1.5">
                      {template.panels.map((panel, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5"
                        >
                          <FileJson className="h-3 w-3 shrink-0 text-slate-400" />
                          <span className="font-medium">{panel.title}</span>
                          <Badge variant="outline" className="text-[9px] ml-auto">
                            {panel.type}
                          </Badge>
                        </div>
                      ))}
                    </div>

                    {/* Tags */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {template.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[9px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => handleExport(template)}
                      >
                        {exported === template.id ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Exported
                          </>
                        ) : (
                          <>
                            <Download className="h-3.5 w-3.5" />
                            Download JSON
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => handleCopyJson(template)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy JSON
                      </Button>
                    </div>
                  </CardContent>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        ))}
      </div>
    </motion.div>
  );
}

export default GrafanaDashboardExport;
