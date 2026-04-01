/**
 * TASK-OBS-004: Webhook Alert Delivery (Frontend)
 *
 * Settings -> Alerts configuration page.
 * Alert rule builder, webhook targets (Slack, PagerDuty, OpsGenie, generic HTTP),
 * deduplication cooldown, and alert history table.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  Plus,
  Trash2,
  Save,
  TestTube,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Filter,
  RefreshCw,
  Webhook,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Send,
  Loader2,
  Globe,
  Hash,
  MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { toast } from '@/components/ui/sonner';

// ─── Types ───────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'warning' | 'info';
type WebhookTarget = 'slack' | 'pagerduty' | 'opsgenie' | 'generic';

interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  resourceType: string;
  namespace: string;
  severity: Severity;
  messagePattern: string;
  cooldownMinutes: number;
  targets: WebhookConfig[];
  createdAt: string;
  updatedAt: string;
}

interface WebhookConfig {
  id: string;
  type: WebhookTarget;
  url: string;
  channel?: string;       // Slack
  routingKey?: string;     // PagerDuty / OpsGenie
  headers?: Record<string, string>; // Generic HTTP
  enabled: boolean;
}

interface AlertHistoryEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: Severity;
  message: string;
  resource: string;
  namespace: string;
  firedAt: string;
  deliveredTo: string[];
  status: 'delivered' | 'failed' | 'deduplicated' | 'silenced';
}

// ─── API Functions ───────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const stored = useBackendConfigStore.getState().backendBaseUrl;
  return getEffectiveBackendBaseUrl(stored);
}

async function fetchAlertRules(): Promise<AlertRule[]> {
  const res = await fetch(`${getBaseUrl()}/api/v1/alerts/rules`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch alert rules: ${res.status}`);
  return res.json();
}

async function saveAlertRule(rule: Partial<AlertRule>): Promise<AlertRule> {
  const method = rule.id ? 'PUT' : 'POST';
  const url = rule.id
    ? `${getBaseUrl()}/api/v1/alerts/rules/${rule.id}`
    : `${getBaseUrl()}/api/v1/alerts/rules`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to save alert rule: ${res.status}`);
  return res.json();
}

async function deleteAlertRule(id: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}/api/v1/alerts/rules/${id}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to delete alert rule: ${res.status}`);
}

async function testWebhook(config: WebhookConfig): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${getBaseUrl()}/api/v1/alerts/test-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Webhook test failed: ${res.status}`);
  return res.json();
}

async function fetchAlertHistory(page: number, limit: number): Promise<{ entries: AlertHistoryEntry[]; total: number }> {
  const res = await fetch(`${getBaseUrl()}/api/v1/alerts/history?limit=${limit}&offset=${page * limit}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch alert history: ${res.status}`);
  return res.json();
}

// ─── Severity Config ─────────────────────────────────────────────────────────

const severityStyles: Record<Severity, { bg: string; color: string; icon: React.ElementType }> = {
  critical: {
    bg: 'bg-red-100 dark:bg-red-950/40',
    color: 'text-red-700 dark:text-red-400',
    icon: XCircle,
  },
  warning: {
    bg: 'bg-amber-100 dark:bg-amber-950/40',
    color: 'text-amber-700 dark:text-amber-400',
    icon: AlertTriangle,
  },
  info: {
    bg: 'bg-blue-100 dark:bg-blue-950/40',
    color: 'text-blue-700 dark:text-blue-400',
    icon: Bell,
  },
};

const targetIcons: Record<WebhookTarget, React.ElementType> = {
  slack: Hash,
  pagerduty: Bell,
  opsgenie: AlertTriangle,
  generic: Globe,
};

const statusStyles: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  deduplicated: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  silenced: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
};

// ─── Webhook Target Editor ───────────────────────────────────────────────────

function WebhookTargetEditor({
  target,
  onChange,
  onRemove,
  onTest,
  isTesting = false,
}: {
  target: WebhookConfig;
  onChange: (t: WebhookConfig) => void;
  onRemove: () => void;
  onTest: () => void;
  isTesting?: boolean;
}) {
  const TargetIcon = targetIcons[target.type];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TargetIcon className="h-4 w-4 text-slate-500" />
          <Select
            value={target.type}
            onValueChange={(v) => onChange({ ...target, type: v as WebhookTarget })}
          >
            <SelectTrigger className="w-[140px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="pagerduty">PagerDuty</SelectItem>
              <SelectItem value="opsgenie">OpsGenie</SelectItem>
              <SelectItem value="generic">Generic HTTP</SelectItem>
            </SelectContent>
          </Select>
          <Switch
            checked={target.enabled}
            onCheckedChange={(v) => onChange({ ...target, enabled: v })}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onTest} disabled={isTesting}>
            {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
            Test
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-red-500" onClick={onRemove}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            {target.type === 'slack' ? 'Webhook URL' : target.type === 'pagerduty' ? 'Events API URL' : target.type === 'opsgenie' ? 'API URL' : 'Endpoint URL'}
          </Label>
          <Input
            value={target.url}
            onChange={(e) => onChange({ ...target, url: e.target.value })}
            placeholder={
              target.type === 'slack'
                ? 'https://hooks.slack.com/services/...'
                : target.type === 'pagerduty'
                  ? 'https://events.pagerduty.com/v2/enqueue'
                  : target.type === 'opsgenie'
                    ? 'https://api.opsgenie.com/v2/alerts'
                    : 'https://your-endpoint.com/alerts'
            }
            className="h-7 text-xs"
          />
        </div>

        {target.type === 'slack' && (
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Channel (optional)</Label>
            <Input
              value={target.channel ?? ''}
              onChange={(e) => onChange({ ...target, channel: e.target.value })}
              placeholder="#alerts"
              className="h-7 text-xs"
            />
          </div>
        )}

        {(target.type === 'pagerduty' || target.type === 'opsgenie') && (
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Routing Key / API Key</Label>
            <Input
              type="password"
              value={target.routingKey ?? ''}
              onChange={(e) => onChange({ ...target, routingKey: e.target.value })}
              placeholder="Enter routing key..."
              className="h-7 text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Rule Editor ─────────────────────────────────────────────────────────────

function RuleEditor({
  rule,
  onSave,
  onCancel,
  isSaving = false,
}: {
  rule: Partial<AlertRule>;
  onSave: (r: Partial<AlertRule>) => void;
  onCancel: () => void;
  isSaving?: boolean;
}) {
  const [draft, setDraft] = useState<Partial<AlertRule>>({
    name: '',
    enabled: true,
    resourceType: 'all',
    namespace: '',
    severity: 'warning',
    messagePattern: '',
    cooldownMinutes: 5,
    targets: [],
    ...rule,
  });
  const [isTesting, setIsTesting] = useState<string | null>(null);

  const handleAddTarget = () => {
    const newTarget: WebhookConfig = {
      id: crypto.randomUUID(),
      type: 'slack',
      url: '',
      enabled: true,
    };
    setDraft((d) => ({ ...d, targets: [...(d.targets ?? []), newTarget] }));
  };

  const handleTargetChange = (idx: number, t: WebhookConfig) => {
    setDraft((d) => {
      const targets = [...(d.targets ?? [])];
      targets[idx] = t;
      return { ...d, targets };
    });
  };

  const handleTargetRemove = (idx: number) => {
    setDraft((d) => ({
      ...d,
      targets: (d.targets ?? []).filter((_, i) => i !== idx),
    }));
  };

  const handleTestWebhook = async (idx: number) => {
    const target = draft.targets?.[idx];
    if (!target) return;
    setIsTesting(target.id);
    try {
      const result = await testWebhook(target);
      if (result.success) {
        toast.success('Webhook test successful');
      } else {
        toast.error(`Webhook test failed: ${result.message}`);
      }
    } catch (err) {
      toast.error(`Webhook test error: ${String(err)}`);
    } finally {
      setIsTesting(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          {rule.id ? 'Edit Alert Rule' : 'New Alert Rule'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Basic Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Rule Name</Label>
            <Input
              value={draft.name ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. High CPU Alert"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Severity</Label>
            <Select
              value={draft.severity}
              onValueChange={(v) => setDraft((d) => ({ ...d, severity: v as Severity }))}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Resource Type</Label>
            <Select
              value={draft.resourceType ?? 'all'}
              onValueChange={(v) => setDraft((d) => ({ ...d, resourceType: v }))}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Resources</SelectItem>
                <SelectItem value="pod">Pods</SelectItem>
                <SelectItem value="deployment">Deployments</SelectItem>
                <SelectItem value="node">Nodes</SelectItem>
                <SelectItem value="service">Services</SelectItem>
                <SelectItem value="statefulset">StatefulSets</SelectItem>
                <SelectItem value="daemonset">DaemonSets</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Namespace (optional)</Label>
            <Input
              value={draft.namespace ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, namespace: e.target.value }))}
              placeholder="All namespaces"
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Message Pattern (regex)</Label>
            <Input
              value={draft.messagePattern ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, messagePattern: e.target.value }))}
              placeholder="e.g. OOMKilled|CrashLoopBackOff"
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold">Deduplication Cooldown</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={1440}
                value={draft.cooldownMinutes ?? 5}
                onChange={(e) => setDraft((d) => ({ ...d, cooldownMinutes: parseInt(e.target.value) || 5 }))}
                className="h-8 text-sm w-20"
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          </div>
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Enable Rule</p>
            <p className="text-[10px] text-muted-foreground">Active rules will fire alerts when conditions match</p>
          </div>
          <Switch
            checked={draft.enabled ?? true}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
          />
        </div>

        {/* Webhook Targets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold flex items-center gap-1">
              <Webhook className="h-3 w-3" />
              Webhook Targets
            </Label>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={handleAddTarget}>
              <Plus className="h-3 w-3" />
              Add Target
            </Button>
          </div>

          {(draft.targets ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">
              No webhook targets configured. Add a target to receive alert notifications.
            </p>
          ) : (
            <div className="space-y-2">
              {(draft.targets ?? []).map((target, idx) => (
                <WebhookTargetEditor
                  key={target.id}
                  target={target}
                  onChange={(t) => handleTargetChange(idx, t)}
                  onRemove={() => handleTargetRemove(idx)}
                  onTest={() => handleTestWebhook(idx)}
                  isTesting={isTesting === target.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => onSave(draft)}
            disabled={isSaving || !draft.name?.trim()}
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {rule.id ? 'Update Rule' : 'Create Rule'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AlertConfiguration() {
  const [editingRule, setEditingRule] = useState<Partial<AlertRule> | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const queryClient = useQueryClient();
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const { data: rules, isLoading: rulesLoading } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: fetchAlertRules,
    enabled: isConfigured,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['alert-history', historyPage],
    queryFn: () => fetchAlertHistory(historyPage, 20),
    enabled: isConfigured,
  });

  const saveMutation = useMutation({
    mutationFn: saveAlertRule,
    onSuccess: () => {
      toast.success('Alert rule saved');
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      setEditingRule(null);
    },
    onError: (err) => toast.error(`Failed to save: ${String(err)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAlertRule,
    onSuccess: () => {
      toast.success('Alert rule deleted');
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
    },
    onError: (err) => toast.error(`Failed to delete: ${String(err)}`),
  });

  const historyTotal = historyData?.total ?? 0;
  const historyTotalPages = Math.ceil(historyTotal / 20);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6 max-w-4xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/40">
            <Bell className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Alert Configuration
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure alert rules and webhook delivery targets
            </p>
          </div>
        </div>
        <Button className="gap-1.5" onClick={() => setEditingRule({})}>
          <Plus className="h-4 w-4" />
          New Rule
        </Button>
      </div>

      {/* Rule Editor */}
      <AnimatePresence>
        {editingRule !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <RuleEditor
              rule={editingRule}
              onSave={(r) => saveMutation.mutate(r as Partial<AlertRule>)}
              onCancel={() => setEditingRule(null)}
              isSaving={saveMutation.isPending}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rules List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4 text-amber-500" />
            Alert Rules
            {rules && (
              <Badge variant="secondary" className="text-[10px]">{rules.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rulesLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !rules || rules.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <Bell className="h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-muted-foreground">No alert rules configured</p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditingRule({})}>
                <Plus className="h-3.5 w-3.5" />
                Create First Rule
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => {
                const sev = severityStyles[rule.severity];
                const SevIcon = sev.icon;
                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between rounded-xl border p-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn('p-1.5 rounded-lg', sev.bg)}>
                        <SevIcon className={cn('h-3.5 w-3.5', sev.color)} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {rule.name}
                          </p>
                          {!rule.enabled && (
                            <Badge variant="outline" className="text-[9px]">Disabled</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{rule.resourceType}</span>
                          {rule.namespace && <span>/ {rule.namespace}</span>}
                          <span>- {rule.targets.length} target{rule.targets.length !== 1 ? 's' : ''}</span>
                          <span>- {rule.cooldownMinutes}m cooldown</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => setEditingRule(rule)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-red-500"
                        onClick={() => {
                          if (confirm(`Delete alert rule "${rule.name}"?`)) {
                            deleteMutation.mutate(rule.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alert History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            Alert History
            {historyData && (
              <Badge variant="secondary" className="text-[10px]">{historyTotal}</Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Recent alert deliveries and their status
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2 border-b bg-slate-50/60 dark:bg-slate-800/40">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Alert</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 min-w-[80px]">Resource</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 min-w-[80px]">Severity</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 min-w-[70px]">Status</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 min-w-[100px] text-right">Time</span>
          </div>

          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !historyData?.entries || historyData.entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <Clock className="h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-muted-foreground">No alert history</p>
            </div>
          ) : (
            historyData.entries.map((entry) => {
              const sev = severityStyles[entry.severity];
              return (
                <div
                  key={entry.id}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{entry.ruleName}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-1">{entry.message}</p>
                  </div>
                  <div className="text-xs text-slate-500 min-w-[80px] truncate font-mono">
                    {entry.resource}
                  </div>
                  <div className="min-w-[80px]">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', sev.bg, sev.color)}>
                      {entry.severity}
                    </span>
                  </div>
                  <div className="min-w-[70px]">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', statusStyles[entry.status])}>
                      {entry.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 text-right min-w-[100px]">
                    {new Date(entry.firedAt).toLocaleString()}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* History Pagination */}
      {historyTotalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {historyPage + 1} of {historyTotalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
              disabled={historyPage === 0}
              className="gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHistoryPage((p) => Math.min(historyTotalPages - 1, p + 1))}
              disabled={historyPage >= historyTotalPages - 1}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
