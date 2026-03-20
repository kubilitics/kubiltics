/**
 * SSOEnforcement — ENT-015
 *
 * SSO configuration page with OIDC/SAML provider setup.
 * Toggle to disable local auth when SSO is configured.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  KeyRound,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Save,
  RefreshCw,
  Lock,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────

type SSOProtocol = 'oidc' | 'saml';

interface OIDCConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  usernameClaim: string;
  groupsClaim: string;
}

interface SAMLConfig {
  entityId: string;
  ssoUrl: string;
  certificate: string;
  acsUrl: string;
  nameIdFormat: string;
}

interface SSOConfig {
  enabled: boolean;
  protocol: SSOProtocol;
  enforceSSO: boolean; // When true, local auth is disabled
  oidc: OIDCConfig;
  saml: SAMLConfig;
}

interface SSOHealth {
  status: 'configured' | 'unconfigured' | 'error';
  message?: string;
  lastVerified?: string;
}

// ─── Defaults ────────────────────────────────────────────────

const DEFAULT_CONFIG: SSOConfig = {
  enabled: false,
  protocol: 'oidc',
  enforceSSO: false,
  oidc: {
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    scopes: 'openid profile email',
    usernameClaim: 'email',
    groupsClaim: 'groups',
  },
  saml: {
    entityId: '',
    ssoUrl: '',
    certificate: '',
    acsUrl: '',
    nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  },
};

// ─── Component ───────────────────────────────────────────────

export default function SSOEnforcement() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);

  const [config, setConfig] = useState<SSOConfig>(DEFAULT_CONFIG);
  const [health, setHealth] = useState<SSOHealth>({ status: 'unconfigured' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch config ───────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/sso`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) setConfig({ ...DEFAULT_CONFIG, ...data.config });
        if (data.health) setHealth(data.health);
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

  // ── Auto-compute callback URLs ─────────────────────────────

  useEffect(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!config.oidc.redirectUri) {
      setConfig((c) => ({
        ...c,
        oidc: { ...c.oidc, redirectUri: `${origin}/auth/callback` },
      }));
    }
    if (!config.saml.acsUrl) {
      setConfig((c) => ({
        ...c,
        saml: { ...c.saml, acsUrl: `${origin}/auth/saml/acs` },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save ───────────────────────────────────────────────────

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/sso`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      const data = await res.json();
      if (data.health) setHealth(data.health);
      toast.success('SSO configuration saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }

  // ── Test connection ────────────────────────────────────────

  async function handleTest() {
    setIsTesting(true);
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/sso/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error('SSO verification failed');
      const data: SSOHealth = await res.json();
      setHealth(data);
      if (data.status === 'configured') {
        toast.success('SSO provider verified');
      } else {
        toast.warning(data.message || 'SSO verification returned warnings');
      }
    } catch (err) {
      setHealth({ status: 'error', message: err instanceof Error ? err.message : 'Verification failed' });
      toast.error('SSO verification failed');
    } finally {
      setIsTesting(false);
    }
  }

  // ── OIDC field updater ─────────────────────────────────────

  function updateOIDC(field: keyof OIDCConfig, value: string) {
    setConfig((c) => ({ ...c, oidc: { ...c.oidc, [field]: value } }));
  }

  // ── SAML field updater ─────────────────────────────────────

  function updateSAML(field: keyof SAMLConfig, value: string) {
    setConfig((c) => ({ ...c, saml: { ...c.saml, [field]: value } }));
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading SSO configuration...</span>
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
              <CardTitle>Single Sign-On (SSO)</CardTitle>
              <CardDescription>
                Configure OIDC or SAML-based SSO for enterprise authentication
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {health.status === 'configured' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {health.status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
            <Badge variant={health.status === 'configured' ? 'default' : health.status === 'error' ? 'destructive' : 'outline'}>
              {health.status}
            </Badge>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => setConfig((c) => ({ ...c, enabled }))}
            />
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

        {/* Enforce SSO toggle */}
        <div className="flex items-center justify-between rounded-lg border-2 border-amber-200 dark:border-amber-800 p-4">
          <div className="flex items-center gap-3">
            {config.enforceSSO ? (
              <Lock className="h-5 w-5 text-amber-600" />
            ) : (
              <Unlock className="h-5 w-5 text-muted-foreground" />
            )}
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Enforce SSO-Only Login</div>
              <div className="text-xs text-muted-foreground">
                When enabled, local username/password authentication is disabled.
                All users must authenticate through the configured SSO provider.
              </div>
            </div>
          </div>
          <Switch
            checked={config.enforceSSO}
            onCheckedChange={(enforceSSO) => setConfig((c) => ({ ...c, enforceSSO }))}
            disabled={!config.enabled}
          />
        </div>

        {config.enforceSSO && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              SSO enforcement is enabled. Ensure your SSO provider is properly configured
              before saving to avoid locking out all users.
            </AlertDescription>
          </Alert>
        )}

        {/* Protocol tabs */}
        <Tabs value={config.protocol} onValueChange={(v) => setConfig((c) => ({ ...c, protocol: v as SSOProtocol }))}>
          <TabsList>
            <TabsTrigger value="oidc">OpenID Connect (OIDC)</TabsTrigger>
            <TabsTrigger value="saml">SAML 2.0</TabsTrigger>
          </TabsList>

          {/* OIDC Configuration */}
          <TabsContent value="oidc" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="oidc-issuer">Issuer URL</Label>
              <Input
                id="oidc-issuer"
                placeholder="https://accounts.google.com or https://dev-xxxxx.okta.com/oauth2/default"
                value={config.oidc.issuerUrl}
                onChange={(e) => updateOIDC('issuerUrl', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The OIDC discovery endpoint (must serve .well-known/openid-configuration)
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="oidc-client-id">Client ID</Label>
                <Input
                  id="oidc-client-id"
                  placeholder="kubilitics-client-id"
                  value={config.oidc.clientId}
                  onChange={(e) => updateOIDC('clientId', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="oidc-client-secret">Client Secret</Label>
                <Input
                  id="oidc-client-secret"
                  type="password"
                  placeholder="Enter client secret"
                  value={config.oidc.clientSecret}
                  onChange={(e) => updateOIDC('clientSecret', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="oidc-redirect">Redirect URI</Label>
              <Input
                id="oidc-redirect"
                value={config.oidc.redirectUri}
                onChange={(e) => updateOIDC('redirectUri', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Register this URI in your IdP's allowed callback URLs
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="oidc-scopes">Scopes</Label>
                <Input
                  id="oidc-scopes"
                  placeholder="openid profile email"
                  value={config.oidc.scopes}
                  onChange={(e) => updateOIDC('scopes', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="oidc-username-claim">Username Claim</Label>
                <Input
                  id="oidc-username-claim"
                  placeholder="email"
                  value={config.oidc.usernameClaim}
                  onChange={(e) => updateOIDC('usernameClaim', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="oidc-groups-claim">Groups Claim</Label>
                <Input
                  id="oidc-groups-claim"
                  placeholder="groups"
                  value={config.oidc.groupsClaim}
                  onChange={(e) => updateOIDC('groupsClaim', e.target.value)}
                />
              </div>
            </div>
          </TabsContent>

          {/* SAML Configuration */}
          <TabsContent value="saml" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="saml-sso-url">SSO URL</Label>
              <Input
                id="saml-sso-url"
                placeholder="https://idp.example.com/sso/saml"
                value={config.saml.ssoUrl}
                onChange={(e) => updateSAML('ssoUrl', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Identity Provider Single Sign-On URL
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="saml-entity-id">Entity ID</Label>
                <Input
                  id="saml-entity-id"
                  placeholder="https://kubilitics.example.com"
                  value={config.saml.entityId}
                  onChange={(e) => updateSAML('entityId', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saml-acs">ACS URL</Label>
                <Input
                  id="saml-acs"
                  value={config.saml.acsUrl}
                  onChange={(e) => updateSAML('acsUrl', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="saml-cert">IdP Certificate (PEM)</Label>
              <textarea
                id="saml-cert"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                value={config.saml.certificate}
                onChange={(e) => updateSAML('certificate', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="saml-nameid">NameID Format</Label>
              <Select value={config.saml.nameIdFormat} onValueChange={(v) => updateSAML('nameIdFormat', v)}>
                <SelectTrigger id="saml-nameid">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">Email Address</SelectItem>
                  <SelectItem value="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">Unspecified</SelectItem>
                  <SelectItem value="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">Persistent</SelectItem>
                  <SelectItem value="urn:oasis:names:tc:SAML:2.0:nameid-format:transient">Transient</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleTest} disabled={isTesting}>
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Verify Provider
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
      </CardContent>
    </Card>
  );
}
