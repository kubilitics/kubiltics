import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  ArrowLeft,
  Save,
  Loader2,
  Shield,
  Clock,
  Gauge,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAutoPilotConfig,
  useAutoPilotRules,
  useUpdateRuleConfig,
} from '@/hooks/useAutoPilot';
import type { AutoPilotRuleConfig } from '@/services/api/autopilot';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';

// ── Mode badge colors ────────────────────────────────────────────────────────

const MODE_COLORS: Record<string, string> = {
  auto: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  approval: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  audit: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
};

// ── Page Component ───────────────────────────────────────────────────────────

const AutoPilotConfig = () => {
  const { data: serverConfig = [], isLoading: configLoading } = useAutoPilotConfig();
  const { data: rules = [], isLoading: rulesLoading } = useAutoPilotRules();
  const updateRuleConfig = useUpdateRuleConfig();

  // Local editable state — initialized from server config
  const [localConfig, setLocalConfig] = useState<AutoPilotRuleConfig[]>([]);
  const [namespaceIncludes, setNamespaceIncludes] = useState('');
  const [namespaceExcludes, setNamespaceExcludes] = useState('');
  const [cooldownMinutes, setCooldownMinutes] = useState(60);
  const [maxPerHour, setMaxPerHour] = useState(10);
  const [simulationGate, setSimulationGate] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  // Sync server config into local state
  useEffect(() => {
    if (serverConfig.length > 0) {
      setLocalConfig(serverConfig);
      // Derive global settings from first rule (they share these values)
      const first = serverConfig[0];
      if (first) {
        setCooldownMinutes(first.cooldown_minutes || 60);
        setNamespaceIncludes((first.namespace_includes ?? []).join(', '));
        setNamespaceExcludes((first.namespace_excludes ?? []).join(', '));
      }
    }
  }, [serverConfig]);

  // Build a merged list: rules with their config (if any)
  const ruleRows = rules.map((rule) => {
    const cfg = localConfig.find((c) => c.rule_id === rule.id);
    return {
      rule,
      config: cfg ?? {
        rule_id: rule.id,
        mode: 'audit' as const,
        enabled: true,
        cooldown_minutes: cooldownMinutes,
        namespace_includes: [],
        namespace_excludes: [],
      },
    };
  });

  const handleModeChange = (ruleId: string, mode: 'auto' | 'approval' | 'audit') => {
    setLocalConfig((prev) =>
      prev.map((c) => (c.rule_id === ruleId ? { ...c, mode } : c)),
    );
    setIsDirty(true);
  };

  const handleEnabledChange = (ruleId: string, enabled: boolean) => {
    setLocalConfig((prev) =>
      prev.map((c) => (c.rule_id === ruleId ? { ...c, enabled } : c)),
    );
    setIsDirty(true);
  };

  const handleSave = async () => {
    const includes = namespaceIncludes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const excludes = namespaceExcludes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      for (const row of ruleRows) {
        const cfg: AutoPilotRuleConfig = {
          ...row.config,
          cooldown_minutes: cooldownMinutes,
          namespace_includes: includes.length > 0 ? includes : undefined,
          namespace_excludes: excludes.length > 0 ? excludes : undefined,
        };
        await updateRuleConfig.mutateAsync({ ruleId: cfg.rule_id, config: cfg });
      }
      setIsDirty(false);
      toast.success('Auto-Pilot configuration saved');
    } catch {
      toast.error('Failed to save configuration');
    }
  };

  const isLoading = configLoading || rulesLoading;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/auto-pilot">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Auto-Pilot Configuration</h1>
            <p className="text-sm text-muted-foreground">
              Per-rule modes, safety settings, and namespace scope
            </p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={!isDirty || updateRuleConfig.isPending}
        >
          {updateRuleConfig.isPending ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1.5" />
          )}
          Save Configuration
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading configuration...
        </div>
      ) : (
        <>
          {/* Rule Configuration */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-semibold">Rule Configuration</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Rule</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Mode</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Severity</th>
                      <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Enabled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ruleRows.map(({ rule, config }) => (
                      <tr key={rule.id} className="border-b border-border/30">
                        <td className="py-3 px-3">
                          <div>
                            <p className="font-medium">{rule.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{rule.description}</p>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Select
                            value={config.mode}
                            onValueChange={(v) => handleModeChange(rule.id, v as 'auto' | 'approval' | 'audit')}
                          >
                            <SelectTrigger className="w-32 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Auto</SelectItem>
                              <SelectItem value="approval">Approval</SelectItem>
                              <SelectItem value="audit">Audit Only</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-3 px-3">
                          <Badge className={cn('text-[10px] uppercase', MODE_COLORS[rule.severity] ?? MODE_COLORS.audit)}>
                            {rule.severity}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <Switch
                            checked={config.enabled}
                            onCheckedChange={(checked) => handleEnabledChange(rule.id, checked)}
                          />
                        </td>
                      </tr>
                    ))}
                    {ruleRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                          No rules available. The backend may not be initialized yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Safety Settings */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-semibold">Safety Settings</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cooldown" className="text-sm flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Cooldown between remediations (minutes)
                  </Label>
                  <Input
                    id="cooldown"
                    type="number"
                    min={1}
                    max={1440}
                    value={cooldownMinutes}
                    onChange={(e) => {
                      setCooldownMinutes(Number(e.target.value));
                      setIsDirty(true);
                    }}
                    className="w-32"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxPerHour" className="text-sm flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5" />
                    Max remediations per hour
                  </Label>
                  <Input
                    id="maxPerHour"
                    type="number"
                    min={1}
                    max={100}
                    value={maxPerHour}
                    onChange={(e) => {
                      setMaxPerHour(Number(e.target.value));
                      setIsDirty(true);
                    }}
                    className="w-32"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                <Label htmlFor="simGate" className="text-sm font-medium cursor-pointer">
                  Require simulation gate before applying
                </Label>
                <Switch
                  id="simGate"
                  checked={simulationGate}
                  onCheckedChange={(checked) => {
                    setSimulationGate(checked);
                    setIsDirty(true);
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Namespace Scope */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-semibold">Namespace Scope</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nsInclude" className="text-sm">
                  Include namespaces (comma-separated, empty = all)
                </Label>
                <Input
                  id="nsInclude"
                  placeholder="production, staging, payments"
                  value={namespaceIncludes}
                  onChange={(e) => {
                    setNamespaceIncludes(e.target.value);
                    setIsDirty(true);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nsExclude" className="text-sm">
                  Exclude namespaces (comma-separated)
                </Label>
                <Input
                  id="nsExclude"
                  placeholder="kube-system, monitoring, flux-system"
                  value={namespaceExcludes}
                  onChange={(e) => {
                    setNamespaceExcludes(e.target.value);
                    setIsDirty(true);
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default AutoPilotConfig;
