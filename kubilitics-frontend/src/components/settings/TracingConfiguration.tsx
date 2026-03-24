/**
 * TASK-OBS-007: OpenTelemetry Tracing Configuration
 *
 * UI for configuring the OpenTelemetry browser SDK:
 * - OTLP endpoint configuration
 * - Sampling rate slider
 * - Service name
 * - Enable/disable toggle
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Save,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Info,
  Waves,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  getTracingConfig,
  updateTracingConfig,
  initTracing,
  type TracingConfig,
} from '@/lib/tracing';
import { toast } from '@/components/ui/sonner';

// ─── Component ───────────────────────────────────────────────────────────────

export function TracingConfiguration({ className }: { className?: string }) {
  const [config, setConfig] = useState<TracingConfig>(getTracingConfig());
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync on mount
  useEffect(() => {
    setConfig(getTracingConfig());
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    setSaved(false);
    try {
      updateTracingConfig(config);
      initTracing(config);
      setSaved(true);
      toast.success('Tracing configuration saved');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast.error(`Failed to save: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    const defaults: TracingConfig = {
      otlpEndpoint: '',
      samplingRate: 0.1,
      serviceName: 'kubilitics-frontend',
      enabled: false,
    };
    setConfig(defaults);
    toast.info('Reset to default tracing configuration');
  };

  const update = (partial: Partial<TracingConfig>) => setConfig((c) => ({ ...c, ...partial }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn('space-y-6', className)}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-500" />
            OpenTelemetry Tracing
          </CardTitle>
          <CardDescription className="text-xs">
            Configure distributed tracing for the Kubilitics frontend.
            Traces are exported to an OTLP-compatible endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Enable Tracing</p>
              <p className="text-[10px] text-muted-foreground">
                Instrument API calls with OpenTelemetry spans
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
            />
          </div>

          {/* OTLP Endpoint */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">OTLP HTTP Endpoint</Label>
            <Input
              value={config.otlpEndpoint}
              onChange={(e) => update({ otlpEndpoint: e.target.value })}
              placeholder="http://localhost:4318/v1/traces"
              className="h-8 text-sm font-mono"
              disabled={!config.enabled}
            />
            <p className="text-[10px] text-muted-foreground">
              OTLP/HTTP JSON endpoint. Compatible with Jaeger, Tempo, Zipkin (via OTLP), and any OTLP collector.
            </p>
          </div>

          {/* Service Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Service Name</Label>
            <Input
              value={config.serviceName}
              onChange={(e) => update({ serviceName: e.target.value })}
              placeholder="kubilitics-frontend"
              className="h-8 text-sm"
              disabled={!config.enabled}
            />
            <p className="text-[10px] text-muted-foreground">
              The service.name resource attribute reported in all spans.
            </p>
          </div>

          {/* Sampling Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <Waves className="h-3 w-3" />
                Sampling Rate
              </Label>
              <Badge variant="outline" className="text-[10px] tabular-nums">
                {(config.samplingRate * 100).toFixed(0)}%
              </Badge>
            </div>
            <Slider
              value={[config.samplingRate * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => update({ samplingRate: v / 100 })}
              disabled={!config.enabled}
              className="py-1"
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>0% (no traces)</span>
              <span>100% (all requests)</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {config.samplingRate <= 0
                ? 'Tracing is effectively disabled (0% sampling).'
                : config.samplingRate >= 1
                  ? 'All requests will be traced. This may impact performance.'
                  : `Approximately ${(config.samplingRate * 100).toFixed(0)}% of requests will generate traces.`}
            </p>
          </div>

          {/* Resource Attributes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Resource Attributes (optional)</Label>
            <Input
              value={
                config.resourceAttributes
                  ? Object.entries(config.resourceAttributes)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(',')
                  : ''
              }
              onChange={(e) => {
                const attrs: Record<string, string> = {};
                e.target.value.split(',').forEach((pair) => {
                  const [key, ...rest] = pair.split('=');
                  if (key?.trim() && rest.length > 0) {
                    attrs[key.trim()] = rest.join('=').trim();
                  }
                });
                update({ resourceAttributes: Object.keys(attrs).length > 0 ? attrs : undefined });
              }}
              placeholder="deployment.environment=production,service.version=1.0.0"
              className="h-8 text-sm font-mono"
              disabled={!config.enabled}
            />
            <p className="text-[10px] text-muted-foreground">
              Comma-separated key=value pairs added as OTLP resource attributes.
            </p>
          </div>

          {/* Warnings */}
          {config.enabled && !config.otlpEndpoint && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Tracing is enabled but no OTLP endpoint is configured. Spans will be buffered
                locally but not exported.
              </AlertDescription>
            </Alert>
          )}

          {config.enabled && config.samplingRate >= 0.5 && (
            <Alert>
              <Zap className="h-4 w-4" />
              <AlertDescription className="text-xs">
                High sampling rate ({(config.samplingRate * 100).toFixed(0)}%) may increase network
                overhead and affect frontend performance. Consider lowering for production use.
              </AlertDescription>
            </Alert>
          )}
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

export default TracingConfiguration;
