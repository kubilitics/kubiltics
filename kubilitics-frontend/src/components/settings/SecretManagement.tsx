/**
 * SecretManagement — ENT-001
 *
 * Settings page section for configuring the secret provider backend.
 * Supports Kubernetes Secrets, HashiCorp Vault, AWS Secrets Manager,
 * and Azure Key Vault with per-provider configuration forms and health
 * status indicators.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  KeyRound,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Save,
  Trash2,
  RefreshCw,
  Lock,
  Server,
  Cloud,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  useSecretProvider,
  PROVIDER_META,
  type SecretProviderType,
  type SecretProviderConfig,
} from '@/hooks/useSecretProvider';

// ─── Provider option cards ───────────────────────────────────

const PROVIDER_OPTIONS: {
  value: SecretProviderType;
  label: string;
  icon: React.ElementType;
  description: string;
}[] = [
  {
    value: 'kubernetes',
    label: 'Kubernetes Secrets',
    icon: Shield,
    description: 'Native Kubernetes secret objects (etcd-backed)',
  },
  {
    value: 'vault',
    label: 'HashiCorp Vault',
    icon: Lock,
    description: 'Enterprise-grade secret management with audit logging',
  },
  {
    value: 'aws-secrets-manager',
    label: 'AWS Secrets Manager',
    icon: Cloud,
    description: 'AWS-managed secrets with automatic rotation support',
  },
  {
    value: 'azure-key-vault',
    label: 'Azure Key Vault',
    icon: Server,
    description: 'Azure-managed HSM-backed secrets and certificates',
  },
];

// ─── Status badge ────────────────────────────────────────────

function HealthBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'default' | 'destructive' | 'outline' | 'secondary'; label: string }> = {
    healthy: { variant: 'default', label: 'Healthy' },
    degraded: { variant: 'secondary', label: 'Degraded' },
    unreachable: { variant: 'destructive', label: 'Unreachable' },
    unconfigured: { variant: 'outline', label: 'Not Configured' },
  };
  const entry = map[status] ?? map.unconfigured;
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

function HealthIcon({ status }: { status: string }) {
  switch (status) {
    case 'healthy':
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case 'degraded':
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    case 'unreachable':
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return <Shield className="h-5 w-5 text-muted-foreground" />;
  }
}

// ─── Component ───────────────────────────────────────────────

export default function SecretManagement() {
  const {
    config,
    health,
    isLoading,
    isSaving,
    isTesting,
    error,
    saveConfig,
    testConnection,
    deleteConfig,
    fetchConfig,
  } = useSecretProvider();

  // Local form state
  const [selectedProvider, setSelectedProvider] = useState<SecretProviderType>('kubernetes');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [credentialsPath, setCredentialsPath] = useState('');
  const [mountPath, setMountPath] = useState('secret');
  const [region, setRegion] = useState('us-east-1');
  const [tenantId, setTenantId] = useState('');
  const [tlsVerify, setTlsVerify] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Hydrate form from loaded config
  useEffect(() => {
    if (config) {
      setSelectedProvider(config.provider);
      setEndpointUrl(config.endpointUrl ?? '');
      setCredentialsPath(config.credentialsPath ?? '');
      setMountPath(config.mountPath ?? 'secret');
      setRegion(config.region ?? 'us-east-1');
      setTenantId(config.tenantId ?? '');
      setTlsVerify(config.tlsVerify ?? true);
    }
  }, [config]);

  function buildConfig(): SecretProviderConfig {
    return {
      provider: selectedProvider,
      displayName: PROVIDER_META[selectedProvider].displayName,
      endpointUrl: selectedProvider !== 'kubernetes' ? endpointUrl : undefined,
      credentialsPath: selectedProvider !== 'kubernetes' ? credentialsPath : undefined,
      mountPath: selectedProvider === 'vault' ? mountPath : undefined,
      region: selectedProvider === 'aws-secrets-manager' ? region : undefined,
      tenantId: selectedProvider === 'azure-key-vault' ? tenantId : undefined,
      tlsVerify: selectedProvider !== 'kubernetes' ? tlsVerify : undefined,
    };
  }

  async function handleSave() {
    const cfg = buildConfig();
    // Basic validation
    if (selectedProvider !== 'kubernetes' && !endpointUrl.trim()) {
      toast.error('Endpoint URL is required for external providers');
      return;
    }
    const ok = await saveConfig(cfg);
    if (ok) {
      toast.success('Secret provider configuration saved');
    } else {
      toast.error('Failed to save configuration');
    }
  }

  async function handleTest() {
    const cfg = buildConfig();
    const result = await testConnection(cfg);
    if (result.status === 'healthy') {
      toast.success('Connection test passed', { description: `Latency: ${result.latencyMs ?? '?'}ms` });
    } else {
      toast.error('Connection test failed', { description: result.message });
    }
  }

  async function handleDelete() {
    const ok = await deleteConfig();
    if (ok) {
      toast.success('Secret provider configuration removed');
      setShowDeleteConfirm(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading secret provider configuration...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Secret Management</CardTitle>
              <CardDescription>Configure the secret provider for secure credential storage</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HealthIcon status={health.status} />
            <HealthBadge status={health.status} />
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

        {/* Health summary when configured */}
        {config && health.status !== 'unconfigured' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Current Provider</div>
              <Button variant="ghost" size="sm" onClick={() => fetchConfig()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Refresh
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Provider: </span>
                <span className="font-medium">{PROVIDER_META[config.provider].displayName}</span>
              </div>
              {health.latencyMs !== undefined && (
                <div>
                  <span className="text-muted-foreground">Latency: </span>
                  <span className="font-medium">{health.latencyMs}ms</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Last Check: </span>
                <span className="font-medium">
                  {new Date(health.lastChecked).toLocaleTimeString()}
                </span>
              </div>
            </div>
            {health.message && health.status !== 'healthy' && (
              <p className="text-xs text-muted-foreground">{health.message}</p>
            )}
          </motion.div>
        )}

        {/* Provider selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Provider</Label>
          <div className="grid grid-cols-2 gap-3">
            {PROVIDER_OPTIONS.map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedProvider(value)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all',
                  selectedProvider === value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50'
                )}
              >
                <Icon
                  className={cn(
                    'h-5 w-5 mt-0.5 shrink-0',
                    selectedProvider === value ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Provider-specific configuration */}
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedProvider}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {selectedProvider === 'kubernetes' && (
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  Kubernetes native secrets are stored in etcd. For production use, enable etcd encryption at rest
                  and consider an external provider for enhanced security.
                </AlertDescription>
              </Alert>
            )}

            {selectedProvider === 'vault' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="vault-endpoint">Vault Address</Label>
                  <Input
                    id="vault-endpoint"
                    placeholder="https://vault.example.com:8200"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The VAULT_ADDR for your HashiCorp Vault instance
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vault-creds">Token / Credentials Path</Label>
                  <Input
                    id="vault-creds"
                    placeholder="/var/run/secrets/vault/token"
                    value={credentialsPath}
                    onChange={(e) => setCredentialsPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Path to the Vault token or Kubernetes auth role file
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vault-mount">Secrets Engine Mount Path</Label>
                  <Input
                    id="vault-mount"
                    placeholder="secret"
                    value={mountPath}
                    onChange={(e) => setMountPath(e.target.value)}
                  />
                </div>
              </>
            )}

            {selectedProvider === 'aws-secrets-manager' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="aws-region">AWS Region</Label>
                  <Select value={region} onValueChange={setRegion}>
                    <SelectTrigger id="aws-region">
                      <SelectValue placeholder="Select region" />
                    </SelectTrigger>
                    <SelectContent>
                      {['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1'].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aws-creds">Credentials Path</Label>
                  <Input
                    id="aws-creds"
                    placeholder="/var/run/secrets/aws/credentials"
                    value={credentialsPath}
                    onChange={(e) => setCredentialsPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Path to AWS credentials file. Leave empty to use IAM role / IRSA.
                  </p>
                </div>
              </>
            )}

            {selectedProvider === 'azure-key-vault' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="azure-endpoint">Key Vault URL</Label>
                  <Input
                    id="azure-endpoint"
                    placeholder="https://my-vault.vault.azure.net"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azure-tenant">Tenant ID</Label>
                  <Input
                    id="azure-tenant"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azure-creds">Credentials Path</Label>
                  <Input
                    id="azure-creds"
                    placeholder="/var/run/secrets/azure/client-secret"
                    value={credentialsPath}
                    onChange={(e) => setCredentialsPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Path to Azure service principal credentials. Leave empty for managed identity.
                  </p>
                </div>
              </>
            )}

            {/* TLS toggle for external providers */}
            {selectedProvider !== 'kubernetes' && (
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">TLS Verification</div>
                  <div className="text-xs text-muted-foreground">
                    Verify TLS certificates when connecting to the provider
                  </div>
                </div>
                <Switch checked={tlsVerify} onCheckedChange={setTlsVerify} />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex gap-2">
            {config && (
              <>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-destructive">Remove provider?</span>
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={isSaving}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleTest} disabled={isTesting}>
              {isTesting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Test Connection
                </>
              )}
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
        </div>
      </CardContent>
    </Card>
  );
}
