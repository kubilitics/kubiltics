/**
 * AuditLogShipping — ENT-010
 *
 * Configuration for audit log sinks: stdout, S3, CloudWatch, Splunk.
 * Sink configuration forms, retention policy settings, and test connection button.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileOutput,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Save,
  RefreshCw,
  Play,
  Terminal,
  Cloud,
  Database,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────

type SinkType = 'stdout' | 's3' | 'cloudwatch' | 'splunk';

interface SinkConfig {
  id: string;
  type: SinkType;
  name: string;
  enabled: boolean;
  // S3-specific
  s3Bucket?: string;
  s3Region?: string;
  s3Prefix?: string;
  // CloudWatch-specific
  cwLogGroup?: string;
  cwLogStream?: string;
  cwRegion?: string;
  // Splunk-specific
  splunkEndpoint?: string;
  splunkToken?: string;
  splunkIndex?: string;
}

interface RetentionPolicy {
  days: number;
  maxSizeMb: number;
  compressionEnabled: boolean;
}

interface SinkHealth {
  sinkId: string;
  status: 'healthy' | 'error' | 'unknown';
  message?: string;
  lastDelivered?: string;
}

// ─── Constants ───────────────────────────────────────────────

const SINK_META: Record<SinkType, { label: string; icon: React.ElementType; description: string }> = {
  stdout: { label: 'Standard Output', icon: Terminal, description: 'Log to container stdout (default)' },
  s3: { label: 'Amazon S3', icon: Cloud, description: 'Ship logs to an S3 bucket' },
  cloudwatch: { label: 'CloudWatch Logs', icon: Database, description: 'Ship logs to AWS CloudWatch' },
  splunk: { label: 'Splunk HEC', icon: Search, description: 'Ship logs via Splunk HTTP Event Collector' },
};

let nextSinkId = 1;
function generateSinkId(): string {
  return `sink-${Date.now()}-${nextSinkId++}`;
}

// ─── Component ───────────────────────────────────────────────

export default function AuditLogShipping() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);

  const [sinks, setSinks] = useState<SinkConfig[]>([
    { id: 'default-stdout', type: 'stdout', name: 'Default Stdout', enabled: true },
  ]);
  const [retention, setRetention] = useState<RetentionPolicy>({
    days: 90,
    maxSizeMb: 1024,
    compressionEnabled: true,
  });
  const [sinkHealth, setSinkHealth] = useState<Record<string, SinkHealth>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [testingSinkId, setTestingSinkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch config ───────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/audit-log`);
      if (res.ok) {
        const data = await res.json();
        if (data.sinks?.length) setSinks(data.sinks);
        if (data.retention) setRetention(data.retention);
        if (data.health) {
          const healthMap: Record<string, SinkHealth> = {};
          for (const h of data.health) healthMap[h.sinkId] = h;
          setSinkHealth(healthMap);
        }
      }
    } catch {
      // Defaults are fine
    } finally {
      setIsLoading(false);
    }
  }, [backendBaseUrl]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ── Sink CRUD ──────────────────────────────────────────────

  function addSink(type: SinkType) {
    const meta = SINK_META[type];
    const newSink: SinkConfig = {
      id: generateSinkId(),
      type,
      name: meta.label,
      enabled: true,
      ...(type === 's3' && { s3Bucket: '', s3Region: 'us-east-1', s3Prefix: 'audit-logs/' }),
      ...(type === 'cloudwatch' && { cwLogGroup: '/kubilitics/audit', cwLogStream: 'default', cwRegion: 'us-east-1' }),
      ...(type === 'splunk' && { splunkEndpoint: '', splunkToken: '', splunkIndex: 'main' }),
    };
    setSinks((prev) => [...prev, newSink]);
  }

  function removeSink(id: string) {
    setSinks((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSink(id: string, updates: Partial<SinkConfig>) {
    setSinks((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }

  // ── Save ───────────────────────────────────────────────────

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/audit-log`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinks, retention }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      toast.success('Audit log shipping configuration saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }

  // ── Test connection ────────────────────────────────────────

  async function handleTestSink(sink: SinkConfig) {
    setTestingSinkId(sink.id);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/audit-log/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sink),
      });
      if (!res.ok) throw new Error('Connection test failed');
      const data: SinkHealth = await res.json();
      setSinkHealth((prev) => ({ ...prev, [sink.id]: data }));
      if (data.status === 'healthy') {
        toast.success(`${SINK_META[sink.type].label} connection test passed`);
      } else {
        toast.warning(`${SINK_META[sink.type].label}: ${data.message}`);
      }
    } catch (err) {
      setSinkHealth((prev) => ({
        ...prev,
        [sink.id]: { sinkId: sink.id, status: 'error', message: err instanceof Error ? err.message : 'Test failed' },
      }));
      toast.error('Connection test failed');
    } finally {
      setTestingSinkId(null);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading audit log configuration...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <FileOutput className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Audit Log Shipping</CardTitle>
            <CardDescription>
              Configure immutable audit log sinks and retention policies
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Configured sinks */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base">Log Sinks</Label>
            <div className="flex gap-2">
              {(['s3', 'cloudwatch', 'splunk'] as SinkType[]).map((type) => {
                const meta = SINK_META[type];
                const Icon = meta.icon;
                return (
                  <Button key={type} variant="outline" size="sm" onClick={() => addSink(type)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    <Icon className="h-3.5 w-3.5 mr-1" />
                    {meta.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <AnimatePresence>
            {sinks.map((sink) => {
              const meta = SINK_META[sink.type];
              const Icon = meta.icon;
              const health = sinkHealth[sink.id];
              return (
                <motion.div
                  key={sink.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="border rounded-lg p-4 space-y-4"
                >
                  {/* Sink header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-primary" />
                      <div>
                        <span className="text-sm font-medium">{sink.name}</span>
                        <Badge variant="outline" className="ml-2 text-xs">{sink.type}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {health && (
                        health.status === 'healthy' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : health.status === 'error' ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : null
                      )}
                      <Switch
                        checked={sink.enabled}
                        onCheckedChange={(checked) => updateSink(sink.id, { enabled: checked })}
                      />
                      {sink.type !== 'stdout' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => removeSink(sink.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Sink-specific fields */}
                  {sink.type === 's3' && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">S3 Bucket</Label>
                        <Input
                          placeholder="my-audit-bucket"
                          value={sink.s3Bucket ?? ''}
                          onChange={(e) => updateSink(sink.id, { s3Bucket: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Region</Label>
                        <Input
                          placeholder="us-east-1"
                          value={sink.s3Region ?? ''}
                          onChange={(e) => updateSink(sink.id, { s3Region: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Prefix</Label>
                        <Input
                          placeholder="audit-logs/"
                          value={sink.s3Prefix ?? ''}
                          onChange={(e) => updateSink(sink.id, { s3Prefix: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  {sink.type === 'cloudwatch' && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Log Group</Label>
                        <Input
                          placeholder="/kubilitics/audit"
                          value={sink.cwLogGroup ?? ''}
                          onChange={(e) => updateSink(sink.id, { cwLogGroup: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Log Stream</Label>
                        <Input
                          placeholder="default"
                          value={sink.cwLogStream ?? ''}
                          onChange={(e) => updateSink(sink.id, { cwLogStream: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Region</Label>
                        <Input
                          placeholder="us-east-1"
                          value={sink.cwRegion ?? ''}
                          onChange={(e) => updateSink(sink.id, { cwRegion: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  {sink.type === 'splunk' && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">HEC Endpoint</Label>
                        <Input
                          placeholder="https://splunk.example.com:8088"
                          value={sink.splunkEndpoint ?? ''}
                          onChange={(e) => updateSink(sink.id, { splunkEndpoint: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">HEC Token</Label>
                        <Input
                          type="password"
                          placeholder="xxxxxxxx-xxxx-xxxx"
                          value={sink.splunkToken ?? ''}
                          onChange={(e) => updateSink(sink.id, { splunkToken: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Index</Label>
                        <Input
                          placeholder="main"
                          value={sink.splunkIndex ?? ''}
                          onChange={(e) => updateSink(sink.id, { splunkIndex: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

                  {/* Test button */}
                  {sink.type !== 'stdout' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestSink(sink)}
                      disabled={testingSinkId === sink.id}
                    >
                      {testingSinkId === sink.id ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 mr-1" />
                          Test Connection
                        </>
                      )}
                    </Button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Retention policy */}
        <div className="space-y-4 border rounded-lg p-4">
          <Label className="text-base">Retention Policy</Label>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="retention-days" className="text-xs">Retention Days</Label>
              <Input
                id="retention-days"
                type="number"
                value={retention.days}
                onChange={(e) => setRetention((r) => ({ ...r, days: parseInt(e.target.value, 10) || 90 }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retention-size" className="text-xs">Max Size (MB)</Label>
              <Input
                id="retention-size"
                type="number"
                value={retention.maxSizeMb}
                onChange={(e) => setRetention((r) => ({ ...r, maxSizeMb: parseInt(e.target.value, 10) || 1024 }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 self-end">
              <div className="text-xs font-medium">Compression</div>
              <Switch
                checked={retention.compressionEnabled}
                onCheckedChange={(checked) => setRetention((r) => ({ ...r, compressionEnabled: checked }))}
              />
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={fetchConfig}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Configuration
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
