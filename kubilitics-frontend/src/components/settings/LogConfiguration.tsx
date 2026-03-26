/**
 * TASK-OBS-005: Structured Log Shipping (Frontend)
 *
 * Log format configuration (JSON output settings),
 * optional Loki push endpoint, and documentation links
 * for ELK, Loki, and CloudWatch setup.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Save,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Info,
  RotateCcw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { toast } from '@/components/ui/sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogConfig {
  /** Log output format. */
  format: 'json' | 'text' | 'logfmt';
  /** Log level threshold. */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Include caller info in log entries. */
  includeCaller: boolean;
  /** Include stack trace on errors. */
  includeStackTrace: boolean;
  /** Loki push endpoint (empty = disabled). */
  lokiEndpoint: string;
  /** Loki tenant ID. */
  lokiTenantId: string;
  /** Extra static labels for Loki. */
  lokiLabels: string;
  /** Enable structured log shipping. */
  shippingEnabled: boolean;
}

const DEFAULT_CONFIG: LogConfig = {
  format: 'json',
  level: 'info',
  includeCaller: false,
  includeStackTrace: true,
  lokiEndpoint: '',
  lokiTenantId: '',
  lokiLabels: '',
  shippingEnabled: false,
};

// ─── Documentation Links ─────────────────────────────────────────────────────

const DOC_LINKS = [
  {
    title: 'Grafana Loki',
    description: 'Push logs directly from Kubilitics backend to Loki for querying in Grafana.',
    url: 'https://grafana.com/docs/loki/latest/clients/promtail/',
    icon: 'L',
    color: 'bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400',
  },
  {
    title: 'Elastic Stack (ELK)',
    description: 'Ship JSON logs to Elasticsearch via Filebeat or Fluentd for centralized search.',
    url: 'https://www.elastic.co/guide/en/beats/filebeat/current/filebeat-input-log.html',
    icon: 'E',
    color: 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-600 dark:text-cyan-400',
  },
  {
    title: 'AWS CloudWatch',
    description: 'Forward structured JSON logs to CloudWatch Logs via the AWS logging agent.',
    url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_GettingStarted.html',
    icon: 'C',
    color: 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
  },
  {
    title: 'Fluentd / Fluent Bit',
    description: 'Use Fluentd as a universal log forwarder — supports JSON, Loki, ES, and S3 outputs.',
    url: 'https://docs.fluentbit.io/manual/',
    icon: 'F',
    color: 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400',
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function LogConfiguration({ className }: { className?: string }) {
  const [config, setConfig] = useState<LogConfig>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(stored);

  // Load current config
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/v1/config/logging`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json();
          setConfig((prev) => ({ ...prev, ...data }));
        }
      } catch {
        // Use defaults if backend not reachable
      }
    })();
  }, [baseUrl]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`${baseUrl}/api/v1/config/logging`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setSaved(true);
      toast.success('Log configuration saved');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error(`Failed to save: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    toast.info('Reset to default configuration');
  };

  const update = (partial: Partial<LogConfig>) => setConfig((c) => ({ ...c, ...partial }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-6', className)}
    >
      {/* Log Format */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-500" />
            Log Output Configuration
          </CardTitle>
          <CardDescription className="text-xs">
            Configure the backend log format and verbosity level.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Format</Label>
              <Select value={config.format} onValueChange={(v) => update({ format: v as LogConfig['format'] })}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON (structured)</SelectItem>
                  <SelectItem value="text">Text (human-readable)</SelectItem>
                  <SelectItem value="logfmt">logfmt (key=value)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                JSON is recommended for log aggregation systems.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Level</Label>
              <Select value={config.level} onValueChange={(v) => update({ level: v as LogConfig['level'] })}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="debug">Debug</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warn">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Include Caller Info</p>
                <p className="text-xs text-muted-foreground">Add file:line to each log entry</p>
              </div>
              <Switch checked={config.includeCaller} onCheckedChange={(v) => update({ includeCaller: v })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Include Stack Traces</p>
                <p className="text-xs text-muted-foreground">Attach stack traces on error-level entries</p>
              </div>
              <Switch checked={config.includeStackTrace} onCheckedChange={(v) => update({ includeStackTrace: v })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loki Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-orange-500" />
            Loki Push Configuration
          </CardTitle>
          <CardDescription className="text-xs">
            Optionally push structured logs directly to a Grafana Loki instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Enable Log Shipping</p>
              <p className="text-xs text-muted-foreground">Push logs to Loki in real-time</p>
            </div>
            <Switch checked={config.shippingEnabled} onCheckedChange={(v) => update({ shippingEnabled: v })} />
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Loki Push Endpoint</Label>
              <Input
                value={config.lokiEndpoint}
                onChange={(e) => update({ lokiEndpoint: e.target.value })}
                placeholder="http://loki.monitoring.svc:3100/loki/api/v1/push"
                className="h-8 text-sm font-mono"
                disabled={!config.shippingEnabled}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Tenant ID (optional)</Label>
                <Input
                  value={config.lokiTenantId}
                  onChange={(e) => update({ lokiTenantId: e.target.value })}
                  placeholder="default"
                  className="h-8 text-sm"
                  disabled={!config.shippingEnabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Static Labels</Label>
                <Input
                  value={config.lokiLabels}
                  onChange={(e) => update({ lokiLabels: e.target.value })}
                  placeholder='app=kubilitics,env=production'
                  className="h-8 text-sm font-mono"
                  disabled={!config.shippingEnabled}
                />
              </div>
            </div>
          </div>

          {config.shippingEnabled && !config.lokiEndpoint && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Log shipping is enabled but no Loki endpoint is configured.
                Logs will only be written to stdout.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Documentation Links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Log Aggregation Setup Guides</CardTitle>
          <CardDescription className="text-xs">
            Reference documentation for common log aggregation backends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DOC_LINKS.map((doc) => (
              <a
                key={doc.title}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-3 rounded-xl border p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className={cn('p-2 rounded-lg text-sm font-bold shrink-0', doc.color)}>
                  {doc.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1">
                    {doc.title}
                    <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
                </div>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to Defaults
        </Button>
        <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saved ? 'Saved' : 'Save Configuration'}
        </Button>
      </div>
    </motion.div>
  );
}

export default LogConfiguration;
