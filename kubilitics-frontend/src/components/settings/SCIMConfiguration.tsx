/**
 * SCIMConfiguration — ENT-013
 *
 * SCIM 2.0 endpoint configuration for automated user provisioning.
 * Supports IdP integration (Okta, Azure AD) and shows user sync status.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Save,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  Link2,
  Shield,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────

type IdProvider = 'okta' | 'azure-ad' | 'onelogin' | 'custom';

interface SCIMConfig {
  enabled: boolean;
  provider: IdProvider;
  endpointUrl: string;
  bearerToken: string;
  autoProvision: boolean;
  autoDeprovision: boolean;
  defaultRole: string;
  groupMapping: boolean;
}

interface SyncStatus {
  lastSync: string | null;
  status: 'synced' | 'syncing' | 'error' | 'never';
  totalUsers: number;
  provisionedUsers: number;
  deprovisionedUsers: number;
  errorCount: number;
  message?: string;
}

// ─── Constants ───────────────────────────────────────────────

const IDP_OPTIONS: { value: IdProvider; label: string; description: string }[] = [
  { value: 'okta', label: 'Okta', description: 'Okta SCIM 2.0 integration' },
  { value: 'azure-ad', label: 'Microsoft Entra ID', description: 'Azure AD / Entra ID SCIM provisioning' },
  { value: 'onelogin', label: 'OneLogin', description: 'OneLogin SCIM integration' },
  { value: 'custom', label: 'Custom SCIM', description: 'Any SCIM 2.0-compliant identity provider' },
];

// ─── Component ───────────────────────────────────────────────

export default function SCIMConfiguration() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);

  const [config, setConfig] = useState<SCIMConfig>({
    enabled: false,
    provider: 'okta',
    endpointUrl: '',
    bearerToken: '',
    autoProvision: true,
    autoDeprovision: false,
    defaultRole: 'viewer',
    groupMapping: true,
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSync: null,
    status: 'never',
    totalUsers: 0,
    provisionedUsers: 0,
    deprovisionedUsers: 0,
    errorCount: 0,
  });
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Computed SCIM endpoint ─────────────────────────────────

  const scimEndpoint = `${backendBaseUrl}/api/v1/scim/v2`;

  // ── Fetch config ───────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/scim`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) setConfig(data.config);
        if (data.syncStatus) setSyncStatus(data.syncStatus);
      }
    } catch {
      // Defaults
    } finally {
      setIsLoading(false);
    }
  }, [backendBaseUrl]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ── Save config ────────────────────────────────────────────

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/scim`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      toast.success('SCIM configuration saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }

  // ── Trigger sync ───────────────────────────────────────────

  async function handleSync() {
    setIsSyncing(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/scim/sync`, { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      if (data.syncStatus) setSyncStatus(data.syncStatus);
      toast.success('User sync completed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  }

  // ── Copy to clipboard ─────────────────────────────────────

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied to clipboard`));
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading SCIM configuration...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>SCIM User Provisioning</CardTitle>
              <CardDescription>
                Automate user lifecycle management with SCIM 2.0
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => setConfig((c) => ({ ...c, enabled }))}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* SCIM endpoint info */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">SCIM 2.0 Endpoint</Label>
            <Badge variant="outline">
              <Link2 className="h-3 w-3 mr-1" />
              Provide to your IdP
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Input value={scimEndpoint} readOnly className="font-mono text-xs" />
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(scimEndpoint, 'SCIM endpoint')}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Sync status */}
        {config.enabled && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Sync Status</Label>
                {syncStatus.status === 'synced' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {syncStatus.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                {syncStatus.status === 'syncing' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
              </div>
              <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
                {isSyncing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    Sync Now
                  </>
                )}
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total: </span>
                <span className="font-medium">{syncStatus.totalUsers}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Provisioned: </span>
                <span className="font-medium text-emerald-600">{syncStatus.provisionedUsers}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Deprovisioned: </span>
                <span className="font-medium">{syncStatus.deprovisionedUsers}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Errors: </span>
                <span className={cn('font-medium', syncStatus.errorCount > 0 && 'text-red-600')}>{syncStatus.errorCount}</span>
              </div>
            </div>
            {syncStatus.lastSync && (
              <p className="text-xs text-muted-foreground">
                Last sync: {new Date(syncStatus.lastSync).toLocaleString()}
              </p>
            )}
          </motion.div>
        )}

        {/* IdP Selection */}
        <div className="space-y-3">
          <Label>Identity Provider</Label>
          <Select value={config.provider} onValueChange={(v) => setConfig((c) => ({ ...c, provider: v as IdProvider }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IDP_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div>
                    <div className="text-sm">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bearer token */}
        <div className="space-y-2">
          <Label>Bearer Token</Label>
          <div className="flex items-center gap-2">
            <Input
              type={showToken ? 'text' : 'password'}
              placeholder="Enter SCIM bearer token"
              value={config.bearerToken}
              onChange={(e) => setConfig((c) => ({ ...c, bearerToken: e.target.value }))}
            />
            <Button variant="outline" size="sm" onClick={() => setShowToken(!showToken)}>
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Generate a token and configure it in your IdP's SCIM settings
          </p>
        </div>

        {/* Default role */}
        <div className="space-y-2">
          <Label>Default Role for New Users</Label>
          <Select value={config.defaultRole} onValueChange={(v) => setConfig((c) => ({ ...c, defaultRole: v }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">Viewer (Read-only)</SelectItem>
              <SelectItem value="operator">Operator</SelectItem>
              <SelectItem value="admin">Administrator</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Toggles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Auto-Provision Users</div>
              <div className="text-xs text-muted-foreground">
                Automatically create Kubilitics accounts when users are assigned in IdP
              </div>
            </div>
            <Switch
              checked={config.autoProvision}
              onCheckedChange={(checked) => setConfig((c) => ({ ...c, autoProvision: checked }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Auto-Deprovision Users</div>
              <div className="text-xs text-muted-foreground">
                Automatically suspend access when users are unassigned in IdP
              </div>
            </div>
            <Switch
              checked={config.autoDeprovision}
              onCheckedChange={(checked) => setConfig((c) => ({ ...c, autoDeprovision: checked }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Group-to-Role Mapping</div>
              <div className="text-xs text-muted-foreground">
                Map IdP groups to Kubilitics roles automatically
              </div>
            </div>
            <Switch
              checked={config.groupMapping}
              onCheckedChange={(checked) => setConfig((c) => ({ ...c, groupMapping: checked }))}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
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
